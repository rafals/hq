var cluster = require('cluster');
var app = require('./app');

cluster(app)
.use(cluster.pidfiles())
.use(cluster.cli())
.use(cluster.reload())
.set('user', 'hq')
.use(cluster.logger('/var/log/hq'))
.listen(app.set('port'));