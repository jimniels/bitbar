const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, ".state.json");

const state = JSON.parse(fs.readFileSync(file));
fs.writeFileSync(file, JSON.stringify({ ...state, status: "NEEDS_DEPLOY" }));
