#!/usr/bin/env /usr/local/bin/node
const https = require("https");
const url = require("url");
const fs = require("fs");
const path = require("path");
const { imgToBase64, getNetlifyOAuth } = require("../helpers.js");

// First fetch all your sites
fetchNetlify("sites")
  // Then fetch the build for each of your sites and append the latest build
  // info into what netlify returns
  .then((sites) => {
    return Promise.all(
      sites.map((site) =>
        fetchNetlify(`sites/${site.site_id}/builds`).then((builds) => ({
          ...site,
          ...(builds && builds[0] && builds[0].id
            ? { __latestBuild__: builds[0] }
            : {}),
        }))
      )
    );
  })
  /*
    [
      {
        // `/sites` endpoint data from netlify
        id: String,
        site_id: String,
        admin_url: <String> links to netlify admin page
        url: <String> ,
        updated_at: <String> ISO8601 format

        // `/sites/:id/builds` data from netlify (the latest object)
        __latestBuild__: {
          "id": "5ceff7f99c0ff20174f10387",
          "deploy_id": "5ceff7f99c0ff20174f10386",
          "sha": null,
          "done": false,
          "error": null,
          "created_at": "2019-05-30T15:34:17.629Z"
        }
      }
    ]
  */
  .then((sites) => {
    // Group the data how i'd like to see it output
    const sitesByDomain = sites.reduce((acc, site) => {
      // All my domain URLs will come in 3 pieces: subdomain.domain.com
      // So I can grab the piece I need. Kinda hacky, but it works.
      const hostname = new URL(site.url).hostname;
      const hostnamePieces = hostname.split(".");

      let domain = "";
      let label = "";
      if (hostname.includes("jim-nielsen.com")) {
        domain = "jim-nielsen.com";
        label = hostnamePieces[0];
      } else if (hostname.includes("netlify.app")) {
        domain = "netlify.app";
        label = hostnamePieces[0];
      } else if (hostname.includes("icongallery.com")) {
        domain = "icongalleries";
        label = hostnamePieces[1].replace("icongallery", "");
      }

      const out = { label, site };

      if (acc[domain]) {
        acc[domain].push(out);
      } else {
        acc[domain] = [out];
      }
      return acc;
    }, {});

    let log = "";
    const addToLog = (str) => (log = log + str + "\n");
    let notifications = 0;

    Object.keys(sitesByDomain)
      .sort()
      .forEach((domain) => {
        addToLog(domain);

        sitesByDomain[domain].forEach(({ label, site }) => {
          let img = imgToBase64("status-clear.png");
          if (site.__latestBuild__) {
            const { done, error } = site.__latestBuild__;

            if (done && error) {
              // Check for done first because it can be done, but also an error
              // meaning the build cancelled
              img = imgToBase64("status-green-red.png");
            } else if (done) {
              img = imgToBase64("status-green.png"); // done
            } else if (error) {
              notifications += 1;
              img = imgToBase64("status-red.png"); // error
            } else {
              notifications += 1;
              img = imgToBase64("status-yellow.png"); // building
            }
          }

          addToLog(`${label} | href=${site.admin_url} image=${img}`);
        });
      });

    // Log it all out
    logMenubar(notifications);
    console.log(log);
  })
  .catch((e) => {
    logMenubar();
    console.log("Whoops, caught an error.");
    console.log(e);
  });

function logMenubar(notifications = 0) {
  console.log(
    `${notifications > 0 ? notifications : ""}|templateImage=${imgToBase64(
      "netlify.png"
    )}`
  );
  console.log("---");
}

/**
 * Take a path to a Netlify API endpoint and return a promise which resolves
 * to the data of that endpoint.
 * @param {*} path
 */
function fetchNetlify(path) {
  const TOKEN = getNetlifyOAuth();
  return new Promise((resolve, reject) => {
    const uri = `https://api.netlify.com/api/v1/${path}/?access_token=${TOKEN}`;
    https
      .get(uri, (res) => {
        let data = "";
        // A chunk of data has been recieved.
        res.on("data", (chunk) => {
          data += chunk;
        });
        // The whole response has been received. Resolve it.
        res.on("end", () => {
          resolve(JSON.parse(data));
        });
      })
      .on("error", (err) => {
        reject("Error: " + err.message);
      });
  });
}
