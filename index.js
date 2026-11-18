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

// This function returns the player scores for:
// a certain course (if holeID is empty), or
// a certain hole in a course (if neither argument is empty).
function fetchLeaderboard(courseName, holeID) {
	let databaseQuery = '';

	if (holeID == '') {
		databaseQuery = 'SELECT * FROM `player_scores_course` WHERE `course_name` = `';
		databaseQuery += courseName + '`';
	} else {
		databaseQuery = 'SELECT * FROM `player_scores_hole` WHERE `hole_id` = `';
		databaseQuery += holeID + '` AND `course_name` = `';
		databaseQuery += courseName + '`';
	}

	// This will become a list of dictionaries where each
	// key is the column name and the value is the its value.
	let databaseQueryResult = null;
	(error, results, fields) => {
		// Any error will crash the web server.
		// A database query that returns nothing will not fail; it
		// will just return an empty array.
		if (error) throw error;
		databaseQueryResult = results;
	}

	return databaseQueryResults;
}

// Returns a list of holes given a course name.
// A course could have any number of holes, so it is unknown how many
// leaderboard pages will be needed to display the scores for each hole.
// These results could populate a dropdown in the client that allows a player
// to select which hole to view the leaderboard of.
function fetchCourseHoles(courseName) {
	databaseQuery = 'SELECT `hole_id` FROM `holes` WHERE `course_name` = `';
	databaseQuery += courseName + '`';

	let databaseQueryResult = null;

	(error, results, fields) => {
		// Crashes on error.
		// Results will be an empty array if no records are found.
		if (error) throw error;
		databaseQueryResult = results;
	}

	return databaseQueryResults;
}

// Defines the behavior of the web server.
// This does not start the server: that is done by listen().
// The response is sent when an end() call is reached.
// The end() function effectively acts as a 'return'.
// This function is ugly and non-functional.
const webServer = http.createServer((request, response) =>{
	// Request urls will be in a '/x/y/z' format
	// Therefore, splitting by '/' should leave an
	// empty element at position 0.
	let requestURLSplit = request.url.split('/');
	let operationResult = null;
	let errorMessage = '';

	switch(request.method) {
		case "GET":
			// /holes/'course_name' should return the course's hole IDs.
			if (requestURLSplit.Count == 3 &&
				requestURLSplit[0] == '' &&
				requestURLSplit[1] == 'holes' &&
				requestURLSplit[2] != '') {
				operationResult = fetchCourseHoles(requestURLSplit[2]);
				break;
			}

			// /leaderboard/course/ should return the leaderboard for the course.
			// /leaderboard/course/n should return the leaderboard for the nth hole.
			if (requestURLSplit.Count == 4 &&
				(requestURLSplit[0] != '' ||
				requestURLSplit[1] != 'leaderboard' ||
				requestURLSplit[2] != 'course' ||
				(requestURLSplit[3] != '' &&
				!isNaN(requestURLSplit[3])))) {
				errorMessage = 'URL of GET requests should be "/leaderboard/course/*"';
				break;
			}
	}

	// The game client should look for the 'error' field to know when an error has occured.
	if (errorMessage != '') {
		response.writeHead(400, {'content-type': 'application/json'});
		response.end(JSON.strisngify({error: errorMessage}));
	}

	// Only reasonable operation left.
	operationResult = fetchLeaderboard(requestURLSplit[2], requestURLSplit[3]);
	response.writeHead(200, {'content-type': 'application/json'});
	response.end(operationResult);
});

// Begins accepting connections on the given port and address.
// An address of 0.0.0.0 means any available interface.
webServer.listen(webServerPort, webServerIPAddress);
