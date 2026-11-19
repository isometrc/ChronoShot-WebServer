const mysql = require('mysql2');
const filesystem = require('fs');
const http = require('http');

// Information required to connect to the database.
let databaseHost = 'chronoshot.cfagcw8agffe.us-east-2.rds.amazonaws.com';
let databasePort = 22522;
let databaseCertificate = filesystem.readFileSync('./certificates/global-bundle.pem');
let leaderboardDatabase = 'leaderboard';

// The database login credentials should be set as environment variables.
// This prevents login credentials from being displayed in GitHub.
let databaseUsername = process.env.CHRONOSHOT_DB_USERNAME;
let databasePassword = process.env.CHRONOSHOT_DB_PASSWORD;

// Configuration information for the web server the ChronoShot game clients
// will communicate with to indirectly access database information.
let webServerIPAddress = "0.0.0.0";
let webServerPort = 80;

// General configuration information.
const maxRecords = 50;

// This only prepares the connection using the above information.
// It does not begin the connection yet.
const mysqlConnection = mysql.createConnection({
	host: databaseHost,
	port: databasePort,
	user: databaseUsername,
	password: databasePassword,
	ssl: {ca: databaseCertificate},
	database: leaderboardDatabase
});

// The connection is actually started here, with the argument being
// the function called when the connection process has been completed
// (successfully or not). "error" is only filled if not.
mysqlConnection.connect(function(error) {
	if (error) throw error;

	console.log('Connected to the leaderboard database.');
});

// Returns the ID of the first course found with the same name as courseName.
function fetchCourseID(courseName) {
	let databaseQuery = 'SELECT course_id FROM courses WHERE course_name = ? LIMIT 1';
	let values = [courseName];
	let requestResult = null;

	mysqlConnection.execute(databaseQuery, values, (error, rows, rowsMetadata) => {
		if (error) throw error;
		requestResult = rows[0]['course_id'];
	});

	return requestResult;
}

// Returns the number of holes in the course with course the given courseID.
function fetchCourseHoleCount(courseID) {
	// limit is probably unnecessary, as the course_id is the primary key.
	let databaseQuery = 'SELECT holes from courses WHERE course_id = ? LIMIT 1';
	let values = [courseID];
	let requestResult = null;

	mysqlConnection.execute(databaseQuery, values, (error, rows, rowsMetadata) => {
		if (error) throw error;
		requestResult = rows[0]['holes'];
	});

	return requestResult;
}

// Returns a list of a list of key-value pairs where index 0 is the list of
// cumulative score stats records across all the holes in the course and
// indices 1, 2, 3... are the lists of specific hole score stats records.
function fetchLeaderboard(courseName) {
	let databaseQuery = '';
	let values = [];
	let requestResponse = {};
	let courseID = fetchCourseID(courseName);

	// Gets cumulative score stats records for the course.
	// These records are stored at index 0 of the response object.
	databaseQuery = 'SELECT (name, score, hits, time_spent) FROM player_course_scores WHERE course_id = ? LIMIT ?';
	values = [courseID, maxRecords];

	mysqlConnection.execute(databaseQuery, values, (error, rows, rowsMetadata) => {
		if (error) throw error;
		requestResponse[0] = rows;
	});

	// Gets score stats records for each hole in the course.
	// <holeNumber>'s records are stored in the <holeNumber> index in the response object.
	let holeCount = fetchCourseHoleCount(courseID);

	for (let i = 0; i < holeCount + 1; i++) {
		databaseQuery = 'SELECT (name, score, hits, time_spent) FROM player_hole_scores WHERE course_id = ? AND hole_id = ? LIMIT ?';
		values = [courseID, i, maxRecords];

		mysqlConnection.execute(databaseQuery, values, (error, rows, rowsMetadata) => {
			if (error) throw error;
			requestResponse[i + 1] = rows;
		});
	}

	return requestResponse;
}

