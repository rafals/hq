var express = require('express');
var app = module.exports = express.createServer();
var exec = require('child_process').exec;
var sys = require('sys');
var _ = require('underscore');
var io = require('socket.io');
var request = require('request');

function basic_auth (req, res, next) {
    if (req.headers.authorization && req.headers.authorization.search('Basic ') === 0) {
        // fetch login and password
        if (new Buffer(req.headers.authorization.split(' ')[1], 'base64').toString() == 'admin:kot') {
            next();
            return;
        }
    }
    console.log('Unable to authenticate user');
    console.log(req.headers.authorization);
    res.header('WWW-Authenticate', 'Basic realm="Admin Area"');
    if (req.headers.authorization) {
        setTimeout(function () {
            res.send('Authentication required', 401);
        }, 5000);
    } else {
        res.send('Authentication required', 401);
    }
}

app.configure(function(){
  app.use(basic_auth);
  // Dane przesłane `POST`em są parsowane i dostępne jako hash javascriptowy.
  // Obsługiwane formaty to `application/json` i `application/x-www-form-urlencoded`
  app.use(express.bodyParser());
  // Obsługa własnej logiki skojarzonej z metodami zapytań i adresami url.
  app.use(app.router);
  // Pliki statyczne są serwowane z folderu `/public`.
  app.use(express.static(__dirname + '/public'));
  app.set('port', 5000);
  
});

//app.get('/nginx', function(req, res, next) {
//  fs.readFile('/etc/passwd', function (err, data) {
//    if (err) throw err;
//    console.log(data);
//  });
//});

app.get('/test', function(req, res, next) {
  res.send('c');
});

app.get('/df', function(req, res, next) {
  df(function(error, devices) {
    if (error) { return next(error); }
    res.send(devices);
  });
});

function df(callback) {
  exec('df -T', function(error, stdout, stderr) {
    if(error) { return callback(error, null); }
    var lines = stdout.split("\n");
    lines.shift();
    lines = _.without(lines, "");
    var arrays = _.map(lines, function(line) { return line.split(/[ ]+/); });
    var objects = _.map(arrays, function(array) {
      return {device: array[0], type: array[1], total: Number(array[2]), used: Number(array[3]), available: Number(array[4]), mountpoint: array[6]}
    });
    callback(null, objects);
  });
}


app.get('/packages', function(req, res, next) {
  packages(function(error, result) {
    if (error) { return next(error); }
    res.send(result);
  })
});

function packages(callback) {
  exec('cat /var/lib/portage/world', function(error, stdout, stderr) {
    if (error) { return callback(error, null); }
    var lines = stdout.split("\n");
    var packages = {};
    _(lines).each(function(line) {
      if(line !== "") {
        var data = line.split("/");
        if(!packages[data[0]]) { packages[data[0]] = []; }
        packages[data[0]].push(data[1]);
      }
    });
    callback(null, packages);
  });
}

app.get('/fstab', function(req, res, next) {
  fstab(function(err, result) {
    if (err) { return next(err); }
    res.send(result);
  });
});

function fstab(callback) {
  exec('cat /etc/fstab', function(error, stdout, stderr) {
    if(error) { return callback(error, null); }
    var lines = stdout.split("\n");
    var devices = [];
    _(lines).each(function(line) {
      if(line.length > 0 && line.indexOf("#") !== 0) { // linijki niepuste i niezakomentowane
        var params = line.split(/\s+/);
        var device = { mountpoint: params[1], type: params[2], options: params[3].split(',') };
        var id = params[0];
        if(id.indexOf("UUID") === 0) {
          device.uuid = id.slice(5);
        } else if(id.indexOf("LABEL") === 0) {
          device.label = id.slice(6);
        } else {
          device.device = id; 
        }
        devices.push(device);
      }
    });
    callback(null, devices);
  });
}

app.get('/devices', function(req, res, next) {
  devices(function(error, result) {
    if (error) { return next(error); }
    res.send(result);
  });
});

function devices(callback) {
  fstab(function(error, fs) {
    if (error) { return callback(error, null); }
    df(function(error, dft) {
      if (error) { return callback(error, null); }
      var mountpoints = {};
      
      function add(index, val) {
        if(!mountpoints[index]) {
          mountpoints[index] = val;
        } else {
          _.extend(mountpoints[index], val);
        }
      }
      
      _(fs).each(function(line) {
        add(line.mountpoint, line);
      });
      
      _(dft).each(function(line) {
        add(line.mountpoint, line);
      });
      
      var result = _(mountpoints).map(function(val, key) {
        val.mounted = val.available ? true : false;
        return val;
      });
      
      callback(null, result);
    });
  });
}

