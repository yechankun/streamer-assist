// Uses Electron's actual PNG decoder without opening a window or touching real profiles.
const { app, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { loadAppIcon } = require("../electron/app-icon.cjs");
const profile = path.join(
  __dirname,
  "../release/icon-smoke-profile-" + Date.now(),
);
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
app
  .whenReady()
  .then(() => {
    try {
      const developmentIcon = loadAppIcon(nativeImage);
      assert.equal(developmentIcon.isEmpty(), false);
      assert.deepEqual(developmentIcon.getSize(), { width: 256, height: 256 });
      for (const size of [16, 24, 32, 48]) {
        assert.equal(
          developmentIcon.resize({ width: size, height: size }).isEmpty(),
          false,
        );
      }
      const resource = path.join(profile, "app-icon.png");
      fs.copyFileSync(
        path.join(__dirname, "../build/appx/AppIcon256.png"),
        resource,
      );
      const packagedIcon = loadAppIcon(nativeImage, profile);
      assert.deepEqual(packagedIcon.toBitmap(), developmentIcon.toBitmap());
      fs.writeFileSync(resource, Buffer.from("invalid PNG data"));
      assert.throws(
        () => loadAppIcon(nativeImage, profile),
        /Cannot decode application icon/,
      );
      console.log(
        "PASS: window/tray icon decodes in development and packaged paths; corrupted assets are rejected.",
      );
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
