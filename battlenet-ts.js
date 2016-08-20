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

	var framework = function (options) {
		options = options || {};

		this.url                 = options ? options.url || 'http://localhost' : 'http://localhost';
		this.battlenet_key       = options ? options.battlenet_key || '' : '';
		this.battlenet_secret    = options ? options.battlenet_secret || '' : '';
		this.ssl_ca              = options ? options.ssl_ca || '' : '';
		this.ssl_cert            = options ? options.ssl_cert || '' : '';
		this.ssl_key             = options ? options.ssl_key || '' : '';

		this.teamspeak_ip        = options ? options.teamspeak_ip || '' : '';
		this.teamspeak_queryport = options ? options.teamspeak_queryport || '10011' : '10011';

		this.teamspeak_username  = options ? options.teamspeak_username || 'superadmin' : 'superadmin';
		this.teamspeak_password  = options ? options.teamspeak_password || '' : '';
		this.teamspeak_botname   = options ? options.teamspeak_botname || 'SuperAdmin' : 'SuperAdmin';

		this.realm_name			 = options ? options.realm_name || '' : '';
		this.guild_name			 = options ? options.guild_name || '' : '';

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

	framework.prototype.verifyUser = function(profile) {
		var self = this;
		bnet.account.wow({origin: 'eu', access_token: profile.token},
			function(err,body,resp) {
				if(body && body.error) {
					console.log(body.error);
					return false;
				}
				if(body && body.characters) {
					var selectedCharacter = undefined;
					body.characters.some(function(character) {
						if(character.realm == self.realm_name && character.guild == self.guild_name) {
						    character.profile = profile;
							self.emit('battlenet.user.verified',       character);
							self.emit('battlenet', 'user', 'verified', character);
							selectedCharacter = character;
							return true;
						}
					});
					if(!selectedCharacter) {
						var error   = {};
						error.profile  = profile;
						error.error = 'notfound';
						error.code  = 404;

						self.emit('battlenet.user.notverified',       error);
						self.emit('battlenet', 'user', 'notverified', error);
					}
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
			var cldbid = client.cldbid;
			self.getGroup(group, function(err, g) {
				tsClient.send('servergroupaddclient', {'sgid' : g.sgid, 'cldbid': cldbid});
			});
		})
	}

	framework.prototype.unsetGroup = function(cluid, group) {
		var self = this;

		self.getClient(cluid, function(err, client) {
			var cldbid = client.cldbid;
			self.getGroup(group, function(err, g) {
				tsClient.send('servergroupdelclient', {'sgid' : g.sgid, 'cldbid': cldbid});
			});
		})
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

					// send a command every 5 minutes to avoid losing connectin
					setInterval(function() {
						tsClient.send('clientlist', function(err, resp, req) {});
					}, ((1000*60)*5))
				})
			});
	}

	function registerTeamspeakListeners(self) {
		tsClient.on('notify.cliententerview', function(resp, data) {
			self.emit('teamspeak.client.connected',       data);
			self.emit('teamspeak', 'client', 'connected', data);
		})
	}

	function initiatePassport(self) {
		passport.use(new BnetStrategy({
		    clientID:     self.battlenet_key,
		    clientSecret: self.battlenet_secret,
		    callbackURL:  self.url + "/callback",
		    scope:        'wow.profile'
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
