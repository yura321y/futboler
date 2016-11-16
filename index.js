'use strict'

const express = require('express')
const bodyParser = require('body-parser')
const request = require('request')
const app = express()
const MongoClient = require("mongodb").MongoClient
let db = "" //for database scope
let events = "" //for events collection in database
let users = "" //for users collection in database
// for facebook verification 
/*it's better to setup environment variable i.e.
var verificationToken = process.env.VERIFY_TOKEN on you app's server*/
const verificationToken = process.env.VERIFY_TOKEN;
// recommended to inject access tokens as environmental variables, e.g.
// const token = process.env.PAGE_ACCESS_TOKEN
const token = process.env.PAGE_ACCESS_TOKEN;
//link to mongoDB
const mongodbLink = process.env.MONGODB_LINK;
//pageID
const pageID = process.env.MONGODB_PAGE_ID;

app.set('port', (process.env.PORT || 5000))

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({extended: false}))

// parse application/json
app.use(bodyParser.json())

/*
Functions to be used in code
*/
//fn to send back info to sender in messenger
function sendTextMessage(sender, text) {
	let messageData = { text:text }
	
	request({
		url: 'https://graph.facebook.com/v2.6/me/messages',
		qs: {access_token:token},
		method: 'POST',
		json: {
			recipient: {id:sender},
			message: messageData,
		}
	}, function(error, response, body) {
		if (error) {
			console.log('Error sending messages: ', error)
		} else if (response.body.error) {
			console.log("if interested in Error uncomment code")	
			//console.log('Error: ', response.body.error)
		}
	})
}
//
//fn to post  text to page
function addPost(pageId, text, callback) {
	request({
		url: 'https://graph.facebook.com/v2.6/me/feed',
		qs: {access_token:token},
		method: 'POST',
		json: {
			message: text,
		}
	}, function(error, response, body) {
		if (error) {
			console.log('Error posting message to page from addPost fn: ', error)
		} else if (response.body.error) {
			console.log('Error from addPost fn: ', response.body.error)
		} else {
            if (typeof callback === "function") {
                callback(body);
            }
		}
	})
}

//fn to remove posts from Page
function removePost(pageId, postId) {
	console.log("removePost fn STARTED")
	request({
		url: 'https://graph.facebook.com/v2.6/' + postId,
		qs: {access_token:token},
		method: 'DELETE',
	}, function(error, response, body) {
		console.log("URL of post to be removed: \n" + 'https://graph.facebook.com/v2.6/' + postId)
		if (error) {
			console.log('Error deleting post from page from removePost fn: ', error)
		} else if (response.body.error) {
			console.log('Error from removePost fn: ', response.body.error)
		}
	})
}

function processComment() {

}

//fn to test dates inserted in requests
function testDates(date) {
	let reg = /^\d\d\/\d\d\/\d\d\d\d$/;
	return reg.test(date);
}

//function to create event from messenger, save it to DB and post on page
function createEvent(pageID, collection, date, sender, callback) {
	console.log("Date at the beggining: " + date);
	if (date === "today" || date === "") {
		date = getCurrentDate();
	} else if (!testDates(date)) {
		sendTextMessage(sender, "NOT SAVED, date format is unrecognized. \nPlease enter valid format (i.e. DD/MM/YYYY) and try again");
		return false;
	}
	console.log("date after " + date)
	let query = objectToQuery(date, {"registered":0, "personsRegistered":[]});
	let queryTest = {};
	queryTest[date] = {$exists: true};
	collection.find(queryTest).count(function(err, ex) {
	  	if (ex) { 
		  	sendTextMessage(sender, "Event already exists"); 
		  	return false;
	  	}
		callback(query, date);
		/*
		addPost(pageID, date, function(body) { //firs published event, saved to db and added published id
        	query["id"] = body.id;
            collection.save(query, function(err, result) {
            	if (err) {
            		console.log(err);
            		removePost(pageID, body.id);
            		return false;
            	}
                console.log("saved to database");
                let t = "Event " + Object.keys(query)[0] + " created, posted and saved to database"
                sendTextMessage(sender, t)
			})
		})
		*/
	}); //trying this to find check solution http://stackoverflow.com/questions/8389811/how-to-query-mongodb-to-test-if-an-item-exists
}

