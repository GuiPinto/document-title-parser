/*globals process, __dirname */

var express = require('express');
var enrouten = require('express-enrouten');
var hbs = require('express-hbs');
var multer  = require('multer');

var port = process.env.PORT || 5000;

var app = express();

app.use(multer({ dest: './workspace/'}))

app.use(express.static(__dirname + '/static'));

app.use(enrouten({ directory: 'src/routes' }));

app.use(function (req, res, next) {

    res.status(404).render('404 error');

});

app.engine('hbs', hbs.express3());
app.set('view engine', 'hbs');
app.set('views', __dirname + '/src/views');

app.listen(port);
console.log('listening on port', port);
