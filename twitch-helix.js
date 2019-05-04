const twitch = require('twitch-helix-api');
const EventEmitter = require('events');
const config = require('./config');
var game;
const streamEmitter = new EventEmitter();
let startup = false;
twitch.clientID = config["twitch-client-id"];
let streams = { };
let tags = [
  "7cefbf30-4c3e-4aa7-99cd-70aabb662f27", 
  "2fd30cb8-f2e5-415d-9d42-1316cfa61367",
  "0b83a789-5f6a-45f0-b6a3-a56926b6f8b5",
];//Speedrun, Randomizer, TAS
function streamLoop () {
  // Uncomment for logging.
  //console.log("Get streams...");
  //console.log(".--current streams--.");
  //console.log(streams)
  //console.log("'-------------------'");
  twitch.streams.getStreams({
    "game_id": [
      "110758" //BoTW
    ],
    "first": 99,
    "type": 'live'
  }).then((data) => {
    let res = data.response.data;
    let user_ids = [ ];
    for (let stream of res) {
      if (stream.tag_ids) {
        var speedrun = tags.find(tag => {
          if (stream.tag_ids.includes(tag))
            return true;
          return false;
        });
      }
      if (speedrun) {
        user_ids.push(stream["user_id"]);
        if (typeof streams[stream["user_id"]] === 'undefined') {
          streams[stream["user_id"]] = { };
        }
        streams[stream["user_id"]]["timer"] = 15;
        streams[stream["user_id"]]["title"] = stream["title"];
        streams[stream["user_id"]]["viewer_count"] = stream["viewer_count"];
        streams[stream["user_id"]]["game_id"] = stream["game_id"]
      }      
    }
    if (user_ids.length > 0) {
      return twitch.users.getUsers({
        "id": user_ids
      });
    }
    return null;
  }).then((data) => {
    if (data === null) {
      return;
    }
    let res = data.response.data;
    for (let stream of res) {
      if (typeof streams[stream["id"]]["url"] === 'undefined') {
        if (startup === true) {
          streamEmitter.emit('messageStreamStarted', {
            "url": 'https://www.twitch.tv/' + stream["login"],
            "name": stream["login"],
            "title": streams[stream["id"]]["title"],
            "game": "Breath of the Wild",
            // "id": stream["id"],
            // "display_name": stream["display_name"],
            // "login": stream["login"]
          });
        }
      }
      streams[stream["id"]]["url"] = 'https://www.twitch.tv/' + stream["login"];
      streams[stream["id"]]["display_name"] = stream["display_name"];
      streams[stream["id"]]["login"] = stream["login"];
    }
    return;
  }).catch((e) => {
    console.error(e);
  }).then(() => {
    if (startup === false) {
      startup = true;
    }
    setTimeout(streamLoop, 30000);
  });
}
setTimeout(streamLoop, 15000);
setInterval(() => {
  for (let stream of Object.keys(streams)) {
    streams[stream]["timer"]--;
    if (streams[stream]["timer"] < 1) {
      if (typeof streams[stream]["url"] !== 'undefined' && typeof streams[stream]["title"] !== 'undefined') {
        streamEmitter.emit('messageStreamDeleted', {
          "url": streams[stream]["url"],
          "title": streams[stream]["title"],
          "id": stream
        });
      }
      delete streams[stream];
    }
  }
}, 20000);
streamEmitter.getStreams = () => {
  return streams;
}
module.exports = streamEmitter;