//fn remove event from DB
function removeEventFromDB(collection, postId) {
      console.log("removeEventFromDB STARTED")
      let query = {};
      query["id"] = postId;
      console.log("query in removeEventFromDB: \n" + JSON.stringify(query))
      collection.remove(query);
}

//fn to get current date
function getCurrentDate() {
	let DATE = new Date();
	let today = ("0"+DATE.getDate()).slice(-2)+ "/" + ("0"+(DATE.getMonth()+ 1)).slice(-2) + "/" + DATE.getFullYear();
	return today;
}

//fn to create object to insert in find fild
function objectToQuery(field, value) {
	let obj = {};
	obj[field] = value;
	return obj;
}

//function to register person to event
function addToEvent(collection, sender, userData) {
	console.log("Fn addToEvent STARTED!!")
	let today = getCurrentDate();
	let query = {};
	query[today] = {$exists: true};
	collection.find(query).toArray(function(err,docs) {
		if (err) {sendTextMessage(sender, "Smth strange happen.\nPlease try again")}
		if (!docs.length) {sendTextMessage(sender, "Event for current date is not created! \nPlease use '/event' command to add new event for today"); return false;}
		let count = docs[0][today]["registered"];
		let persons = docs[0][today]["personsRegistered"];
		let replacement = {};
		if (!persons.length) {
			replacement[today] = {"registered": 1,
								  "personsRegistered":[userData]}
		} else {
			console.log("ELSE in persons comparison began")
			for (let j=0; j<persons.length; j++) {
				console.log("Persons last_name: " + persons[j]["last_name"])
				if (userData["last_name"] === persons[j]["last_name"]) {
					sendTextMessage(sender, "You are already registered");
					return false;
				}
			}
			count += 1;
			persons.push(userData);
			replacement[today] = {"registered":count, "personsRegistered":persons};
		}
		
		collection.findAndModify(query, //query to find 
			[], //sort order
			{$set:replacement}, //object to replace
			{}, //options
			function(err, object) {//fn to callback
				if (err) {
					console.warn(err.message);
					return false;
				} else {
					console.dir(object);
				}
			}
		)
		sendTextMessage(sender, "You have beed added!");
	})
}

//remove user from event
function removeFromEvent(collection, sender, userData) {
	console.log("Fn removeFromEvent STARTED!!")
	let today = getCurrentDate();
	let query = {};
	query[today] = {$exists: true};
	collection.find(query).toArray(function(err,docs) {
		if (err) {sendTextMessage(sender, "Smth strange happen.\nPlease try again")}
		if (!docs.length) {sendTextMessage(sender, "Event for " +today+ " is not created! \nAnd nobody can't be removed from the event:)"); return false;}
		let count = docs[0][today]["registered"];
		let persons = docs[0][today]["personsRegistered"];
		let replacement = {};
		let check = false;
		if (persons.length) {
			for (let nm=0; nm<persons.length; nm++) {
				if (persons[nm]["last_name"] === userData["last_name"]) {
					persons.splice(nm, 1);
					count-=1;
					check = true;
				}
			}
			if (!check) {
				sendTextMessage(sender, "You are not registered to the " + today + " event :( and I can't remove you from list o_O"); return false;
			} else {
				replacement[today] = {"registered": count,
								  "personsRegistered":persons}
			}
		} else {
			sendTextMessage(sender, "No one is registered to the " + today + " event")
		}
		
		collection.findAndModify(query, //query to find 
			[], //sort order
			{$set:replacement}, //object to replace
			{}, //options
			function(err, object) {//fn to callback
				if (err) {
				        console.warn(err.message);
				        return false;
				} else {
				        console.dir(object);
				}
		                   }
                                      )
		sendTextMessage(sender, "You have beed removed from the event!");
	})

}

