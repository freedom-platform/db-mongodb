
// TODO: Relocate this to `github.com/freedom-platform/db` to provide generic DB module
//		 that we subclass here.
// TODO: Implement file-based status tracker so multiple instances can access same DB
//		 with only allowing one startup instance and queuing other requests etc...
//		 Statuses: stopped, starting, running, terminating, error
//		 `error` requires manual recovery.

const PINF = require("pinf").for(module);
const PATH = require("path");
const FS = require("sm-util/lib/fs");
const OS = require("sm-util/lib/os");


exports.init = function (options, callback) {
	if (typeof callback === "undefined") {
		callback = options;
		options = {};
	}
	return PINF.singleton(PINF.config(options), DB, function(err, instance) {
		if (err) return callback(err);
		return instance.init(function(err, api) {
			if (err) return callback(err);
			return callback(null, instance, api);
		});
	});
}


var DB = function() {}
DB.prototype.__construct = function(callback) {
	var self = this;
	if (self.config.url) {
		// We have a remote DB that we do not manage and just connect to.
		if (typeof self.config.database !== "string") {
			return callback(new Error("`database` config option must be set"));
		}
	} else
	if (self.config.host) {
		// We have a remote DB that we do not manage and just connect to.
		if (typeof self.config.database !== "string") {
			return callback(new Error("`database` config option must be set"));
		}
		self.config.port = self.config.port || 27017;
		self.config.username = self.config.username || "root";
		if (typeof self.config.password !== "string") {
			return callback(new Error("`password` config option must be set"));
		}
	} else {
		// We have a local DB which we do manage.
		self.config.dataPath = self.config.dataPath || PINF.path(self.config, "data", "db");
		self.config.logPath = self.config.logPath || PINF.path(self.config, "log", "", "mongod.log");
		self.config.confPath = self.config.confPath || PINF.path(self.config, "conf", "", "mongod.conf");
		self.config.pidPath = self.config.pidPath || PINF.path(self.config, "pid", "", "mongod.pid");
	
		self.config.host = self.config.host || "127.0.0.1";
		self.config.database = self.config.database || "default";
		// TODO: Get random port.
		self.config.port = self.config.port || 27017;
	}
	return callback(null);
}

DB.prototype.isRunning = function(callback) {
	if (this.config.confPath) {
		return OS.isPidAlive(this.config.pidPath, function(err, alive) {
			if (err) return callback(err);
			if (!alive) {
				// TODO: Check if process is alive with different pid by grepping
				//		 process list with config path. This may happen if multiple
				//       mongo instances with same conf file get started. For some reason
				//		 the pidfile will not contain pid of mongod process that ends up running.
			}
			return callback(null, alive);
		});
		return callback(null, false);
	} else {
		// We are connecting to a remote mongodb and assume it is running.
		// TODO: Run a test to confirm?
		return callback(null, true);
	}
}

DB.prototype.init = function(callback) {
	var self = this;
	function finalize(callback) {
		return self.getApi(function(err, api) {
			if (err) return callback(err);
			return callback(null, api);
		});
	}
	function writeConfig(callback) {
		// @see http://docs.mongodb.org/manual/reference/configuration-options/
		var config = [
			"dbpath = " + self.config.dataPath,
			"logpath = " + self.config.logPath,
			"logappend = true",
			"pidfilepath = " + self.config.pidPath,
			"fork = true",
			"verbose = " + (self.config.verbose ? "true" : "false")
		];
		try {
			FS.writeFileSync(self.config.confPath, config.join("\n"));
		} catch(err) {
			return callback(err);
		}
		return callback(null);
	}
	return self.isRunning(function(err, running) {
		if (err) return callback(err);
		if (running) return finalize(callback);
		if (self.config.confPath) {
			// We need to manage mongodb locally.
			return PINF.resolve("mongodb-" + process.platform, function(err) {
				if (err) return callback(err);
				return writeConfig(function(err) {
					if (err) return callback(err);

					FS.removeSync(self.config.pidPath);

					return OS.exec(PATH.join(__dirname, ".sm/bin/mongod") + " --config " + self.config.confPath, {
						cwd: PATH.dirname(self.config.confPath)
					}).then(function() {

						// TODO: Wait until mongodb is up.

						setTimeout(function() {
							self.anchorInstance(self.config.pidPath, function(err) {
								if (err) return callback(err);

								return finalize(callback);
							});
						}, 500);
					}, callback);
				});
			});
		} else {
			// We don't need to manage mongodb.
			return finalize(callback);
		}
	});
}

DB.prototype.exit = function(callback) {
	var self = this;
	return self.isRunning(function(err, running) {
		if (err) return callback(err);
		if (!running) return callback(null);
		if (self.config.confPath) {
			// TODO: Set status to terminating.
			process.kill(parseInt(FS.readFileSync(self.config.pidPath).toString()), "SIGTERM");
			// TODO: Monitor process and update status once stopped.
		}
		return callback(null);
	});
}

DB.prototype.getApi = function(callback) {
	var self = this;
	return PINF.require("api-" + self.config.api, function(err, nativeApi) {
		if (err) return callback(err);

		// TODO: Put this code into adapter modules.

		if (self.config.api === "mongoose") {
			nativeApi.connection.on("error", callback);
			nativeApi.connection.on("open", function() {
				return callback(null, nativeApi);
			});
			if (self.config.url) {
				return nativeApi.connect(self.config.url, self.config.database);
			} else {
				var opts = {};
				if (typeof self.config.username === "string") {
					opts.user = self.config.username;
					opts.pass = self.config.password;
				}
				return nativeApi.connect(self.config.host, self.config.database, self.config.port, opts);
			}
		} else {
			return callback(new Error("NYI: API adapter for '" + self.apiName + "'"));
		}
	});
}

