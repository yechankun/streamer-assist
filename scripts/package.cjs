const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { build, Platform, Arch } = require("electron-builder");
const {
  storeConfig,
  localConfig,
  manifest,
  packageVersion,
} = require("./store-config.cjs");
const root = path.resolve(__dirname, "..");
async function main() {
  if (process.platform !== "win32")
    throw new Error("Windows packaging must run on Windows.");
  const modes = process.argv.includes("--all")
    ? ["nsis", "appx"]
    : process.argv.includes("--msix")
      ? ["appx"]
      : ["nsis"];
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const store = storeConfig(process.env, localConfig(root));
  const generated = path.join(root, ".build-generated");
  fs.mkdirSync(generated, { recursive: true });
  const configFile = path.join(root, "electron/oauth-config.json");
  const base = JSON.parse(fs.readFileSync(configFile, "utf8"));
  const client = {
    youtubeClientId:
      process.env.GOOGLE_DESKTOP_CLIENT_ID || base.youtubeClientId || "",
    youtubeClientSecret: process.env.GOOGLE_DESKTOP_CLIENT_SECRET || "",
  };
  if (
    client.youtubeClientSecret &&
    !client.youtubeClientId.endsWith(".apps.googleusercontent.com")
  )
    throw new Error("Invalid Google Desktop client configuration.");
  fs.writeFileSync(
    path.join(generated, "oauth-client.json"),
    JSON.stringify(client),
  );
  fs.writeFileSync(
    path.join(generated, "AppxManifest.xml"),
    manifest(store, pkg.version),
  );
  const assets = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-File", path.join(__dirname, "generate-assets.ps1")],
    { cwd: root, stdio: "inherit", windowsHide: true },
  );
  if (assets.status !== 0) throw new Error("Asset generation failed.");
  const output = path.join(
    root,
    "release",
    "package-work-" + Date.now() + "-" + process.pid,
  );
  const config = {
    ...pkg.build,
    directories: { ...pkg.build.directories, output },
    // npm ci already supplies the exact Electron binary. Copying it avoids a redundant extraction/rename on Windows.
    electronDist: path.dirname(require("electron")),
    extends: null,
    files: [...pkg.build.files, "resources/privacy.json"],
    extraResources: [
      {
        from: path.join(root, "build/appx/AppIcon256.png"),
        to: "app-icon.png",
      },
      {
        from: path.join(generated, "oauth-client.json"),
        to: "oauth-client.json",
      },
    ],
    win: {
      ...pkg.build.win,
      icon: "build/icon.ico",
      signAndEditExecutable: true,
    },
    appx: {
      identityName: store.identityName,
      publisher: store.publisher,
      publisherDisplayName: store.publisherDisplayName,
      applicationId: "StreamerAssist",
      displayName: store.displayName,
      languages: ["ko-KR"],
      artifactName:
        "Streamer-Assist-" +
        pkg.version +
        "-x64" +
        (store.configured ? "" : "-dev") +
        ".msix",
      customManifestPath: path.join(generated, "AppxManifest.xml"),
      addAutoLaunchExtension: false,
      setBuildNumber: false,
      minVersion: "10.0.19041.0",
      backgroundColor: "#111214",
    },
  };
  await build({
    targets: Platform.WINDOWS.createTarget(
      modes.map((mode) => (mode === "appx" ? "dir" : mode)),
      Arch.x64,
    ),
    config,
    publish: "never",
  });
  if (modes.includes("appx")) {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-File",
        path.join(__dirname, "pack-msix.ps1"),
        "-PayloadDirectory",
        path.join(output, "win-unpacked"),
        "-ManifestPath",
        path.join(generated, "AppxManifest.xml"),
        "-OutputFile",
        path.join(output, config.appx.artifactName),
      ],
      { cwd: root, stdio: "inherit", windowsHide: true },
    );
    if (result.status !== 0) throw new Error("MSIX packaging failed.");
  }
  for (const name of fs.readdirSync(output)) {
    if (/Setup\.exe$|\.msix$/.test(name))
      fs.copyFileSync(
        path.join(output, name),
        path.join(root, "release", name),
      );
  }
  if (modes.includes("appx")) {
    const metadata = {
      appVersion: pkg.version,
      packageVersion: packageVersion(pkg.version),
      identityName: store.identityName,
      publisher: store.publisher,
      publisherDisplayName: store.publisherDisplayName,
      displayName: store.displayName,
      productId: store.productId,
      developmentIdentity: !store.configured,
      googleConfigured: !!(
        client.youtubeClientId && client.youtubeClientSecret
      ),
      file: config.appx.artifactName,
      storeReady: !!(
        store.configured &&
        store.productId &&
        client.youtubeClientSecret
      ),
    };
    fs.writeFileSync(
      path.join(root, "release/store-package.json"),
      JSON.stringify(metadata, null, 2),
    );
    console.log(
      "MSIX created. Store identity: " +
        (store.configured ? "configured" : "development") +
        "; Google Desktop config: " +
        (metadata.googleConfigured ? "configured" : "not configured"),
    );
  }
}
if (require.main === module)
  main().catch((error) => {
    let message = String(error?.stack || error);
    const secret = process.env.GOOGLE_DESKTOP_CLIENT_SECRET;
    if (secret) message = message.replaceAll(secret, "[redacted]");
    console.error(message);
    process.exitCode = 1;
  });
module.exports = { main };
