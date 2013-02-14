
const DB_MONGODB = require("db-mongodb");


exports.main = function(callback) {

	console.log("Start mongodb.");

	return DB_MONGODB.init(function(err, db, mongoose) {
		if (err) return callback(err);

		console.log("Mongodb started: ", db);

		var kittySchema = mongoose.Schema({
			name: String
		});

		kittySchema.methods.speak = function () {
			var greeting = this.name
				? "Meow name is " + this.name
				: "I don't have a name"
			console.log(greeting);
		}

		var Kitten = mongoose.model('Kitten', kittySchema);

		var silence = new Kitten({ name: 'Silence' })
		console.log(silence.name) // 'Silence'


		var fluffy = new Kitten({ name: 'fluffy' });
		fluffy.speak() // "Meow name is fluffy"

		fluffy.save(function (err, fluffy) {
			if (err) return callback(err);
			fluffy.speak();

			Kitten.find(function (err, kittens) {
				if (err) return callback(err);
				console.log(kittens)


				Kitten.find({ name: /^Fluff/ }, function (err, kittens) {
					if (err) return callback(err);

					console.log(kittens)

					return Kitten.collection.drop(function(err) {

						return db.exit(function(err) {
							if (err) return callback(err);

							console.log("Mongodb stopped.");

							return callback(null);
						});
					});
				});
			});
		});
	});
}


if (require.main === module) {
	exports.main(function(err) {
		if (err) {
			console.error(err.stack);
			return process.exit(1);
		}
		return process.exit(0);
	});
}
