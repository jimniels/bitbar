#!/usr/bin/env /usr/local/bin/node
const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");
const recursive = require("recursive-readdir");
const hasha = require("hasha");
const isEqual = require("lodash.isequal");
const isOnline = require("is-online");
const { imgToBase64, readDeploys, writeDeploys } = require("../helpers.js");
const {
  SRC_DIR,
  STATE_FILE,
  LOG_FILE,
  LOG_ERROR_FILE,
  DEPLOY_STATUS,
  DIGEST_FILE
} = require("../constants.js");
const deployScript = path.join(__dirname, "../deploy.js");

try {
  console.log("P");
  console.log("---");
  console.log("Dislabed for now");
  main();
} catch (err) {
  console.log("Something went wrong running the script");
  console.error(err);
}

async function main() {
  const { deploys, fileDigest } = getState();

  // Cases we will try to cover (in order):
  // 1. No internet connection
  // 2. A deploy is currently in progress
  // 3. A deploy needs to be made (fileDigests don't equal)
  // 4. Idle. Don't do anything, just log out the current state.

  // 1.
  // @TODO technically you could have a deploy in progress fail, which we
  // aren't handling here by marking it as failed. But it should timeout
  // at some point and the `.catch` in deploy.js will pick it up.
  if (!(await isOnline())) {
    render({ state: "OFFLINE", deploys });
    return;
  }

  // 2.
  // If the error log has something in it, that means node failed to run
  // the `deploy.js` script in some form or fashion. Which means YOU, dear
  // developer, have to fix something, and refresh the entire script/app.
  // If the log is empty, that means the deploy is going just fine. Let it be.
  if (
    fs.existsSync(LOG_FILE) &&
    fs.existsSync(LOG_ERROR_FILE) &&
    fs.existsSync(DIGEST_FILE)
  ) {
    const errorLog = fs
      .readFileSync(LOG_ERROR_FILE)
      .toString()
      .trim();

    if (errorLog.length) {
      render({ state: "ERROR", deploys, errorLog });
      return;
    }

    const log = fs.readFileSync(LOG_FILE).toString();
    const deployFailed = log.includes("=> FAILED");
    const deployCompleted = log.includes("=> COMPLETED");
    if (deployFailed || deployCompleted) {
      const newState = {
        fileDigest: JSON.parse(fs.readFileSync(DIGEST_FILE)),
        deploys: [
          generateNewDeploy({ log, hasError: deployFailed }),
          ...deploys.slice(0, 4)
        ]
      };
      render({ state: "IDLE", deploys: newState.deploys });
      fs.writeFileSync(STATE_FILE, JSON.stringify(newState));
      fs.unlinkSync(LOG_FILE);
      fs.unlinkSync(LOG_ERROR_FILE);
      fs.unlinkSync(DIGEST_FILE);
      return;
    } else {
      render({ state: "SYNCING", deploys, log });
      return;
    }
  }

  // 3.
  const currentFileDigest = await getCurrentFileDigest();
  if (!isEqual(currentFileDigest, fileDigest)) {
    fs.writeFileSync(DIGEST_FILE, JSON.stringify(currentFileDigest));
    render({ state: "SYNCING", deploys });
    exec(
      `usr/local/bin/node ${deployScript} > ${LOG_FILE} 2>${LOG_ERROR_FILE}`
    );
    process.exit();
    return;
  }

  // 4.
  // If we hit here, nothing has changed and nothing is in progress,
  // so we just output the latest deploys.
  render({ state: "IDLE", deploys });
  return;
}

/**
 * Render out the string expected by bitbar.
 * Should be pure. No side effects. Same inputs, same outputs.
 * @param {Object} opts
 * @param {boolean} opts.isOffline
 * @param {Array.<Deploy>} deploys
 *
 * log is required if we're SYNCING
 * errorLog is required if we're ERROR
 */
function render({ state, deploys, log, errorLog }) {
  let icon = `|templateImage=`;
  if (state === "OFFLINE" || state === "ERROR") {
    icon += imgToBase64("netlify-sync-warn.png");
  } else if (state === "SYNCING") {
    icon += imgToBase64("netlify-sync-in-progress.png");
  } else {
    icon += imgToBase64("netlify-sync.png");
  }
  console.log(icon);
  console.log("---");

  if (state === "OFFLINE") {
    console.log("No internet connection");
    console.log("Syncing has been temporarily disabled");
    console.log("---");
  }

  if (state === "ERROR") {
    console.log("Error running `deploy.js`");
    console.log("Fix the error then reset the error log. \n\n\n");
    console.log("\n > \n" + errorLog);
    console.log("---");
  }

  if (state === "SYNCING") {
    console.log(`Deploying... | image=${imgToBase64("status-yellow.png")}`);
    if (log) {
      console.log(log);
    }
    console.log("---");
  }

  if (deploys.length > 0) {
    // console.log("Latest Deploys");
    deploys.forEach(deploy => {
      const {
        datetime,
        log,
        // netlify: { admin_url, id },
        error
      } = deploy;

      let time =
        datetime.slice(0, 10) +
        " " +
        new Date(datetime).toTimeString().slice(0, 8);

      console.log(
        time +
          `|image=${imgToBase64(error ? "status-red.png" : "status-green.png")}`
      );

      log.split("\n").forEach(item => {
        if (item) {
          console.log("-- " + item);
        }
      });

      if (error) {
        console.log(error);
      }

      // if (admin_url) {
      //   console.log("-- ---");
      //   console.log(
      //     `-- View deploy on netlify.com | href=${admin_url}/deploys/${id}`
      //   );
      // }
    });
  }

  console.log("---");
  console.log("Refresh Script | refresh=true");
  console.log(
    `Refresh State | terminal=false bash=/bin/rm param1=-f param2=${STATE_FILE} param3=${LOG_FILE} param4=${LOG_ERROR_FILE} param5=${DIGEST_FILE}` // terminal=false doesn't work?
  );
}

/**
 * @typedef {Object} Deploy
 *
 * @property {string} datetime - takes shape as returned by `.toISOString()`
 * @property {string} log - fills in after the deploy is complete
 * @property {string} error
 * @property {FileDigest} fileDigest - key/value mapping of filename to sha1
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

/**
 * @typedef Deploys
 *
 * @property {Deploy} inProgress
 * @property {Array.<Deploy>} completed
 */

/**
 * Generate a new `deploy` object
 * @param {FileDigest} fileDigest
 * @returns {Deploy}
 */
function generateNewDeploy({ log = "", hasError = false }) {
  return {
    datetime: new Date().toISOString(),
    log,
    hasError
    // netlify: {},
    // stick this at the end for easier debugging purposes when reading the file manually
    // fileDigest
  };
}

function getState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE));
  } else {
    const initialState = {
      fileDigest: {},
      deploys: []
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(initialState));
    return initialState;
  }
}

/**
 * Get a digest of file paths and SHA1's of the content for the given directory
 * @returns {FileDigest}
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
