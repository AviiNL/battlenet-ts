(function() {
	var TeamSpeak    = require('node-teamspeak-api'),
	    util         = require("util"),
        events       = require('events'),
	    express      = require('express'),
		passport     = require('passport');
		http         = require('http'),
		https        = require('https'),
		url          = require('url'),
		fs           = require('fs'),
		bnet         = require('battlenet-api')(),
		BnetStrategy = require('passport-bnet').Strategy;
	    tsClient     = new TeamSpeak('avii.nl', 10011),
	    app          = express();

    var client_table= {};

	var framework = function (options) {
		options = options || {};

		this.url                 = options.url              || 'http://localhost';
		this.battlenet_region    = options.battlenet_region || 'us';
		this.battlenet_key       = options.battlenet_key    || '';
		this.battlenet_secret    = options.battlenet_secret || '';

		this.ssl_ca              = options.ssl_ca   || '';
		this.ssl_cert            = options.ssl_cert || '';
		this.ssl_key             = options.ssl_key  || '';

		this.teamspeak_ip        = options.teamspeak_ip        || '';
		this.teamspeak_queryport = options.teamspeak_queryport || '10011';

		this.teamspeak_username  = options.teamspeak_username || 'superadmin';
		this.teamspeak_password  = options.teamspeak_password || '';
		this.teamspeak_botname   = options.teamspeak_botname  || 'SuperAdmin';

		this.realm_name			 = options.realm_name || '';
		this.guild_name			 = options.guild_name || '';

		var parsedUrl            = url.parse(this.url);
		this.listen_port         = parsedUrl.port || (parsedUrl.protocol == 'https:' ? 443 : 80);
		this.protocol            = parsedUrl.protocol.slice(0, -1);
		delete parsedUrl;

		this.teamspeak_connected = false;
	}
	util.inherits(framework, events.EventEmitter);

	// Public functions
	framework.prototype.connect = function () {
		registerTeamspeakListeners(this);
		connectTeamspeak(this);
		initiatePassport(this);
		registerExpressAuth(this);
		registerExpressCallback(this);
		startExpress(this);
	}

	framework.prototype.send = function (clid, msg) {
		var self = this;
		if (self.teamspeak_connected) {
			if(clid instanceof Object) {
				clid = clid.clid;
			}

			tsClient.send('sendtextmessage', {
				'targetmode': 1,
				'target':     clid,
				'msg':        msg
			});
		} else {
			throw "Teamspeak is not connected, unable to send messages";
		}
	}

	framework.prototype.getAuthUrl = function(clid, cluid) {
		return this.url + '/auth/' +  clid + '/' + encodeURIComponent(cluid);
	}

	framework.prototype.getGuildName = function() {
		return this.guild_name;
	}

	framework.prototype.getRealmName = function() {
		return this.realm_name;
	}

	framework.prototype.verifyUser = function(profile, characterName) {
		var self = this;
		bnet.account.wow({origin: self.battlenet_region, access_token: profile.token},
			function(err,body,resp) {
				body = body || {};
				var selectedCharacter = undefined;

				if(body.error) {
					console.log(body.error);
				}

				if(body.characters) {
					body.characters.some(function(character) {
						if(character.realm == self.realm_name && character.guild == self.guild_name && (!characterName || characterName.toLowerCase() === character.name.toLowerCase())) {
						    character.profile = profile;
							self.emit('battlenet.user.verified',       character);
							self.emit('battlenet', 'user', 'verified', character);
							selectedCharacter = character;
							return true;
						}
					});
				}

				if(!selectedCharacter) {
					var error   = {};
					error.profile  = profile;
					error.error = 'notfound';
					error.code  = 404;

					self.emit('battlenet.user.notverified',       error);
					self.emit('battlenet', 'user', 'notverified', error);
				}

			});
	}

	framework.prototype.getGroups = function(cb) {
		tsClient.send('servergrouplist', function(err,res) {
			if(cb) cb(err, res.data);
		});
	}

	framework.prototype.getGroup = function (groupname, cb) {
		tsClient.send('servergrouplist', function(err,res) {
			var foundGroup = undefined;
			res.data.some(function(group) {
				if(typeof groupname === 'string') {
					if(group.name.toLowerCase() === groupname.toLowerCase()) {
						foundGroup = group;
						return true;
					}
				} else {
					if(groupname === group.sgid) {
						foundGroup = group;
						return true;
					}
				}
			})
			if(cb) cb(err, foundGroup);
		});
	}

	framework.prototype.getClient = function(cluid, cb) {
		var self = this;
		var command = "clientlist";
		if(isNaN(parseFloat(cluid))) {
			command = "clientdblist";
		}

		tsClient.send(command, function(err,resp) {
			var foundClient = undefined;
			resp.data.some(function(client) {
				if(isNaN(parseFloat(cluid))) {
					if(client.client_unique_identifier === cluid) {
						foundClient = { nickname: client.client_nickname, cldbid: client.cldbid };
						return true;
					}
				} else {
					if (client.clid == cluid) {
						foundClient = { nickname: client.client_nickname, cldbid: client.client_database_id };
						return true;
					}
				}
			});
			if(cb) cb(err, foundClient);
		});
	}

	framework.prototype.setGroup = function(cluid, group) {
		var self = this;

		self.getClient(cluid, function(err, client) {
			if(client) {
				var cldbid = client.cldbid;
				self.getGroup(group, function(err, g) {
					tsClient.send('servergroupaddclient', {'sgid' : g.sgid, 'cldbid': cldbid});
				});
			} else {
				self.emit('error', 'Unable to find client ['+cluid+'] to set group ['+ group +']');
			}
		});

	}

	framework.prototype.unsetGroup = function(cluid, group) {
		var self = this;

		self.getClient(cluid, function(err, client) {
			var cldbid = client.cldbid;
			self.getGroup(group, function(err, g) {
				try {		
					tsClient.send('servergroupdelclient', {'sgid' : g.sgid, 'cldbid': cldbid});
				} catch(ex) {
					console.log(ex);
				}
			});
		})
	}

	framework.prototype.getGuildInfo = function(cb) {
		var self = this;

		bnet.wow.guild.members({origin: self.battlenet_region, realm: self.realm_name, name: self.guild_name}, {apikey: self.battlenet_key},
			function(err,resp,body) {
				if(cb) cb(resp);
			});
	}

	framework.prototype.getGuildMember = function(character, cb) {
		var self = this;

		self.getGuildInfo(function(data) {
			data.members.some(function(_char) {
				if(_char.character.name === character.name) {
					if(cb) cb(_char);
				}
			})
		});
	}

	framework.prototype.getCluid = function(clid) {
		return client_table[clid];
	}

	framework.prototype.getCharacters = function(profile, cb) {
		var self = this;
		bnet.account.wow({origin: self.battlenet_region, access_token: profile.token},
			function(err,body,resp) {
				body = body || {};
				var characters = [];
				if(body.characters) {
					body.characters.forEach(function(character) {
						if(character.realm == self.realm_name && character.guild == self.guild_name) {
							characters.push(character);
						}
					});
				}

				if(cb) cb(characters);

			});
	}

	// Private functions
	function connectTeamspeak(self) {
		tsClient.api.login( { client_login_name: self.teamspeak_username, client_login_password: self.teamspeak_password },
			function (err, resp, req) {
				tsClient.api.use({sid: 1}, function(err,resp,req) {
					tsClient.send('clientupdate', { client_nickname: self.teamspeak_botname });
					tsClient.subscribe({event: 'server'});
					tsClient.subscribe({event: 'textprivate'});
					self.emit('teamspeak.connected');
					self.emit('teamspeak', 'connected');
					self.teamspeak_connected = true;

					// send a command every 5 minutes to avoid losing connection
					setInterval(function() {
						tsClient.send('clientlist', function(err, resp, req) {});
					}, ((1000*60)*5));
				})
			});
	}

	function registerTeamspeakListeners(self) {
		
		tsClient.on('notify.cliententerview', function(resp, data) {

			for (var key in client_table) {
			    if(client_table[key] === data.client_unique_identifier) {
			    	delete client_table[key];
			    }
			}

			client_table[data.clid] = data.client_unique_identifier;

			self.emit('teamspeak.client.connected',       data);
			self.emit('teamspeak', 'client', 'connected', data);
		});
		tsClient.on('notify.textmessage', function(resp, data) {
			if(data.invokername !== self.teamspeak_botname) {
				self.emit('teamspeak.chat.received',       data.invokerid, data.msg);
				self.emit('teamspeak', 'chat', 'received', data.invokerid, data.msg);
			}
		})
	}

	function initiatePassport(self) {
		passport.use(new BnetStrategy({
		    clientID:     self.battlenet_key,
		    clientSecret: self.battlenet_secret,
		    callbackURL:  self.url + "/callback",
		    scope:        'wow.profile',
		    region:       self.battlenet_region
		}, function (accessToken, refreshToken, profile, done) {
		    return done(null, accessToken, profile);
		}));
	}

	function registerExpressAuth(self) {
		app.get('/auth/:clid/:cluid', function (req, res) {
			passport.authenticate('bnet', {state: JSON.stringify({ 'cluid': req.params['cluid'], 'clid': req.params['clid'] })})(req,res);
		});
	}

	function registerExpressCallback(self) {
		app.get('/callback', function (req, res) {
			if(!req.query.state) { res.send("Error"); return false; }
			var state = JSON.parse(req.query.state);

			passport.authenticate('bnet', { failureRedirect: '/error', state: state },
				function (a, accessToken, profile) {
					if(profile) {
						profile.clid  = state.clid;
						profile.cluid = decodeURIComponent(state.cluid);
						self.emit("battlenet.user.authenticated",       profile);
						self.emit("battlenet", "user", "authenticated", profile);

						self.verifyUser(profile);
					} else {
						res.send('Something went wrong...');
						return false;
					}
					res.send('<script>window.close()</script>You can close this window.');
				})(req,res);
		});
	}

	function startExpress(self) {
		if (self.protocol.endsWith('s')) {
			var options = {
				ca:   fs.readFileSync(self.ssl_ca),
				cert: fs.readFileSync(self.ssl_cert),
				key:  fs.readFileSync(self.ssl_key)
			};

			var server  = https.createServer(options, app);
			server.listen(self.listen_port, function() {
				self.emit('express.started',    self.listen_port, self.protocol);
				self.emit('express', 'started', self.listen_port, self.protocol);
			});
		} else {
			app.listen(self.listen_port, function() {
				self.emit('express.started',    self.listen_port, self.protocol);
				self.emit('express', 'started', self.listen_port, self.protocol);
			});
		}
	}

	module.exports = framework;
})();