//function to get info on all registered to the event
function showCount(collection, sender, date) {
	let today = getCurrentDate();
	let query = {};
	if (date === "today" || date === "") {
		query[today]={$exists: true}
	} else if(date === "all") {
		query = {};
	} else if (!testDates(date)) {
		sendTextMessage(sender, "Date format is unrecognized. \nPlease enter valid format (i.e. DD/MM/YYYY), relevant command (e.g. '/registered 01/01/2016' or '/registered today') and try again");
	  	return false;
	} else {
		query[date] = {$exists: true}
	}
	collection.find(query).toArray(function(err, result) {
		if (err) {return sendTextMessage(sender, "Err " +err)}
		if (!result.length) {sendTextMessage(sender, "Event for the " + today + " not found!"); return false}
		for (let nb=0; nb<result.length; nb++) {
		      let keys = Object.keys(result[nb])[1];
		      sendTextMessage(sender, "-------\nFor " + keys + " was registered: " + result[nb][keys]["registered"]+ "\n");
		}
	})
}

//function to list all registered
function listRegistered(collection, sender, date) {
	let today = getCurrentDate();
	let query = {};
	if (date === "today" || date === "") {
		date = today;
	} else if (!testDates(date)) {
		sendTextMessage(sender, "Date format is unrecognized. \nPlease enter valid format (i.e. DD/MM/YYYY), relevant command (e.g. '/registered 01/01/2016' or '/registered today') and try again");
	  	return false;
	}
	query[date] = {$exists: true};
	collection.find(query).toArray(function(err, result) {
		if (err) {return sendTextMessage(sender, "Err " +err)}
		if (!result.length) {sendTextMessage(sender, "Event for the " + today + " not found!"); return false}
		let persons = result[0][date]["personsRegistered"];
		if (!persons.length) {
			sendTextMessage(sender, "No one was registered to the event yet");
			return false;
		}
		let personsInfo = "";
		for (let b=0; b<persons.length; b++) {
			personsInfo += persons[b]["first_name"];
			personsInfo += " ";
			personsInfo += persons[b]["last_name"];
			personsInfo += "\n"
		}
		sendTextMessage(sender, "Registered for playing: \n" + personsInfo);
	})
}

//function to get user/sender details using User profile API
function getSenderData(sender, token, callback) {
	
	request({
		url: 'https://graph.facebook.com/v2.6/' + sender,
		qs: {access_token:token,
			fields: "first_name, last_name"},
		method: 'GET'
	}, function(error, response, body) {
		if (error) {
			console.log('Error is error: ', error)
		} else if (response.body.error) {
			console.log('Error is response: ', response.body.error)
		} else {
			callback(body);
		}
	})
}

//fn to add user to users collection for further communication
function addUserToCollection(collection, userData) {
	let query = {};
	let senderID = userData["senderID"];
	console.log("SENDERID in comments: " + senderID)
	let id = userData["id"];
	let last_name = userData["last_name"];
	query["last_name"] = last_name;
	collection.find(query).toArray(function(err, docs) {
		if (err) {console.log("Smth wrong writing data to users collection. See error\n" + err); return false;}
		if (!docs.length) {
			collection.insert(userData);
			console.log("Added user \n" + JSON.stringify(userData) + "\n to users")
		} else if (!docs[0].senderID && senderID) {
			collection.update(query, {$set: {"senderID": senderID}});
			console.log("Updated senderID");
		} else if (!docs[0].id && id) {
			collection.update(query, {$set: {"id": id}})
			console.log("UPDATED USER ID")
		} else {
			console.log("User " + userData["last_name"] + " already in collection");
		}
	});

}

//fn to get userData from DB
function getUserFromDb(collection, lastName, callback) { //mongodb works async so to get all data callback is needed!
	let query = {};
	query["last_name"] = lastName;
	let uD = "";
	collection.find(query).toArray(function(err, result) {
		if (err) {return console.log("error in getUserData: \n" + err)}
		callback(result);
	});
}

//fn to show help w/ all commands
function showHelp(sender) {
	console.log(sender);
}

