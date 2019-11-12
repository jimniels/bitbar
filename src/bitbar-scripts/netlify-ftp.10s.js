#!/usr/bin/env /usr/local/bin/node

const fs = require("fs");
const path = require("path");
const os = require("os");
const NetlifyAPI = require("netlify");
const recursive = require("recursive-readdir");
const hasha = require("hasha");
const isOnline = require("is-online");
const isEqual = require("lodash.isequal");
const capitalize = require("lodash.capitalize");
const { getNetlifyOAuth, imgToBase64 } = require("../helpers.js");

const netlify = new NetlifyAPI(getNetlifyOAuth());
const SRC_DIR = path.resolve(os.homedir(), "Dropbox/cdn"); // ~/Dropbox/cdn
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

  // 1. If we're offline, just stop now. Don't bother trying to sync
  if (!(await isOnline())) {
    render({ status: "OFFLINE", deploys: state.deploys });
    return;
  }

  // If the files on disk are the same as during the last deploy
  // set our state to `needsDeploy` so on the next go around, we trigger a sync
  const newFileDigest = await getCurrentFileDigest();
  if (!isEqual(newFileDigest, state.fileDigest)) {
    const newDeploy = await deploy();
    const newState = {
      fileDigest: newFileDigest,
      deploys: [newDeploy, ...state.deploys.slice(0, 5)]
    };

    fs.writeFileSync(STATE_FILE, JSON.stringify(newState));
    render({ status: "SYNCED", deploys: newState.deploys });
    return;
  }

  render({ status: "IDLE", deploys: state.deploys });
  return;
}

/**
 * Render out the string expected by bitbar.
 * Should be pure. No side effects. Same inputs, same outputs.
 * @param {Array.<Deploy>} deploys
 * @param {status} string - @TODO enum
 */
function render({ deploys, status }) {
  let icon = `|templateImage=`;
  if (status === "OFFLINE") {
    icon += imgToBase64("netlify-sync-offline.png");
  } else if (status === "SYNCED") {
    icon += imgToBase64("netlify-sync-success.png");
  } else {
    icon += imgToBase64("netlify-sync.png");
  }
  console.log(icon);
  console.log("---");

  if (status === "OFFLINE") {
    // @TODO check if files are out of sync and that we need a deploy but
    // can't do one
    console.log("No internet connection");
    console.log("Syncing disabled");
    console.log("---");
  }

  if (deploys.length > 0) {
    const [latestDeploy, ...otherDeploys] = deploys;
    logDeploy(latestDeploy);

    if (otherDeploys.length) {
      console.log("---");
      otherDeploys.forEach(deploy => logDeploy(deploy, { isNested: true }));
    }
  }

  console.log("---");
  console.log("Refresh Script | refresh=true");
  console.log(
    `Reset State | terminal=false bash=/bin/rm param1=-f param2=${STATE_FILE}`
  );
}

function logDeploy(deploy, opts = {}) {
  const {
    duration,
    log,
    changes,
    netlify: { admin_url, id },
    error
  } = deploy;
  const { isNested = false } = opts;
  const prefix = isNested ? "-- " : "";

  console.log(
    getDisplayTime(deploy.datetime) +
      "|" +
      " image=" +
      imgToBase64(deploy.error ? "status-red.png" : "status-green.png") +
      ` href=${admin_url}/deploys/${id}`
  );

  console.log(`${prefix}${changes} files in ${round(duration, 1)}s`);

  log.split("\n").forEach(item => {
    if (item) {
      console.log(prefix + item);
    }
  });

  if (error) {
    console.log(error);
  }
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
    deploys: [],
    fileDigest: {}
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(initialState));
  return initialState;
}

/**
 * Get a digest of file paths and SHA1's of the content for the given directory
 * @returns {Digest}
 */
