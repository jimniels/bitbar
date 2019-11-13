const fs = require("fs");
const path = require("path");

/**
 * Given an image file name in our `img/` folder, give back that file
 * as a base64 encoded string
 * @param {String}
 * @returns {String}
 */
function imgToBase64(imageFile) {
  return fs.readFileSync(path.join(__dirname, "img", imageFile), "base64");
}

function getNetlifyOAuth() {
  return fs
    .readFileSync(path.join(__dirname, "../.netlify-oauth.token"))
    .toString()
    .trim();
}

module.exports = {
  imgToBase64,
  getNetlifyOAuth
};
