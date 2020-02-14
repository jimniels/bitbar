const fs = require("fs");
const path = require("path");
const { STATE_FILE } = require("./netlify-sync.5s.js");

const state = JSON.parse(fs.readFileSync(STATE_FILE));
fs.writeFileSync(
  STATE_FILE,
  JSON.stringify({ ...state, status: "NEEDS_DEPLOY" })
);
