"use strict";
// typescript source: https://github.com/lepelog/speedruncom-wr-watch/blob/master/src/srcWRs.ts
const events = require("events");
const request = require("request-promise");
const Discord = require("discord.js");
const gameID = "76rqjqd8"; // botw
const srcApi = 'https://www.speedrun.com/api/v1/';
const wrEmitter = new events.EventEmitter();
const SRC_RUN_LINK_REGEX = /https:\/\/www.speedrun.com\/.+\/run\/([0-9a-z]+)/;
async function srcWRLoop(lastRunIDs) {
    lastRunIDs = lastRunIDs || [];
    const game = await loadGame(gameID);
    while (true) {
        try {
            // grab newly submitted runs
            const newRuns = await newVerifiedRuns(game, lastRunIDs);
            for (const run of newRuns) {
                lastRunIDs.unshift(run.id);
                // announce new run
                wrEmitter.emit('newRun', run);
                // check if it's a new WR or the first run in that category
                const place = await checkRunPlaceOnLeaderboard(run);
                if (place === 1) {
                    wrEmitter.emit('newWR', run);
                }
            }
            // limit to 30 elements
            lastRunIDs = lastRunIDs.splice(0, 30);
            // sleep to wait for runs
            await sleep(30000);
        }
        catch (e) {
            console.error('error during main loop, continuing', e);
        }
    }
}
async function loadGame(gameID) {
    const response = await requestWithRetry(`${srcApi}games/${gameID}?embed=categories,variables,levels`, 3);
    const fullGameVariables = new Map();
    const levelVariables = new Map();
    const categories = new Map();
    const levels = new Map();
    response.data.categories.data
        .filter((cat) => cat.type == "per-game")
        .forEach((cat) => {
        categories.set(cat.id, { id: cat.id, name: cat.name, variables: new Map() });
    });
    const levelCategories = response.data.categories.data
        .filter((cat) => cat.type == "per-level")
        .map((cat) => {
        return { id: cat.id, name: cat.name, variables: new Map() };
    });
    response.data.levels.data.map((l) => {
        levels.set(l.id, {
            levelId: l.id,
            levelName: l.name,
            // copy
            categories: new Map(levelCategories.map(cat => {
                return [cat.id, { id: cat.id, name: cat.name, variables: new Map() }];
            })),
        });
    });
    response.data.variables.data.forEach((variable) => {
        // only split by subcategories and amiibo
        if (!variable["is-subcategory"] && variable.name != 'amiibo')
            return;
        let v = { name: variable.name, id: variable.id, values: new Map() };
        Object.entries(variable.values.values).forEach(([id, val]) => {
            v.values.set(id, val.label);
        });
        if (variable.scope.type == "global") {
            if (variable.category != null) {
                let cat = categories.get(variable.category);
                if (cat) {
                    cat.variables.set(v.id, v);
                }
            }
            else {
                fullGameVariables.set(v.id, v);
            }
        }
        else if (variable.scope.type == "full-game") {
            if (variable.category != null) {
                let cat = categories.get(variable.category);
                if (cat) {
                    cat.variables.set(v.id, v);
                }
            }
            else {
                fullGameVariables.set(v.id, v);
            }
        }
        else if (variable.scope.type == "all-levels") {
            if (variable.category != null) {
                levels.forEach(level => {
                    let cat = level.categories.get(variable.category);
                    if (cat) {
                        cat.variables.set(v.id, v);
                    }
                });
            }
            else {
                levelVariables.set(v.id, v);
            }
        }
        else if (variable.scope.type == "single-level") {
            const level = levels.get(variable.scope.level);
            if (level) {
                if (variable.category != null) {
                    let cat = level.categories.get(variable.category);
                    if (cat) {
                        cat.variables.set(v.id, v);
                    }
                }
                else {
                    level.categories.forEach(cat => {
                        cat.variables.set(v.id, v);
                    });
                }
            }
        }
    });
    return {
        abbreviation: response.data.abbreviation,
        name: response.data.names.international,
        id: gameID,
        categories,
        fullGameVariables,
        levelVariables,
        levels
    };
}
// no amiibo any% WR: https://www.speedrun.com/api/v1/leaderboards/76rqjqd8/category/vdoq4xvk?top=1&embed=players&var-gnxrr7gn=klr0jj0l
async function newVerifiedRuns(game, lastRunIDs) {
    const runData = await requestWithRetry(`https://www.speedrun.com/api/v1/runs?game=${game.id}&status=verified&direction=desc&orderby=verify-date&embed=players&max=30`, 3);
    const newRuns = [];
    for (let i = 0; i < runData.data.length; i++) {
        let curRun = runData.data[i];
        if (!lastRunIDs.includes(curRun.id)) {
            newRuns.push(parseRun(curRun, game));
        }
        else {
            break;
        }
    }
    return newRuns;
}
function parseRun(srcData, game) {
    const rawVariables = srcData.values;
    const gameCategoryVariables = new Map();
    const parsedRun = {
        category: '',
        categoryID: '',
        game: game.name,
        gameID: game.id,
        gameAbbreviation: game.abbreviation,
        id: srcData.id,
        playerName: srcData.players.data[0].names.international,
        playerID: srcData.players.data[0].id,
        time: srcData.times.primary_t,
        level: null,
        levelID: null,
        variables: []
    };
    if (srcData.level) {
        game.levelVariables.forEach((vari, id) => {
            gameCategoryVariables.set(id, vari);
        });
        const level = game.levels.get(srcData.level);
        if (!level) {
            throw new Error(`Level ${srcData.level} doesn't exist for run ${srcData.id}`);
        }
        const category = level.categories.get(srcData.category);
        if (!category) {
            throw new Error(`Category ${srcData.category} doesn't exist for run ${srcData.id}`);
        }
        category.variables.forEach((vari, id) => {
            gameCategoryVariables.set(id, vari);
        });
        parsedRun.level = level.levelName;
        parsedRun.levelID = level.levelId;
        parsedRun.category = category.name;
        parsedRun.categoryID = category.id;
    }
    else {
        game.fullGameVariables.forEach((vari, id) => {
            gameCategoryVariables.set(id, vari);
        });
        const category = game.categories.get(srcData.category);
        if (!category) {
            throw new Error(`Category ${srcData.category} doesn't exist for run ${srcData.id}`);
        }
        category.variables.forEach((vari, id) => {
            gameCategoryVariables.set(id, vari);
        });
        parsedRun.category = category.name;
        parsedRun.categoryID = category.id;
    }
    Object.entries(rawVariables).forEach(([variableId, valueId]) => {
        const vari = gameCategoryVariables.get(variableId);
        if (vari) {
            const value = vari.values.get(valueId) || '';
            parsedRun.variables.push({
                id: vari.id,
                name: vari.name,
                valueId: valueId,
                valueName: value
            });
        }
    });
    return parsedRun;
}
async function checkRunPlaceOnLeaderboard(run) {
    const varString = run.variables.map(v => `var-${v.id}=${v.valueId}`).join('&');
    let result;
    if (run.levelID) {
        result = await requestWithRetry(`https://www.speedrun.com/api/v1/leaderboards/${run.gameID}/level/${run.levelID}/${run.categoryID}?${varString}`, 3);
    }
    else {
        result = await requestWithRetry(`https://www.speedrun.com/api/v1/leaderboards/${run.gameID}/category/${run.categoryID}?${varString}`, 3);
    }
    // try to find the run id
    const placement = result.data.runs.find((r) => r.run.id == run.id);
    if (placement) {
        return placement.place;
    }
    else {
        return null;
    }
}
function formatRun(run) {
    let category;
    if (run.level) {
        category = `${run.level} ${run.category}`;
    }
    else {
        category = run.category;
    }
    let subcategories = `${run.variables.map(v => v.valueName).join(', ')}`;
    return `${category} (${subcategories}) by ${run.playerName} in ${formatTime(run.time)}`;
}
async function formatSendRun(channel, info) {
    return channel.send({
        embed: {
            title: `NEW World Record`,
            url: `https://www.speedrun.com/${info.gameAbbreviation}/run/${info.id}`,
            color: 0xffcd2e,
            description: `A new WR has been posted for ${formatCategoryWithVars(info)}`,
            fields: [{ name: "Runner", value: info.playerName }, { name: "Time", value: formatTime(info.time) }],
        }
    });
}
async function getAlreadyAnnouncedRunIDs(channel) {
    let categoryIDs = [];
    let fetched = await channel.fetchMessages({ limit: 30 });
    fetched.forEach(message => {
        if (message.embeds.length == 1) {
            const link = message.embeds[0].url;
            if (link) {
                let match = SRC_RUN_LINK_REGEX.exec(link);
                if (match && match.length == 2) {
                    categoryIDs.push(match[1]);
                }
            }
        }
    });
    return categoryIDs;
}
// helpers
function formatCategoryWithVars(run) {
    const varString = run.variables.map(v => v.valueName).join(', ');
    if (run.levelID != null) {
        return `${run.level} ${run.category} (${varString})`;
    }
    else {
        return `${run.category} (${varString})`;
    }
}
function formatTime(time) {
    let secStr;
    let secs = (time % 60);
    if (secs < 10) {
        secStr = '0' + (time % 60).toFixed(3);
    }
    else {
        secStr = (time % 60).toFixed(3);
    }
    if (secStr.endsWith('.000')) {
        secStr = secStr.slice(0, secStr.length - 4);
        secStr = secStr.slice();
    }
    const min = Math.floor((time / 60) % 60);
    let minStr;
    if (min == 0) {
        minStr = '';
    }
    else if (min < 10) {
        minStr = `0${min}m `;
    }
    else {
        minStr = `${min}m `;
    }
    const hour = Math.floor(time / 3600);
    let hStr;
    if (hour == 0) {
        hStr = '';
    }
    else {
        hStr = `${hour}h `;
    }
    return `${hStr}${minStr}${secStr}s`;
}
/**
 * Oops the site is under a lot of pressure right now
 */
