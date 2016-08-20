# BattlenetTS

BattlenetTS allowes you to use battle.net OAuth2 to authenticate users against your TeamsSpeak3 server. The battlenet api is invoked to check if te authenticated user is a member of a guild on a specified realm. This allows you to make sure that your guild's teamspeak server is used by the people that are in your guild.

## Features
 - Connect to a teamspeak's server query
 - Authenticates users against the battle.net api
 - Manipulate users in teamspeak based on the result of the authentication
 - Send teamspeak private text messages
 - Add or remove users from teamspeak groups based on group name

## Todo
 - Get detailed guild information from the battle.net api
 - Grant groups based off the users ingame character's role
 - Select a character (if more than one found in guild) to authenticate against

## Initialization

```javascript
var BattleTS = require('battlenet-ts');

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
```

## EventEmitter

Since BattleTS is an eventemitter you can listen for the following events
- teamspeak.connected - The server query client is successfully connected to the teamspeak server
- teamspeak.client.connected (client) - A client is connected to our teamspeak server.
- battlenet.user.authenticated (profile) - A client is successfully authenticated against the battle.net api
- battlenet.user.verified (character) - A client is successfully verified as being part of the guild/realm
- battlenet.user.notverified (error) - A client is not verified as being part of the guild/realm

## Example

```javascript
var BattleTS = require('battlenet-ts'),
	Datastore    = require('nedb'),
    db           = new Datastore({ filename: './database.db' });

// I added nedb since its a pretty cool tool as a database, no need for any 3rd party software

var fw = new BattleTS({
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

fw.on('teamspeak.connected', function(tsClient) {

	// The serverquery login is successful, commands can now be sent and received.

	console.log('Teamspeak Connected');

	fw.getGroup("grunt", function(err, group) {
		// group is undefined if the group does not exist
		console.log(group);
	});

})

fw.on('express.started', function(port, protocol){
 
	// The webserver (expressjs) is started and reachable on the specified url

	console.log("Express running on port " + port);
});

fw.on('teamspeak.client.connected', function(client) {
	// thing to note, the clid changes on every connection
	// the cluid is the unique id of the identity of the client

	var clid  = client.clid;
	var cluid = client.client_unique_identifier;

	// check if cluid is used before, and check if it has a profile stored, if so, use fw.verifyUser(profile)
	// to make sure this user is still a member of the guild, if not, remove them form the database, strip privilages
	// and ask to reauthentiate

	/*
	psuedocode:
	getClientProfile(cluid, function(profile) {
		// Profile has to contain the following properties:
		// profile.clid
		// profile.cluid
		if (profile) {
			fw.verifyUser(profile);
		} else {
			// no profile found, send auth url
			fw.send(client, 'Hello there, Please click [url=' + fw.getAuthUrl(clid, cluid) + ']here[/url] to authenticate');
		}
		// ^ this will fire the battlenet.user.(not)verified events
	})
	*/

	// first parameter of send can either be a clid, client or profile instance
	fw.send(client, 'Hello there, Please click [url=' + fw.getAuthUrl(clid, cluid) + ']here[/url] to authenticate');
});

fw.on('battlenet.user.authenticated', function(profile) {

	// at this point it's a good idea to store profile somewhere, since its required for fw.verifyUser(profile)
	// the verification will happen automatically after authentication, but not on client join.
	// since framework does not keep a database (that is your job)

	console.log(profile);
});

fw.on('battlenet.user.verified', function(character) {
	// The user is a member of our guild :)
	// Time to give them some privilages (change group or something, add icon that represents their race/class)
	// or whatever fancy you can come up with

	// Set the group for this dbid to something that has access to more stuff
	// Note that the group name is case insensitive
	fw.setGroup(character.profile.cluid, "grunt");

	// You could even create a database with 'admins' that contains battlenet id's to add those people to
	// the correct admin group.
	
	fw.send(character.profile.clid, character.name + ", you are successfully verified and promoted to Grunt");
});

fw.on('battlenet.user.notverified', function(error) {
	// strip privilages if any

	fw.unsetGroup(error.profile.cluid, "grunt");
	fw.send(error.profile, error.profile.battletag + ' does not have any characters in ' + fw.getGuildName() + ' on ' + fw.getRealmName());
});


/*
This does the same as the above listener
fw.on('battlenet', function(subject, action, profile) {
	console.log(subject); // == 'user'
	console.log(action);  // == 'authenticated'
	console.log(profile);
});
*/

fw.connect();
```

### Note from author
I had to create a ssl certificate to be able to use the battle.net api
```bash
openssl genrsa -des3 -out server.key 1024
openssl req -new -key server.key -out server.csr
cp server.key server.key.org
openssl rsa -in server.key.org -out server.key
openssl x509 -req -days 365 -in server.csr -signkey server.key -out server.crt
rm server.key.org
```