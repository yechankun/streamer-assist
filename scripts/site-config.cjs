const fs = require("node:fs"), path = require("node:path");
function siteConfig(root) {
  const config = JSON.parse(fs.readFileSync(path.join(root, "resources/website.json"), "utf8"));
  const url = new URL(config.publicUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || !url.pathname.endsWith("/")) throw Error("Website publicUrl must be an HTTPS base URL ending with /.");
  return { ...config, publicUrl: url.href };
}
module.exports = { siteConfig };
