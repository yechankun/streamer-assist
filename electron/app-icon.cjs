const fs = require("node:fs");
const path = require("node:path");
function loadAppIcon(nativeImage, resourceDirectory) {
  const file = resourceDirectory
    ? path.join(resourceDirectory, "app-icon.png")
    : path.join(__dirname, "../build/appx/AppIcon256.png");
  const icon = nativeImage.createFromBuffer(fs.readFileSync(file));
  if (icon.isEmpty()) throw new Error("Cannot decode application icon.");
  return icon;
}
module.exports = { loadAppIcon };