async function getCurrentFileDigest() {
  return recursive(SRC_DIR, [".DS_Store", "**/_src/*"]).then(files => {
    return files.reduce(
      // file will be a full path
      //   `/Users/jimnielsen/Dropbox/cdn/my-file.jpg`
      // so we trim it down to the local because that's what netlify api has
      //   `/my-file.jpg`
      (acc, file) => {
        const sha = hasha(fs.readFileSync(file), {
          algorithm: "sha1"
        });
        const shortFilePath = file.replace(SRC_DIR, "");
        return {
          ...acc,
          [shortFilePath]: sha
        };
      },
      {}
    );
  });
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
    .catch(error => ({ error }))
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
 * @property {FileDigest} fileDigest
 * @property {Array.<Deploy>}
 *
 */

/**
 * @typedef {Object} Deploy
 *
 * @property {string} datetime - takes shape as returned by `.toISOString()`
 * @property {string} log - fills in after the deploy is complete
 * @property {string} error - error message if deploy promise failed
 * @property {number} duration - time it took to run the deploy, in seconds
 * @property {number} changes - number of files changed during the deploy
 * @property {NetlifyDeploy} netlify
 */

/**
 * @typedef {Object.<string, string>} FileDigest
 * An object with key/value mappings of file paths to sha1's of the file's contents
 * i.e. { "/path/to/file": "abc123def455", ... }
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

/*

Example response of `site` after deploy

{ deployId: '5dab6095be319fcdf09356b1',
  deploy:
   { id: '5dab6095be319fcdf09356b1',
     site_id: 'd604cd05-0e2b-406a-9a98-0b1b5dc3f34e',
     build_id: null,
     state: 'ready',
     name: 'jimniels-cdn',
     url: 'https://cdn.jim-nielsen.com',
     ssl_url: 'https://cdn.jim-nielsen.com',
     admin_url: 'https://app.netlify.com/sites/jimniels-cdn',
     deploy_url: 'http://5dab6095be319fcdf09356b1.jimniels-cdn.netlify.com',
     deploy_ssl_url: 'https://5dab6095be319fcdf09356b1--jimniels-cdn.netlify.com',
     created_at: '2019-10-19T19:14:29.010Z',
     updated_at: '2019-10-19T19:14:29.908Z',
     user_id: '5ab5d0fadf99534a3ecb05d7',
     error_message: null,
     required: [],
     required_functions: [],
     commit_ref: null,
     review_id: null,
     branch: null,
     commit_url: null,
     skipped: null,
     locked: null,
     log_access_attributes:
      { type: 'firebase',
        url:
         'https://netlify-builds2.firebaseio.com/deploys/5dab6095be319fcdf09356b1/log',
        endpoint: 'https://netlify-builds2.firebaseio.com',
        path: '/deploys/5dab6095be319fcdf09356b1/log',
        token: '0VPdBEVIpCELfwkwswXemwtSydJqaDDZxZZhN9fV' },
     title:
      'Manual deploy from Netlify script at 10/19/2019, 1:14:28 PM America/Denver',
     review_url: null,
     published_at: '2019-10-19T19:14:29.762Z',
     context: 'production',
     deploy_time: 0,
     available_functions: [],
     summary: { status: 'ready', messages: [Array] },
     screenshot_url: null,
     site_capabilities:
      { title: 'Netlify Team Free',
        asset_acceleration: true,
        form_processing: true,
        cdn_propagation: 'partial',
        build_gc_exchange: 'buildbot-gc',
        build_node_pool: 'buildbot-external-ssd',
        domain_aliases: true,
        secure_site: false,
        prerendering: true,
        proxying: true,
        ssl: 'custom',
        rate_cents: 0,
        yearly_rate_cents: 0,
        cdn_network: 'free_cdn_network',
        ipv6_domain: 'cdn.makerloop.com',
        branch_deploy: true,
        managed_dns: true,
        geo_ip: true,
        split_testing: true,
        id: 'nf_team_dev' },
     committer: null,
     skipped_log: null },
  uploadList:
   [ { root: '/Users/jimnielsen/Dropbox/cdn',
       filepath: '/Users/jimnielsen/Dropbox/cdn/jordan-34.jpg',
       stat: [Stats],
       relname: 'jordan-34.jpg',
       basename: 'jordan-34.jpg',
       type: 'file',
       hash: '235bdf83da6d870e2d7cff4e1f1a2ab846537e26',
       assetType: 'file',
       normalizedPath: 'jordan-34.jpg' } ] }
*/
