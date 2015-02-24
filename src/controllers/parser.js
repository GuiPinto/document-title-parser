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

	], function (err, data, fileType, fileId, results) {
		if (err)
			return callback(err);

	 	console.log('err', err);
	 	console.log('fileType', fileType);
	 	console.log('fileId', fileId);
	 	console.log('results', results);

	 	return callback(err, {
	 		err: err,
	 		fileType: fileType,
	 		fileId: fileId,
	 		results: results
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

	var pageUrl = "http://localhost:3000/view/" + fileId;
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

		// Parse page and retrieve snippets
		function(ph, page, status, cb) {

			page.evaluate(domPayload, function (snippets) {
				return cb(null, ph, page, status, snippets);
			});

		}

	], function (error, ph, page, status, snippets) {

		// With our snippets, lets process them and gather our confidence scores
		async.series([

			// Attempt 1. Detect title based on font size
		    function(callback){
		    	detectByFontSize(snippets, callback)
		    },

		    // Attempt 2. Detect title based on Title Case
		    function(callback){
		    	detectByTitleCase(snippets, callback)
		    },

		    // Attempt 3. Detect title based on the first title case found
		    function(callback){
		    	detectByFirstTite(snippets, callback)
		    },

		],
		function(err, results) {

			// Sort our final result set by confidence (desc.)
			results = results.sort(function(a, b) {
				if (a.confidence > b.confidence) return -1;
				if (a.confidence < b.confidence) return 1;
				return 0;
			});

			return callback(null, data, fileType, fileId, results);

		});

	});

};

/*****
** domPayload gets injected into the phandomJS instance and runs on an
** entirely different enviroment than other methods in this file.
** Remember to not use any references or dependencies other than plain vanilla JS!
*****/
var domPayload = function() {

	var boldList = ['bold', 'bolder', '600', '700', '800', '900'];

	var topScore = 0;
	var topText = null;

	var elements = [];
	$("*").each(function() {
		var text = $(this).text();
		var size = parseInt($(this).css('font-size'));
		var bold = boldList.indexOf($(this).css('font-weight')) !== -1;
		var tag = $(this).prop('tagName').toLowerCase();

		// Pre-treat our text value
		// Trim it
		text = text.trim();
		// Clean it
		text = text.replace(/\s{2,}/g,' ');

		var el = {
			tag: tag,
			bold: bold,
			size: size,
			text: text
		};

		elements.push(el);
	});

	return elements;

};

function detectByFontSize(snippets, callback) {
	if (!snippets || snippets.length == 0) return callback(null, null);
	var normalTitleCharRanges = [1, 80];
	var normalTitleWordRanges = [2, 30];

	// Copy it
	snippets = snippets.slice(0);

	// First, lets filter our snippets that don't pass our normal ranges
	snippets = snippets.filter(function(snippet) {
		var l = snippet.text.length, wl = snippet.text.split(' ').length;
		return (
			l >= normalTitleCharRanges[0] &&  l <= normalTitleCharRanges[1] &&
			wl >= normalTitleWordRanges[0] && wl <= normalTitleWordRanges[1]
		);
	});

	// Now, lets collect sizes and size distribution!
	var sizes = [];
	var sizeDistribution = {};
	snippets.forEach(function(snippet) {
		sizes.push(snippet.size);
		if (!sizeDistribution[snippet.size]) sizeDistribution[snippet.size] = 0;
		sizeDistribution[snippet.size]++;
	});

	// Calculate our size sum and average
	var sizesSum = sizes.reduce(function(a, b) { return a + b; });
	var sizesAvg = sizesSum / sizes.length;

	// Now, measure our positive dist from avg
	snippets.forEach(function(snippet) {
		snippet.distToAvg = snippet.size - sizesAvg;
	});

	// Sort by distance to average
	snippets.sort(function(a, b) {
		if (a.distToAvg > b.distToAvg) return -1;
		if (a.distToAvg < b.distToAvg) return 1;
		return 0;
	});

	// And sample our item with the largest font size
	var largestSnippet = snippets[0];
	var confidence = 0;

	// Lastly, if this is the largest font in the document
	// Lets return high confidence
	if (sizeDistribution[largestSnippet.size] == 1) {
		if (isTitleCase(largestSnippet.text)) {
			confidence = 100;
		} else {
			confidence = 80;
		}
	} else {
		if (isTitleCase(largestSnippet.text)) {
			confidence = 80;
		} else {
			console.log('ok');
			console.log('isTitleCase(largestSnippet.text) => ', isTitleCase(largestSnippet.text));
			console.log('largestSnippet.text', '"' + largestSnippet.text + '"');
			confidence = Math.min(80 - (sizeDistribution[largestSnippet.size] * 2), 20);
		}
	}

	return callback(null, {
		confidence: confidence,
		snippet: largestSnippet,
		source: 'font-size'
	});
};


