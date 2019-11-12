const fs = require("fs");
const path = require("path");
const os = require("os");
const NetlifyAPI = require("netlify");
const recursive = require("recursive-readdir");
const hasha = require("hasha");
const SRC_DIR = "/Users/jimnielsen/Sites/iosicongallery.com/img/";
const start = new Date();

recursive(SRC_DIR, ["**/.*", "**/_src/*"])
  .then(files => {
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
  })
  .then(files => {
    const end = new Date();
    const elapsed = (end - start) / 1000 + "s";
    console.log(`Done. ${Object.keys(files).length} files, ${elapsed}`);
  });
