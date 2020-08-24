const fs = require('fs');
const axios = require('axios');
const config = require('./goaltracker.json');

var nconf = require('nconf');
nconf.argv().env();
nconf.file({ file: 'goaltracker.json' });
nconf.defaults(
    {
        "user": {
            "api_key": "api_key",
            "user_id": 4579132,
            "mode": 3,
            "level_goal": 100
        },
        "config": {
            "refresh_tries": 5,
            "tries_sleep_ms": 500,
            "manual_sleep_ms": 10000,
            "refresh_on_ranking_panel": false,
            "refresh_on_idle_screen": false,
            "refresh_on_select_screen": true,
            "live_play_score_path": "E:\\stream\\Sync\\livedata.txt",
            "live_play_score": true
        },
        "preferences": {
            "display_approx_maps": true,
            "display_approx_time": true
        }
    }
);


const apikey = nconf.get("user:api_key");
const userid = nconf.get("user:user_id");
const mode = nconf.get("user:mode");
const level_goal = nconf.get("user:level_goal");

const refresh_tries = nconf.get("config:refresh_tries");
const tries_sleep_ms = nconf.get("config:tries_sleep_ms");

const refresh_on_ranking_panel = nconf.get("config:refresh_on_ranking_panel");
const refresh_on_idle_screen = nconf.get("config:refresh_on_idle_screen");
const refresh_on_select_screen = nconf.get("config:refresh_on_select_screen");

const live_play_score_path = nconf.get("config:live_play_score_path");
const live_play_score = nconf.get("config:live_play_score");
const manual_sleep_ms = nconf.get("config:manual_sleep_ms");

const display_approx_maps = nconf.get("preferences:display_approx_maps");
const display_approx_time = nconf.get("preferences:display_approx_time");

const gamestate = {
    PLAYING: 'Playing',
    RANKING: 'Ranking',
    IDLE: 'Idle',
    SELECT: 'SelectSong',
}

let score_average = 970000;
let seconds_average = 90;
let score_goal = GetRequiredScoreForLevel(level_goal);

// https://olc.howl.moe/script.js
//
// GetRequiredScoreForLevel retrieves the score required to reach a certain
// level.
function GetRequiredScoreForLevel(level) {
	if (level <= 100) {
		if (level > 1) {
			return Math.floor(5000/3*(4*Math.pow(level, 3)-3*Math.pow(level, 2)-level) + Math.floor(1.25*Math.pow(1.8, level-60)));
		}
		return 1;
	}
	return 26931190829 + 100000000000*(level-100);
}

// https://stackoverflow.com/a/6313008
String.prototype.toHHMMSS = function () {
    var sec_num = parseInt(this, 10); // don't forget the second param
    var hours   = Math.floor(sec_num / 3600);
    var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
    var seconds = sec_num - (hours * 3600) - (minutes * 60);

    if (hours   < 10) {hours   = "0"+hours;}
    if (minutes < 10) {minutes = "0"+minutes;}
    if (seconds < 10) {seconds = "0"+seconds;}
    return hours+':'+minutes+':'+seconds;
}

function formatNumber(n) {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

async function writeScore(score) {
    let diff = score_goal - score;

    let display = formatNumber(diff)+" remaining for level "+formatNumber(level_goal);

    let maps = parseInt(diff/score_average);
    let seconds = parseInt(diff/seconds_average);

    if(display_approx_maps) display += " (approx. "+formatNumber(maps)+" maps)";
    if(display_approx_time) display += " (approx. "+seconds.toString().toHHMMSS()+")";

    fs.writeFile("out.txt", display, function (err,data) {
        if (err) {
          return console.log(err);
        }
      });
}

function getLiveData() {
    try {
        let data = JSON.parse(fs.readFileSync(live_play_score_path, "utf-8"));
        return data;
    } catch (e) {}
    return null;
}

async function getApiData(user, mode = 3) {
    let result = null;

    await axios.get('https://osu.ppy.sh/api/get_user?k='+apikey+'&u='+user+"&m="+mode)
        .then(response => {
            result = response.data[0];
        })
        .catch(error => {
            console.log(error);
        });

    return result;
}

function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
}

class ScoreWatcher {
    constructor(user, mode) {
        this.user = user;
        this.mode = mode;
        this.current_score = 0;
        this.current_score_playing = 0;
        this.current_game_state = gamestate.IDLE;
        this.needs_refresh = true;

        this.manual_lock = false;
    }

    async refreshScore(retries = refresh_tries) {
        let success = false;
        let tries = 0;

        while(!success && tries < retries) {
            let data = await getApiData(this.user, this.mode);

            if(data) {
                score_average = data.total_score / data.playcount;
                seconds_average = data.total_score / data.total_seconds_played;

                if(data && data.total_score != this.current_score) {
                    this.current_score = parseInt(data.total_score);
                    this.current_score_playing = 0;
                    this.needs_refresh = false;

                    console.log("Got new score from api : "+this.current_score);
                }
            }

            if(!data || data.total_score == this.current_score) {
                tries++;
                await sleep(tries_sleep_ms);
            }
        }
        console.log("Score up to date");
    }

    async handleGameState(new_gamestate) {
        if(new_gamestate != this.current_game_state) {
            switch(new_gamestate) {
                case gamestate.PLAYING:
                    break;
                case gamestate.RANKING:
                    this.needs_refresh = refresh_on_ranking_panel;
                    break;
                case gamestate.IDLE:
                    this.needs_refresh = refresh_on_idle_screen;
                    break;
                case gamestate.SELECT:
                    this.needs_refresh = refresh_on_select_screen;
                    break;
            }

            console.log("Switched to "+new_gamestate);
            this.current_game_state = new_gamestate;
        }

        if(this.needs_refresh) {
            var scorewatcher = this;
            setTimeout(function() { scorewatcher.refreshScore() }, tries_sleep_ms);
            this.needs_refresh = false;
            console.log("Scheduled score refresh");
        }
    }

    async manualRefresh() {
        await this.refreshScore(1);
        await sleep(manual_sleep_ms);
        console.log("Next refresh");
        this.manual_lock = false;
    }

    async handle() {
        if(live_play_score) {
            let data = getLiveData();

            if(data) {
                this.handleGameState(data.osu_status);

                if(data.score) { // when score goes back to 0 we only want to set it back when getting the score from the api
                    this.current_score_playing = data.score;
                }
            }
        } else {
            if(!this.manual_lock) {
                this.manual_lock = true;
                console.log("Scheduled score refresh");
                this.manualRefresh();
            }
        }

        writeScore(this.current_score + this.current_score_playing);
    }
}

async function main() {
    let watcher = new ScoreWatcher(userid,mode);

    while(true) {
        await watcher.handle();
        await sleep(100);
    }
}

main();