function detectByTitleCase(snippets, callback) {
	if (!snippets || snippets.length == 0) return callback(null, null);
	var normalTitleCharRanges = [1, 80];
	var normalTitleWordRanges = [2, 30];

	// Copy it
	snippets = snippets.slice(0);

	// First, lets filter our snippets that don't pass our normal ranges
	snippets = snippets.filter(function(snippet) {
		var l = snippet.text.length, wl = snippet.text.split(' ').length;
		return (
			l >= normalTitleCharRanges[0] &&  l <= normalTitleCharRanges[1] &&
			wl >= normalTitleWordRanges[0] && wl <= normalTitleWordRanges[1]
		);
	});

	// Now, lets collect our snippets that have title case
	var titleSnippets = {};
	snippets.forEach(function(snippet) {
		if (isTitleCase(snippet.text))
			titleSnippets[snippet.text] = snippet;
	});

	// If we have a single title-match
	var titleSnippetKeys = Object.keys(titleSnippets);
	if (titleSnippetKeys.length == 1) {
		return callback(null, {
			confidence: 100,
			snippet: titleSnippets[titleSnippetKeys[0]],
			source: 'title-case'
		});
	} else {
		return callback(null, {
			confidence: 0,
			snippet: null,
			source: 'title-case'
		});
	}

};


function detectByFirstTite(snippets, callback) {
	if (!snippets || snippets.length == 0) return callback(null, null);
	var normalTitleCharRanges = [1, 80];
	var normalTitleWordRanges = [2, 30];

	// Copy it
	snippets = snippets.slice(0);

	// First, lets filter our snippets that don't pass our normal ranges
	snippets = snippets.filter(function(snippet) {
		var l = snippet.text.length, wl = snippet.text.split(' ').length;
		return (
			l >= normalTitleCharRanges[0] &&  l <= normalTitleCharRanges[1] &&
			wl >= normalTitleWordRanges[0] && wl <= normalTitleWordRanges[1]
		);
	});

	// Now, lets collect our snippets that have title case
	var titleSnippets = {};
	snippets.forEach(function(snippet) {
		if (isTitleCase(snippet.text))
			titleSnippets[snippet.text] = snippet;
	});

	// If we have a single title-match
	var titleSnippetKeys = Object.keys(titleSnippets);
	if (titleSnippetKeys.length > 0) {
		return callback(null, {
			confidence: Math.max(100 - (titleSnippetKeys.length * 10), 10),
			snippet: titleSnippets[titleSnippetKeys[0]],
			source: 'first-title'
		});
	} else {
		return callback(null, {
			confidence: 0,
			snippet: null,
			source: 'first-title'
		});
	}

};

function isTitleCase(title) {
	title = String(title).trim();
	if (title == '') return false;
	return title == title.toTitleCase();
}

String.prototype.toTitleCase = function(){
	var smallWords = /^(a|an|and|as|at|but|by|en|for|if|in|nor|of|on|or|per|the|to|vs?\.?|via)$/i;
	return this.replace(/[A-Za-z0-9\u00C0-\u00FF]+[^\s-]*/g, function(match, index, title){
		if (index > 0 && index + match.length !== title.length &&
			match.search(smallWords) > -1 && title.charAt(index - 2) !== ":" &&
			(title.charAt(index + match.length) !== '-' || title.charAt(index - 1) === '-') &&
			title.charAt(index - 1).search(/[^\s-]/) < 0) {
				return match.toLowerCase();
		}

		if (match.substr(1).search(/[A-Z]|\../) > -1) {
			return match;
		}

		return match.charAt(0).toUpperCase() + match.substr(1);
	});
};
