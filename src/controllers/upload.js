var async = require('async');
var parser = require('./parser');

// Initialize our processing queue
var processingQueue = async.queue(parser.processQueue, 1);

module.exports.upload = function (req, res) {

	// Add file upload to queue
	addToQueue(req, res, function(error, results) {
		if (error)
			return res.send({ status: 'error', message: error });

		return res.send(results);


	});


};


module.exports.uploadAPI = function (req, res) {

	// Add file upload to queue
	addToQueue(req, res, function(error, results) {
		if (error)
			return res.send({ status: 'error', message: error });

		return res.send(results);

	});

};


function addToQueue(req, res, callback) {
	if (!req.body || !req.files || !req.files.file ) {
		return callback('Malformed Request: Missing File');
	}

	// Remove connection timeout
	res.connection.setTimeout(0);

	// Create process token to be added to queue
	var processToken = {
		req: req,
		res: res,
		file: req.files.file
	}

	processingQueue.push(processToken, callback);

}

