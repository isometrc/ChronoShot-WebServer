const mysql = require('mysql2');
const filesystem = require('fs');

// Information required to connect to the database.
let databaseHost = 'chronoshot.cfagcw8agffe.us-east-2.rds.amazonaws.com';
let databasePort = 22522;
let databaseCertificate = filesystem.readFileSync('./certificates/global-bundle.pem');
let leaderboardDatabase = 'leaderboard';

// The database login credentials should be set as environment variables.
// This prevents login credentials from being displayed in GitHub.
let databaseUsername = process.env.CHRONOSHOT_DB_USERNAME;
let databasePassword = process.env.CHRONOSHOT_DB_PASSWORD;

// This only prepares the connection using the above information.
// It does not begin the connection yet.
let mysqlConnection = mysql.createConnection({
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