// Inserts a cumulative or hole-specific list of results into the leaderboard.
function addResultsToLeaderboard(resultsJSON, courseName, holeNumber, cumulative) {
	let results = JSON.parse(resultsJSON);
	let databaseQuery = "";
	let values = [];
	let insertedCount = 0;
	let courseID = fetchCourseID(courseName);

	if (cumulative)
		databaseQuery = 'INSERT INTO player_course_scores (name, score, hits, time_spent, course_id) VALUES (?, ?, ?, ?, ?)';
	else
		databaseQuery = 'INSERT INTO player_hole_scores (name, score, hits, time_spent, course_id, hole_id) VALUES (?, ?, ?, ?, ?, ?)';

	for (let i = 0; i < results.length; i++) {
		values = [
			cumulativeResults[i]['PlayerName'],
			cumulativeResults[i]['PlayerScore'],
			cumulativeResults[i]['PlayerHits'],
			cumulativeResults[i]['PlayerTimeSpent'],
			courseID
		];

		if (cumulative) values.push(holeNumber);

		mysqlConnection.execute(databaseQuery, values, (error, result, resultMetadata) => {
			if (error) throw error;
			insertedCount += result['affectedRows'];
		});
	}

	return insertedCount;
}

// Defines the behavior of the web server.
// This does not start the server: that is done by listen().
// The response is sent when an end() call is reached.
const webServer = http.createServer((request, response) =>{
	// Request urls will be in a '/x/y/z' format
	// Therefore, splitting by '/' should leave an
	// empty element at position 0.
	let requestURLSplit = request.url.split('/');
	let errorMessage = 'Unspecified error with request.';

	if (request.method == 'GET') {
		// Course leaderboard requests should be in /leaderboard/courseName format.
		if (requestURLSplit.length == 3 &&
			requestURLSplit[1] == 'leaderboard' &&
			requestURLSplit[2].length != 0) {
			let operationResult = fetchLeaderboard(requestURLSplit[2]);

			response.writeHead(200, {'content-type': 'application/json'});
			response.end(JSON.stringify(operationResult));

			return;
		} else {
			// The game client should look for the 'error' field to know when an error has occured.
			if (errorMessage != '') {
				response.writeHead(400, {'content-type': 'application/json'});
				response.end(JSON.stringify({error: errorMessage}));

				return;
			}
		}
	} else if (request.method == 'POST') {
		// Handles posting a cumulative record to the database.
		// The request's URI should be '/leaderboard/courseName'
		if (requestURLSplit.length == 3 &&
			requestURLSplit[1] == 'leaderboard' &&
			requestURLSplit[2].length != 0) {
			// The data will not be sent all at once, but in chunks.
			let data = '';
			request.on('data', chunk => {data += chunk.toString()});

			// Called once all the data has been received.
			request.on('end', () => {
				let insertedCount =
					addResultsToLeaderboard(data,
					requestURLSplit[2],
					0,
					true);

				response.writeHead(200, {'content-type': 'application/json'});
				response.end(JSON.stringify({inserted: insertedCount}));

				success = true;
			});

			return;
		} else {
			// The game client should look for the 'error' field to know when an error has occured.
			if (errorMessage != '') {
				response.writeHead(400, {'content-type': 'application/json'});
				response.end(JSON.stringify({error: errorMessage}));

				return;
			}
		}

		// Handles posting results related to a specific hole to the database.
		// The request's URI should be '/leaderboard/courseName/holeNumber'
		if (requestURLSplit.length == 4 &&
			requestURLSplit[1] == 'leaderboard' &&
			requestURLSplit[2].length != 0 &&
			!isNaN(requestURLSplit[3])) {
			// Data sent in chunks, not all at once.
			let data = '';
			request.on('data', chunk => {data += chunk.toString()});

			// Called once all the data has been received.
			request.on('end', () => {
				let insertedCount = addResultsToLeaderboard(data,
					requestURLSplit[2],
					requestURLSplit[3],
					false);

				response.writeHead(200, {'content-type': 'application/json'});
				response.end(JSON.stringify({inserted: insertedCount}));

				success = true;
			});

			return;
		} else {
			// The game client should look for the 'error' field to know when an error has occured.
			if (errorMessage != '') {
				response.writeHead(400, {'content-type': 'application/json'});
				response.end(JSON.stringify({error: errorMessage}));

				return;
			}
		}
	}

});

// Begins accepting connections on the given port and address.
// An address of 0.0.0.0 means any available interface.
webServer.listen(webServerPort, webServerIPAddress);
