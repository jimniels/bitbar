#!/usr/bin/env /usr/local/bin/node

const fs = require("fs");
const path = require("path");
const os = require("os");
const NetlifyAPI = require("netlify");
const recursive = require("recursive-readdir");
const minimatch = require("minimatch"); // transitive dep of recursive-readdir
const hasha = require("hasha");
const isOnline = require("is-online");
const isEqual = require("lodash.isequal");
const capitalize = require("lodash.capitalize");
const { getNetlifyOAuth, imgToBase64 } = require("../helpers.js");

const netlify = new NetlifyAPI(getNetlifyOAuth());
const SRC_DIR = path.resolve(os.homedir(), "Dropbox/cdn"); // ~/Dropbox/cdn
const IGNORE_PATTERN = "{**/.*,**/_src/*}";
const SITE_ID = "jimniels-cdn.netlify.com";
const STATE_FILE = path.join(__dirname, ".state.json");

try {
  main();
} catch (err) {
  console.log("Something went wrong running the script");
  console.error(err);
}

async function main() {
  const state = getState();

  // Did we indicate we need a deploy?
  // @TODO requires ~5 seconds before a deploy will even trigger
  if (state.status === "NEEDS_DEPLOY") {
    const newState = {
      ...state,
      status: "DEPLOYING"
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(newState));
    render(newState);
    return;
  }

  // If we indicated that we are "deploying" then go the deploy
  if (state.status === "DEPLOYING") {
    const newDeploy = await deploy();
    const newState = {
      status: "IDLE",
      deploys: [newDeploy, ...state.deploys.slice(0, 5)]
    };

    fs.writeFileSync(STATE_FILE, JSON.stringify(newState));
    render(newState);
    return;
  }

  render(state);
  return;
}

/**
 * Render out the string expected by bitbar.
 * Should be pure. No side effects. Same inputs, same outputs.
 * @param {State}
 */
function render({ deploys, status }) {
  // Icon
  let icon = `|templateImage=`;
  if (status === "NEEDS_DEPLOY" || status === "DEPLOYING") {
    icon += imgToBase64("netlify-sync-in-progress.png");
  } else {
    icon += imgToBase64("netlify-sync.png");
  }
  console.log(icon);
  console.log("---");

  // Deploy/Deploying...
  if (status === "DEPLOYING") {
    // prettier-ignore
    console.log([
      "Deploy in progress... |",
      `image=${imgToBase64("status-yellow.png")}`,
      "href=https://app.netlify.com/sites/jimniels-cdn/deploys"
    ].join(" "));
  } else {
    const file = path.join(__dirname, ".netlify-sync-trigger-deploy.js");
    console.log(
      [
        "⚡️ DEPLOY ⚡️ |",
        "color=#c58a00",
        "terminal=false",
        `bash=/usr/local/bin/node param1=${file}`
      ].join(" ")
    );
  }
  console.log("---");

  // Deploy log
  if (deploys.length > 0) {
    const [latestDeploy, ...otherDeploys] = deploys;
    logDeploy(latestDeploy);

    if (otherDeploys.length) {
      console.log("---");
      otherDeploys.forEach(deploy => logDeploy(deploy, { isNested: true }));
    }
  }

  console.log("---");
  console.log(
    `Reset State | terminal=false bash=/bin/rm param1=-f param2=${STATE_FILE}`
  );
}

function logDeploy(deploy, opts = {}) {
  const {
    duration,
    log,
    changes,
    netlify: { admin_url, id } = {},
    error
  } = deploy;
  const { isNested = false } = opts;
  const prefix = isNested ? "-- " : "";

  console.log(
    [
      `${getDisplayTime(deploy.datetime)}|`,
      `image=${imgToBase64(
        deploy.error ? "status-red.png" : "status-green.png"
      )}`,
      `href=${admin_url}/deploys/${id}`
    ].join(" ")
  );

  const logItem = item => {
    if (item) {
      console.log(prefix + item);
    }
  };

  if (error) {
    error.split("\n").forEach(logItem);
    return;
  }

  console.log(`${prefix}${changes} files in ${round(duration, 1)}s`);

  log.split("\n").forEach(logItem);
}

/**
 * Get state related to previous deploys
 * @returns {State}
 */
function getState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE));
  }

  const initialState = {
    status: "NEEDS_DEPLOY",
    deploys: []
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(initialState));
  return initialState;
}

/**
 * Runs a deploy of our directory. Returns a promise which resolves to a value
 * @returns {Deploy}
 */
async function deploy() {
  const start = new Date();
  let log = "";
  const addLineToLog = str => {
    log = log + str + "\n";
  };

  return netlify
    .deploy(SITE_ID, SRC_DIR, {
      message: `Manual deploy from Netlify bitbar script`,
      filter: filepath => filepath && !minimatch(filepath, IGNORE_PATTERN),
      statusCb: ev => {
        switch (ev.phase) {
          case "start": {
            // addLineToLog(ev.msg);
            return;
          }
          case "progress": {
            return;
          }
          case "stop":
          default: {
            addLineToLog("✓ " + ev.msg);
            return;
          }
        }
      }
    })
    .then(site => ({
      netlify: site.deploy,
      changes: site.uploadList ? site.uploadList.length : 0
    }))
    .catch(error => ({
      // @TODO catch if it's offline?
      // if (!(await isOnline())) {
      //   render({ status: "OFFLINE", deploys: state.deploys });
      //   return;
      // }
      error: "Something went wrong \n" + error.stack + "\n" + error.message
    }))
    .then(props => {
      const end = new Date() - start;

      return {
        datetime: new Date().toISOString(),
        log,
        duration: end / 1000, // in seconds
        ...props
      };
    });
}

/**
 * Round a number to nearest specified decimal
 * https://stackoverflow.com/questions/7342957/how-do-you-round-to-1-decimal-place-in-javascript
 * @param {number} value
 * @param {number} precision
 * @returns {number}
 */
function round(value, precision) {
  var multiplier = Math.pow(10, precision || 0);
  return Math.round(value * multiplier) / multiplier;
}

/**
 * Takes a date and returns the display time relative to current time
 * @param {string} date - `.toISOString()` date
 * @returns {string} - i.e. "1 day ago, 10:30:01 AM"
 */
function getDisplayTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();

  const r = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  const millisecondsPerDay = 24 * 60 * 60 * 1000;

  const relativeDate = capitalize(
    r.format(Math.round((date - now) / millisecondsPerDay), "day")
  );
  const time = date.toLocaleTimeString("en-US");
  return `${relativeDate}, ${time}`;
}

/**
 * @typedef {Object} State
 *
 * @property {Array.<Deploy>} deploys
 * @property {"IDLE"|"NEEDS_DEPLOY"|"DEPLOYING"} status
 */

/**
 * @typedef {Object} Deploy
 *
 * @property {string} datetime - takes shape as returned by `.toISOString()`
 * @property {string} log - fills in after the deploy is complete
 * @property {number} duration - time it took to run the deploy, in seconds
 * @property {string} error - error message if deploy promise failed
 * @property {number} changes - number of files changed during the deploy
 * @property {NetlifyDeploy} netlify
 */

/**
 * @typedef {Object} NetlifyDeploy
 * Represents a deploy as defined by netlify. We expect a couple of pieces:
 *
 * @property {string} admin_url
 * @property {string} id
 *
 * See Netlify API for complete shape reference
 * https://open-api.netlify.com/?_ga=2.124842243.805067671.1573168826-490942577.1573168826#operation/getDeploy
 */
