var BattleTS = require('./battlenet-ts'),
	Datastore    = require('nedb'),
    db           = new Datastore({ filename: './database.db' });

// I added nedb since its a pretty cool tool as a database, no need for any 3rd party software

var bts = new BattleTS({
	url: 'https://localhost:3000',

	battlenet_key:    '',
	battlenet_secret: '',

	ssl_ca:   './server.csr',
	ssl_cert: './server.crt',
	ssl_key:  './server.key',

	teamspeak_ip:        '',
	teamspeak_queryport: '10011',

	teamspeak_username: 'serveradmin',
	teamspeak_password: '',
	teamspeak_botname:  'SuperAdmin',
	
	realm_name: '',
	guild_name: '',
});

bts.on('teamspeak.connected', function(tsClient) {

	// The serverquery login is successful, commands can now be sent and received.

	console.log('Teamspeak Connected');

	bts.getGroup("grunt", function(err, group) {
		// group is undefined if the group does not exist
		console.log(group);
	});

})

bts.on('express.started', function(port, protocol){
 
	// The webserver (expressjs) is started and reachable on the specified url

	console.log("Express running on port " + port);
});

bts.on('teamspeak.client.connected', function(client) {
	// thing to note, the clid changes on every connection
	// the cluid is the unique id of the identity of the client

	var clid  = client.clid;
	var cluid = client.client_unique_identifier;

	// check if cluid is used before, and check if it has a profile stored, if so, use bts.verifyUser(profile)
	// to make sure this user is still a member of the guild, if not, remove them form the database, strip privilages
	// and ask to reauthentiate

	/*
	psuedocode:
	getClientProfile(cluid, function(profile) {
		// Profile has to contain the following properties:
		// profile.clid
		// profile.cluid
		if (profile) {
			bts.verifyUser(profile);
		} else {
			// no profile found, send auth url
			bts.send(client, 'Hello there, Please click [url=' + bts.getAuthUrl(clid, cluid) + ']here[/url] to authenticate');
		}
		// ^ this will fire the battlenet.user.(not)verified events
	})
	*/

	// first parameter of send can either be a clid, client or profile instance
	bts.send(client, 'Hello there, Please click [url=' + bts.getAuthUrl(clid, cluid) + ']here[/url] to authenticate');
});

bts.on('battlenet.user.authenticated', function(profile) {

	// at this point it's a good idea to store profile somewhere, since its required for bts.verifyUser(profile)
	// the verification will happen automatically after authentication, but not on client join.
	// since framework does not keep a database (that is your job)

	console.log(profile);
});

bts.on('battlenet.user.verified', function(character) {
	// The user is a member of our guild :)
	// Time to give them some privilages (change group or something, add icon that represents their race/class)
	// or whatever fancy you can come up with

	// Set the group for this dbid to something that has access to more stuff
	// Note that the group name is case insensitive
	bts.setGroup(character.profile.cluid, "grunt");

	// You could even create a database with 'admins' that contains battlenet id's to add those people to
	// the correct admin group.
	
	bts.send(character.profile.clid, character.name + ", you are successfully verified and promoted to Grunt");
});

bts.on('battlenet.user.notverified', function(error) {
	// strip privilages if any

	bts.unsetGroup(error.profile.cluid, "grunt");
	bts.send(error.profile, error.profile.battletag + ' does not have any characters in ' + bts.getGuildName() + ' on ' + bts.getRealmName());
});


/*
This does the same as the above listener
bts.on('battlenet', function(subject, action, profile) {
	console.log(subject); // == 'user'
	console.log(action);  // == 'authenticated'
	console.log(profile);
});
*/

bts.connect();