async function requestWithRetry(url, retries) {
    for (let i = 0; i < retries; i++) {
        try {
            return await request.get(url, { json: true });
        }
        catch (err) {
            console.error(`Error for url ${url}:`, err);
        }
        await sleep(5000);
    }
    throw new Error(`too many retries for url ${url}`);
}
async function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
/*wrEmitter.on('newRun', (run: Run) => {
    console.log('New run:',run);
});*/
//discordTest();
// example usage
async function discordTest() {
    const client = new Discord.Client();
    client.login("your token here");
    client.on('ready', async () => {
        const channel = client.channels.get("channel id here");
        if (channel) {
            const alreadyAnnouncedRunIDs = await getAlreadyAnnouncedRunIDs(channel);
            console.log(`found ${alreadyAnnouncedRunIDs.length} announced WRs`);
            srcWRLoop(alreadyAnnouncedRunIDs);
            wrEmitter.on('newWR', async (run) => {
                try {
                    await formatSendRun(channel, run);
                }
                catch (e) {
                    console.log('error formatSendRun', e);
                }
            });
        }
        else {
            console.error('channel not found!');
        }
    });
}
module.exports = {
    srcWRLoop,
    wrEmitter,
    formatCategoryWithVars,
    formatTime,
    getAlreadyAnnouncedRunIDs,
    formatSendRun,
};