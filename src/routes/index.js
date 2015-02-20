var Home = require('../controllers/home');
var Upload = require('../controllers/upload');
var Parser = require('../controllers/parser');

module.exports = function (router) {

    router.get('/', Home.index);

    router.post('/upload', Upload.upload);

    router.post('/api/upload', Upload.uploadAPI);

    router.get('/view/:fileId', Parser.viewFile);


};
