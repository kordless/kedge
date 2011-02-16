var http = require('http');  
var io = require('socket.io'); 
var loggly = require('loggly');
var path = require('path');  
var paperboy = require('paperboy');

// connect up to loggly
var config = {
  subdomain: "geekceo",
  auth: {
    username: "kordless",
    password: "password"
  }
};
var geekceo = loggly.createClient(config);

// data for all currently connected clients, their searches, and the current bucket value
// {"12345": {"searches": {"404": 99, "inputname:web": 99} } } 
var clients = {};
var numclients = 0;

// a list of searches we're currently running + results
// { '404': [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 ], 'error': [ 1, 0, 0, 1, 2, 0, 0, 4, 1, 0 ] }
var stashes = {};

// triggered by setInterval directly below
var fetch = function () {
  // build our search list from all the client searches
  for (var client in clients) {  
    // each search stored in each client
    for (var search in clients[client].searches) {
       if (!(search in stashes)) {
         // create array for results if not made
         stashes[search] = [];
       }
    }
  }
  // start retrieving each search
  for (var stash in stashes) {
    if (stashes[stash].length < 5) { 
      // only if the array for the search is running low, do we get new results
      geekceo.facet('date', stash)
        .context({ buckets: 15, from: "NOW-2MINUTES", until: "NOW-1MINUTES" })
        .run(function (err, results) {
          //console.log(results);
          // we're asnyc in here, so don't use non-unique externals
          // use the query in the response for finding the stash search term
          var query = results.context.query;
          // quick list so we can sort by date 
          var ud = [];
          for (var x in results.data) {
            ud.push(x);  
          }
          for (var x in ud.sort()) { 
            // push on to stashes array for query/term/search
            stashes[query].push(results.data[ud[x]]);
          }
        });
    }
  }
}

// run fetch above to check and/or populate stashes
// make this interval * # of buckets above ~= 60K
setInterval(fetch, 4000);

// triggered by setInterval below
// shifts data from each stash and dunks it into the the client's search values
var dunk = function() {
  for (var stash in stashes) {
    // shift off the next entry for this search
    try {
      var foo = stashes[stash].shift();
    } catch(err) {
      var foo = 0;
    }
    for (var client in clients) {
       // if client has this search/stash, update it
       if (stash in clients[client].searches) {
         clients[client].searches[stash] = foo;
       }
      // put in the number of currently connected clients
      clients[client].searches['numclients'] = numclients+"";
    }
  }
}
setInterval(dunk, 4000);

// serve static content
var server = http.createServer(function(req, res){ 
  paperboy.deliver(path.join(path.dirname(__filename), 'static'), req, res);
});
server.listen(80);

// Create a Socket.IO instance, passing it our server
var socket = io.listen(server);

// Add a connect listener
socket.on('connection', function(csock){ 
  // put all of this client's searches in the clients struct
  var interval = null;
  var client_id = csock.sessionId+'';
  numclients++;
  clients[client_id]={"searches": {}};
  csock.on('message',function(search){ 
    clients[client_id].searches[search] = 0;
    geekceo.log('a3e839e9-4827-49aa-9d28-e18e5ba5a818', 'kedge: connect client-'+client_id, function (err, result) { });
  });
  csock.on('disconnect',function(){
    delete clients[client_id]; 
    numclients--;
    clearInterval(interval);
    geekceo.log('a3e839e9-4827-49aa-9d28-e18e5ba5a818', 'kedge: disconnect client-'+client_id, function (err, result) { });
  });

  // push data to client every second 
  var ping = function() {
    //console.log(clients[client_id]);
    csock.send(clients[client_id]);
  }
  var interval = setInterval(ping, 1000);
 
});

