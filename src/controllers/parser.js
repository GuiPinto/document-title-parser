var async = require('async');
var Magic = require('mmmagic').Magic;
var fs = require('fs');

var pdftohtml = require('pdftohtmljs');
var mammoth = require('mammoth');
var phantom = require('phantom');

var workspaceDir =  './workspace';

module.exports.processQueue = function (data, callback) {
	console.log('processQueue()');

	async.waterfall([

		// Kick-start the waterfall with data-obj
		function(cb) { return cb(null, data); },

		// Detect File Type
		detectFileType,

		// Filter/Approve source file type
		approveFileType,

		// Convert source file to HTML
		convertTargetFile,

		// Extract Title
		extractTitle

	], function (err, data, fileType, fileId, title) {
		if (err)
			return callback(err);

	 	console.log('err', err);
	 	console.log('fileType', fileType);
	 	console.log('fileId', fileId);
	 	console.log('title', title);

	 	return callback(err, {
	 		err: err,
	 		fileType: fileType,
	 		fileId: fileId,
	 		title: title
	 	});

	});

};

module.exports.viewFile = function (req, res) {
	var fileId = req.params.fileId;

	// Make safe
	fileId = fileId.replace(/\./g, '');

	var localPath = workspaceDir + "/" + fileId + ".html";
	if (fs.existsSync(localPath)) {

		// Async read and send out file to resource.
		fs.readFile(localPath, "utf8", function (err, data) {
	        if (err) throw err;
	        return res.send(data);
	    });

	} else {
		return res.send({'status': 'error', 'message': 'Invalid File Id.'});
	}

};

var detectFileType = function(data, callback) {
	var magic = new Magic();
	magic.detectFile(data.file.path, function(err, result) {
		// Return local error to processing waterfall
		return callback(err, data, result);
	});
}


var approveFileType = function(data, fileType, callback) {
	var returned = false,
		whitelist = { 'PDF':'pdf', 'Microsoft Word':'doc' },
		fileType = fileType.toLowerCase();

	Object.keys(whitelist).every(function(key) {

		if (fileType.indexOf( key.toLowerCase() ) >= 0) {
			callback(null, data, whitelist[key]);
			returned = true;
			return false; // Stop loop
		} else {
			return true; // Continue
		}

	});

	// Return local error to processing waterfall
	if (returned === false)
		return callback("Invalid File Type!");
}

var convertTargetFile = function(data, fileType, callback) {
	console.log('convertTargetFile() fileType:', fileType);

	var fileId = data.file.name.split('.')[0],
		sourcePath = data.file.path,
		targetPath = [workspaceDir, "/", fileId, ".html"].join('');

	switch(fileType) {
		case 'pdf':
			convertPDF(sourcePath, targetPath, function(err) {
				return callback(err, data,fileType, fileId);
			});
		break;
		case 'doc':
			convertDOC(sourcePath, targetPath, function(err) {
				return callback(err, data,fileType, fileId);
			});
		break;
		default:
			return callback('Unable to convert unknown file type: ' + fileType);
		break;
	}
}


function convertPDF(sourcePath, targetPath, callback) {

	var pdfConverted = new pdftohtml(sourcePath, targetPath);
	pdfConverted.preset('default');

	pdfConverted.success(function() {
		return callback(null);
	});

	pdfConverted.error(function(error) {
		return callback(error);
	});

	pdfConverted.convert();
}

function convertDOC(sourcePath, targetPath, callback) {

	mammoth.convertToHtml({
		path: sourcePath
	}).then(function(result) {
		var html = result.value;
		var messages = result.messages;

		if (messages)
			console.log("Mammoth Messages:", messages);

		fs.writeFileSync(targetPath, html);

		return callback(null);
	})
	.done();
}

var extractTitle = function(data, fileType, fileId, callback) {
	console.log('extractTitle() fileId:', fileId);

	parseDOM(fileId, function(error, title) {
		if (error)
			return callback(error)

		if (title) {
			// We found the title
			return callback(null, data, fileType, fileId, title);
		} else {
			// Try another attempt at retreiving the title.
			console.log('-ANOTHER ATTEMPT-');
			return callback(null, data, fileType, fileId, 'no-title');
		}

	});

}

function parseDOM(fileId, callback) {

	var pageUrl = "http://localhost:5000/view/" + fileId;
	console.log('pageUrl', pageUrl);

	async.waterfall([

		// Initialize PhantomJS
		function(cb) {
			phantom.create(function (ph) {
				cb(null, ph);
			});
		},

		// Create page
		function(ph, cb) {
			ph.createPage(function (page) {
				cb(null, ph, page);
			});
		},

		// Open Page
		function(ph, page, cb) {
		    page.open(pageUrl, function (status) {
		    	if (status == 'fail')
		    		return cb("Failed to load " + pageUrl + " - Status: " + status);
		    	cb(null, ph, page, status);
		    });
		},

		// Inject Jquery
		function(ph, page, status, cb) {
			page.includeJs("http://code.jquery.com/jquery-1.8.3.min.js", function() {
				cb(null, ph, page, status);
			});
		},

		// Process page
		function(ph, page, status, cb) {

			page.evaluate(domPayload, function (result) {
				return cb(null, ph, page, status, result);
			});

		}

	], function (error, ph, page, status, title) {

		callback(error, title);

	});

};

var domPayload = function() {

	var topScore = 0;
	var topText = null;

	var sizes = [];
	$("*").each(function() {
		var text = $(this).text();
		var fontSize = parseInt($(this).css('font-size'));
		var boldMultiplier = $(this).css('font-weight') === 'bold' ? 0.15 : 0;
		var fontScore = fontSize + (fontSize * boldMultiplier);

		if (fontScore > topScore) {
			topScore = fontScore;
			topText = text;
		}

		var el = {
			tag: $(this).prop('tagName'),
			weight: $(this).css('font-weight'),
			size: parseInt($(this).css('font-size')),
			text: $(this).text()
		};

		sizes.push(el);
	});

	console.log('topText => ', topText);
	return topText;
//	return { sizes: sizes, topText: topText };

};
