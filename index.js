const mysql = require('mysql2/promise');
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
const mysqlConnection = mysql.createPool({
	host: databaseHost,
	port: databasePort,
	user: databaseUsername,
	password: databasePassword,
	ssl: {ca: databaseCertificate},
	database: leaderboardDatabase
});

// Returns the ID of the first course found with the same name as courseName.
async function fetchCourseID(courseName) {
	let databaseQuery = 'SELECT course_id FROM courses WHERE course_name = ? LIMIT 1';
	let values = [courseName];
	let requestResult = null;

	try {
		const [rows] = await mysqlConnection.execute(databaseQuery, values);
		if (rows.length > 0) requestResult = rows[0].course_id;
	} catch (error) {throw error;}

	return requestResult;
}

// Returns the ID of the first hole found with the given courseID and holeNumber.
async function fetchHoleID(courseID, holeNumber) {
	let databaseQuery = 'SELECT hole_id FROM holes WHERE course_id = ? AND hole_number = ? LIMIT 1';
	let values = [courseID, holeNumber];
	let requestResult = null;
	
	try {
		const [rows] = await mysqlConnection.execute(databaseQuery, values);
		if (rows.length > 0) requestResult = rows[0].hole_id;
	} catch (error) {throw error;}

	return requestResult;
}

// Returns the number of holes in the course with course the given courseID.
async function fetchCourseHoleCount(courseID) {
	let databaseQuery = 'SELECT hole_id FROM holes WHERE course_id = ?';
	let values = [courseID];
	let requestResult = null;
	
	try {
		const [rows] = await mysqlConnection.execute(databaseQuery, values);
		requestResult = rows.length;
	} catch (error) {throw error;}

	return requestResult;
}

// Returns a list of a list of key-value pairs where index 0 is the list of
// cumulative score stats records across all the holes in the course and
// indices 1, 2, 3... are the lists of specific hole score stats records.
async function fetchLeaderboard(courseName) {
	let databaseQuery = '';
	let values = [];
	let requestResponse = {};
	const courseID = await fetchCourseID(courseName);

	// Gets score stats records for each hole in the course.
	// holeNumber 0 refers to the cumulative total across all holes in the course.
	// <holeNumber>'s records are stored in the <holeNumber> index in the response object.
	const holeCount = await fetchCourseHoleCount(courseID);

	for (let i = 0; i < holeCount; i++) {
		const holeID = await fetchHoleID(courseID, i);
		databaseQuery = 'SELECT player_name, score, hits, time_spent FROM player_scores WHERE course_id = ? AND hole_id = ? ORDER BY score DESC LIMIT ?';
		values = [courseID, holeID, maxRecords];

		try {
			const [rows] = await mysqlConnection.execute(databaseQuery, values);
			requestResponse[i] = rows;
		} catch (error) {throw error;}
	}

	return requestResponse;
}

// Inserts a cumulative or hole-specific list of results into the leaderboard.
// Cumulative if the hole number is 0, specific to the hole number otherwise.
async function addResultsToLeaderboard(resultsJSON, courseName, holeNumber) {
	let results = JSON.parse(resultsJSON);

	let databaseQuery = 'INSERT INTO player_scores (player_name, score, hits, time_spent, course_id, hole_id) VALUES (?, ?, ?, ?, ?, ?)';
	let values = [];
	let insertedCount = 0;

	const courseID = await fetchCourseID(courseName);
	const holeID = await fetchHoleID(courseID, holeNumber);

	for (let i = 0; i < results.length; i++) {
		values = [
			results[i].PlayerName,
			results[i].PlayerScore,
			results[i].PlayerHits,
			results[i].PlayerTimeSpent,
			courseID,
			holeID
		];

		try {
			const [result] = await mysqlConnection.execute(databaseQuery, values);
			insertedCount += result.affectedRows;
		} catch (error) {throw error;}
	}

	return insertedCount;
}

// Defines the behavior of the web server.
// This does not start the server: that is done by listen().
// The response is sent when an end() call is reached.
const webServer = http.createServer(async(request, response) =>{
	// Request urls will be in a '/x/y/z' format
	// Therefore, splitting by '/' should leave an
	// empty element at position 0.
	let decodedURL = decodeURIComponent(request.url);
	let requestURLSplit = decodedURL.split('/');
	let errorMessage = 'Unspecified error with request.';

	if (request.method == 'GET') {
		// Course leaderboard requests should be in /leaderboard/courseName format.
		if (requestURLSplit.length == 3 &&
			requestURLSplit[1] == 'leaderboard' &&
			requestURLSplit[2].length != 0) {
			try {
				const operationResult = await fetchLeaderboard(requestURLSplit[2]);
			
				response.writeHead(200, {'content-type': 'application/json'});
				response.end(JSON.stringify(operationResult));

				return;
			} catch (error) {throw error;}
		} else {
			// The game client should look for the 'error' field to know when an error has occured.
			if (errorMessage != '') {
				response.writeHead(400, {'content-type': 'application/json'});
				response.end(JSON.stringify({error: errorMessage}));

				return;
			}
		}
	} else if (request.method == 'POST') {
		// Handles posting results related to a specific hole to the database.
		// If the hole number is 0, the results being stored are the cumulative
		// results (sum across all holes in a course).
		// The request's URI should be '/leaderboard/courseName/holeNumber'
		if (requestURLSplit.length == 4 &&
			requestURLSplit[1] == 'leaderboard' &&
			requestURLSplit[2].length != 0 &&
			!isNaN(requestURLSplit[3])) {
			// Data sent in chunks, not all at once.
			let data = '';
			request.on('data', chunk => {data += chunk.toString()});

			// Called once all the data has been received.
			request.on('end', async () => {
				try {
					const insertedCount = await addResultsToLeaderboard(
						data,
						requestURLSplit[2],
						requestURLSplit[3]);

					response.writeHead(200, {'content-type': 'application/json'});
					response.end(JSON.stringify({inserted: insertedCount}));
				} catch (error) {throw error;}
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