app.get('/mount', function(req, res, next) {
  exec('sudo mount ' + req.query.mountpoint, function(error, stdout, stderr) {
    if (stderr) {
      res.redirect('/?error=' + stderr);
    } else {
      res.redirect('/');
    }
  });
});

app.get('/umount', function(req, res, next) {
  exec('sudo umount ' + req.query.mountpoint, function(error, stdout, stderr) {
    if (stderr) {
      res.redirect('/?error=' + stderr);
    } else {
      res.redirect('/');
    }
  });
});

app.get('/memory', function(req, res, next) {
  memory(function(error, result) {
    if (error) { return next(error); }
    res.send(result);
  })
});

function memory(callback) {
  exec('cat /proc/meminfo', function(error, stdout, stderr) {
    if (error) { return callback(error); }
    var params = {};
    _(stdout.split("\n")).each(function(line) {
      if (line !== "") {
        var words = line.split(/\s+/);
        params[words[0].slice(0, -1)] = words[1];
      }
    });
    var result = {total: Number(params['MemTotal']),
                  free: Number(params['MemFree']),
                  cached: Number(params['Cached']),
                  buffers: Number(params['Buffers']),
                  dirty: Number(params['Dirty'])};
    callback(null, result);
  });
}

app.get('/services', function(req, res, next) {
  services('default', function(error, result) {
    if (error) { return next(error); }
    res.send(result);
  })
});

app.get('/services/:level', function(req, res, next) {
  services(req.params.level, function(error, result) {
    if (error) { return next(error); }
    res.send(result);
  })
});

function command(c, res, mapper) {
  exec(c, function(error, stdout, stderr) {
    if(error) {
      res.send((stdout || "") + (stderr || ""), 400);
    } else {
      res.send(mapper(stdout));
    }
  });
}

function handler(c, mapper) {
  return function(req, res) {
    command(c, res, mapper);
  }
}

app.get('/services-list', handler('rc-status --list', function(res) {
    return _(res.split("\n")).without("");
  })
);



function services(level, callback) {
  exec('rc-status ' + level, function(error, stdout, stderr) {
    if (error) { return callback(error); }
    var res = _(stdout.split("\n")).chain().map(function(line) {
      var parts = line.split(/\s+/);
      return parts;
    }).select(function(service) { return service.length === 5 })
    .map(function(service) {
      return {name: service[1], running: (service[3] === "started" ? true : false)};
    }).value();
    callback(null, res);
  });
}

app.get('/start/:service', function(req, res, next) {
  exec('sudo /etc/init.d/' + req.params.service + ' start', function(error, stdout, stderr) {
    if (error) {
      if (stdout) {
        res.redirect('/?error=' + stdout);
      } else {
        res.redirect('/?error=' + error);
      }
    } else {
      res.redirect('/');
    }
  });
});

app.get('/stop/:service', function(req, res, next) {
  if (req.params.service === "net.eth0" || req.params.service === "hq") {
    res.send('nie');
  } else {
    exec('sudo /etc/init.d/' + req.params.service + ' stop', function(error, stdout, stderr) {
      if (error) {
        if (stdout) {
          res.redirect('/?error=' + stdout);
        } else {
          res.redirect('/?error=' + error);
        }
      } else {
        res.redirect('/');
      }
    });
  }
});

app.get('/restart/:service', function(req, res, next) {
  exec('sudo /etc/init.d/' + req.params.service + ' restart', function(error, stdout, stderr) {
    if (error) {
      if (stdout) {
        res.redirect('/?error=' + stdout);
      } else {
        res.redirect('/?error=' + error);
      }
    } else {
      res.redirect('/');
    }
  });
});

app.get('/exec', function(req, res, next) {
  exec(req.query.command, function(error, stdout, stderr) {
    res.send({response: stdout, error: error});
  });
});

app.get('/ping', function(req, res, next) {
  request({uri:req.query.url}, function(error, response, body) {
    if (!error && response.statusCode == 200) {
      res.send({alive: true}, 200);
    } else {
      res.send({alive: false}, 500);
    }
  });
});


var socket = io.listen(app);
socket.on('connection', function(client){ 
  // new client is here!
  
  var id = setInterval(function() {
    memory(function(error, response) {
      client.send(response);
    });
  }, 1000);
  
  client.on('disconnect', function(){
    clearInterval(id);
  });
  
  client.on('message', function(){
    // reakcja na wiadomość
  });
  
});

if (!module.parent) {
  app.listen(app.set('port'));
  console.log("Appload HQ listening on port %d", app.address().port);
}
