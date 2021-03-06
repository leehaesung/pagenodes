var when = require('when');
var path = require("path");

var redNodes = require("./nodes");
var comms = require("./comms");
var storage = require("./storage");
var log = require("./log");
var settings = require('./settings');

var server = {};


var api = require('./api');

var runtimeMetricInterval = null;


function start() {
  return storage.init(settings)
    .then(function(settingsInited) {
      console.log('settings inited', settingsInited);
      return settings.load(storage)
    })
    .then(function(storageLoaded) {
      console.log('storageLoaded', settings, storageLoaded);

      api.init({}, storage);

      console.log("\n\n"+log._("runtime.welcome")+"\n===================\n");
      if (settings.version) {
        log.info(log._("runtime.version",{component:"Node-RED",version:"v"+settings.version}));
      }

      log.info(log._("runtime.version",{component:"Node.js ",version:process.version}));
      log.info(log._("server.loading"));
      redNodes.init(settings,storage);

      return redNodes.load().then(function(redNodesLoaded) {
        console.log('redNodesLoaded', redNodesLoaded);
        var i;
        var nodeErrors = redNodes.getNodeList(function(n) { return n.err!=null;});
        var nodeMissing = redNodes.getNodeList(function(n) { return n.module && n.enabled && !n.loaded && !n.err;});
        if (nodeErrors.length > 0) {
          log.warn("------------------------------------------");
          if (settings.verbose) {
            for (i=0;i<nodeErrors.length;i+=1) {
              log.warn("["+nodeErrors[i].name+"] "+nodeErrors[i].err);
            }
          } else {
            log.warn(log._("server.errors",{count:nodeErrors.length}));
            log.warn(log._("server.errors-help"));
          }
          log.warn("------------------------------------------");
        }
        if (nodeMissing.length > 0) {
          log.warn(log._("server.missing-modules"));
          var missingModules = {};
          for (i=0;i<nodeMissing.length;i++) {
            var missing = nodeMissing[i];
            missingModules[missing.module] = (missingModules[missing.module]||[]).concat(missing.types);
          }
          var promises = [];
          for (i in missingModules) {
            if (missingModules.hasOwnProperty(i)) {
              log.warn(" - "+i+": "+missingModules[i].join(", "));
              if (settings.autoInstallModules && i != "node-red") {
                serverAPI.installModule(i).catch(function(err) {
                  // Error already reported. Need the otherwise handler
                  // to stop the error propagating any further
                });
              }
            }
          }
          if (!settings.autoInstallModules) {
            log.info(log._("server.removing-modules"));
            redNodes.cleanModuleList();
          }
        }
        log.info(log._("runtime.paths.settings",{path:settings.settingsFile}));
        return redNodes.loadFlows();
      }).catch(function(err) {
        console.log('error starting backend', err);
      });
    });
}


function reportAddedModules(info) {
  comms.publish("node/added",info.nodes,false);
  if (info.nodes.length > 0) {
    log.info(log._("server.added-types"));
    for (var i=0;i<info.nodes.length;i++) {
      for (var j=0;j<info.nodes[i].types.length;j++) {
        log.info(" - "+
          (info.nodes[i].module?info.nodes[i].module+":":"")+
          info.nodes[i].types[j]+
          (info.nodes[i].err?" : "+info.nodes[i].err:"")
        );
      }
    }
  }
  return info;
}

function reportRemovedModules(removedNodes) {
  comms.publish("node/removed",removedNodes,false);
  log.info(log._("server.removed-types"));
  for (var j=0;j<removedNodes.length;j++) {
    for (var i=0;i<removedNodes[j].types.length;i++) {
      log.info(" - "+(removedNodes[j].module?removedNodes[j].module+":":"")+removedNodes[j].types[i]);
    }
  }
  return removedNodes;
}

function installNode(file) {
  return when.promise(function(resolve,reject) {
    resolve(redNodes.addFile(file).then(function(info) {
      var module = redNodes.getModuleInfo(info.module);
      module.nodes = module.nodes.filter(function(d) {
        return d.id==info.id;
      });
      return reportAddedModules(module);
    }));
  });
}


function installModule(module) {
  //TODO: ensure module is 'safe'
  return when.resolve('ok');
}


function stop() {
  if (runtimeMetricInterval) {
    clearInterval(runtimeMetricInterval);
    runtimeMetricInterval = null;
  }
  redNodes.stopFlows();
  comms.stop();
}

var serverAPI = module.exports = {
  start: start,
  stop: stop,

  reportAddedModules: reportAddedModules,
  reportRemovedModules: reportRemovedModules,
  installModule: installModule,
  installNode: installNode,

  get server() { return server }
}