// connect to mongoDB & start server
MongoClient.connect(mongodbLink, function(err, database) {
	if (err) {return console.log("This is DB Error \n" + err);}
	db = database;
	events = db.collection("events");
	// index
	app.get('/', function (req, res) {
		res.status(200).send('hello I\'m very sexy bot')
	})
	//verification test on FB
	app.get('/webhook/', function (req, res) {
		if (req.query['hub.verify_token'] === verificationToken) {
			res.status(200).send(req.query['hub.challenge'])
		}
		res.send('Error, wrong token');
		res.sendStatus(403);
	})

	// to post data back to FB
	app.post('/webhook/', function (req, res) {
		//console.log("WEBHOOK req.body: \n" + JSON.stringify(req.body));
		let messaging_events = req.body.entry[0].messaging;
        if (!messaging_events) {
        	let value = req.body.entry[0]["changes"][0]["value"];
        	console.log("value in page changes: \n" + JSON.stringify(value))
        	let senderInPost = value["sender_id"];

        	console.log("senderInPost: \n" + senderInPost);
        	getSenderData(senderInPost, token, function(userData) {
        		console.log("From post chanages: " + userData)
        		userData = JSON.parse(userData);
        		if (!userData["error"]) {
		        	let today = getCurrentDate();
        			let query = {};
        			query[today] = {$exists: true};
        			events.find(query).toArray(function(err, docs) {
				        if (err) {console.log("Smth strange happen.\nPlease try again"); return false}
		        		let statusId = value["parent_id"];
		        		console.log("Today: " + today)
		        		if (statusId !== docs[0]["id"]) {return console.log("not this time. Event is in past")}
		        		let item = value["item"];
						let message = value["message"];
						let count = docs[0][today]["registered"];
						let persons = docs[0][today]["personsRegistered"];
						let replacement = {};
						replacement = {today: {"registered": 0, "personsRegistered": []}};
						console.log("In replacement: [today] " + replacement[today])
						if (!persons.length) {
							//replacement[today]["registered"] = 1;
							//replacement[today]["personsRegistered"] = [userData];
							//events.update(query, {$set: replacement})
						} else {
							console.log("ELSE in persons comparison began")
							for (let j=0; j<persons.length; j++) {
								console.log("Persons last_name: " + persons[j]["last_name"])
								if (userData["last_name"] === persons[j]["last_name"]) {
									console.log("You are already registered");
									return false;
								}
							}
							count += 1;
							persons.push(userData);
							events.update(query, {$set: {"registered": count, "personsRegistered": persons}})
						}
						console.log("You have beed added!");
        			})
        		} else {
        			console.log("requested page:\n"+JSON.stringify(userData))
        		}

        	})
        	return console.log("Received page updates, not message")
        }
		for (let i = 0; i < messaging_events.length; i++) {
			let event = req.body.entry[0].messaging[i]
			let sender = event.sender.id;
			getSenderData(sender, token, function(userData) {
				userData = JSON.parse(userData);
				if (event.message && event.message.text) {
					let text = event.message.text
					if (text.substring(0,6) === "/event") {
                        //what to do with events
						createEvent(pageID, events, text.substring(7), sender, function(query, date) {
                                addPost(pageID, date, function(body) { //firs published event, saved to db and added published id
        							query["id"] = body.id;
            						events.save(query, function(err, result) {
						            	if (err) {
						            		console.log(err);
						            		removePost(pageID, body.id);
						            		return false;
						            	}
						                console.log("saved to database");
						                let t = "Event " + Object.keys(query)[0] + " created, posted and saved to database"
						                sendTextMessage(sender, t);
						                addToEvent(events, sender, userData)
									})
								})
						});
					} else if (text.substring(0,11) === "/registered") {
						showCount(events, sender, text.substring(12));
					} else if (text.substring(0,4) === "/add" || text[0] === "+") {
						addToEvent(events, sender, userData); //register to current/today event
					} else if (text.substring(0,7) === "/remove" || text[0] === "-") { //this fn is to remove user from event
						removeFromEvent(events, sender, userData);
					} else if (text.substring(0,5) === "/list") {
						listRegistered(events, sender, text.substring(6))
					} else if (text.substring(0,6) === "/help") {
						showHelp(sender);
					} else if (text.substring(0,2) === "/r") {
						removePost(pageID, text.substring(3));
						removeEventFromDB(events, text.substring(3));
					} else if (text.substring(0,2) === "/p") {
                        addPost(pageID, text.substring(3));
                    } else {
						sendTextMessage(sender, "I didn't get it :( \nPlease enter valid command. \n->print '/help' for details<-")
					}
				}
			});
		};
		res.sendStatus(200);
	})

	//start server
	app.listen(app.get('port'), function() {
		console.log('running on port', app.get('port'))
	})
/*end of MongoClient.connect*/
})
