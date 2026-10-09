const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { assertCheckedBuild } = require("./build-cache.cjs");
const { assetsFresh, recordAssets, needsNativeRebuild } = require("./package-cache.cjs");
const { performance } = require("node:perf_hooks");
const { build, Platform, Arch } = require("electron-builder");
const {
  storeConfig,
  localConfig,
  manifest,
  packageVersion,
} = require("./store-config.cjs");
const root = path.resolve(__dirname, "..");
function createMsix(output,generated,name,timings) {
  const start=performance.now();
  return new Promise((resolve,reject)=>{
    const child=spawn("powershell.exe",["-NoProfile","-File",path.join(__dirname,"pack-msix.ps1"),
      "-PayloadDirectory",path.join(output,"win-unpacked"),"-ManifestPath",path.join(generated,"AppxManifest.xml"),
      "-OutputFile",path.join(output,name)],{cwd:root,stdio:"inherit",windowsHide:true});
    child.once("error",reject);
    child.once("exit",code=>{
      timings.msix=Math.round(performance.now()-start);
      code===0?resolve():reject(Error("MSIX packaging failed ("+code+")."));
    });
  });
}
async function main() {
  const started = performance.now(), timings = {};
  assertCheckedBuild(root);
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
  const output = path.join(root, "release", "package-work-" + Date.now() + "-" + process.pid);
  const generated = path.join(output, "config");
  fs.mkdirSync(generated, { recursive: true });
  const configFile = path.join(root, "electron/oauth-config.json");
  const base = JSON.parse(fs.readFileSync(configFile, "utf8"));
  const client = {
    youtubeClientId:
      process.env.GOOGLE_DESKTOP_CLIENT_ID || base.youtubeClientId || "",
    youtubeClientSecret: process.env.GOOGLE_DESKTOP_CLIENT_SECRET || "",
    twitchClientId: process.env.TWITCH_CLIENT_ID || base.twitchClientId || "",
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
  const assetsStarted = performance.now();
  if (!assetsFresh(root)) {
    const assets = spawnSync("powershell.exe",["-NoProfile","-File",path.join(__dirname,"generate-assets.ps1")],
      {cwd:root,stdio:"inherit",windowsHide:true});
    if(assets.status!==0)throw Error("Asset generation failed.");
    recordAssets(root);
  } else console.log("Verified application assets reused.");
  timings.assets = Math.round(performance.now() - assetsStarted);
  const nativeRebuild = needsNativeRebuild(root);
  if(!nativeRebuild)console.log("Pure JavaScript production dependencies: no native rebuild needed.");
  const config = {
    ...pkg.build,
    directories: { ...pkg.build.directories, output },
    // npm ci already supplies the exact Electron binary. Copying it avoids a redundant extraction/rename on Windows.
    electronDist: path.dirname(require("electron")),
    extends: null,
    compression: "normal",
    npmRebuild: nativeRebuild,
    // App UI and Store listing support Korean; en-US is Chromium's fallback.
    electronLanguages: ["en-US", "ko"],
    files: [...pkg.build.files, "resources/privacy.json", "resources/terms.json"],
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
  let msixJob=null,parallelReady=false;
  if(modes.includes("nsis")&&modes.includes("appx")) {
    config.afterPack=async context=>{
      const target=context.targets.find(target=>target.name==="nsis");
      const helper=target?.packageHelper?.elevateHelper;
      // Prepare the target's normal helper before the application is signed.
      // Its own copy cache then makes NSIS compression a read-only operation.
      // Unsupported builder versions retain the sequential path.
      if(typeof helper?.copy==="function") {
        await helper.copy(context.appOutDir,target);
        parallelReady=true;
      }
    };
    config.artifactBuildStarted=event=>{
      if(event.targetPresentableName==="nsis"&&parallelReady&&!msixJob) {
        timings.parallelCompression=true;
        msixJob=createMsix(output,generated,config.appx.artifactName,timings);
        void msixJob.catch(()=>{}); // Awaited below even if the EXE build fails.
      }
    };
  }
  try {
    const builderStarted=performance.now();
    let builderFailure;
    try {
      await build({
        targets:Platform.WINDOWS.createTarget(modes.map(mode=>mode==="appx"?"dir":mode),Arch.x64),
        config,publish:"never"
      });
    } catch(error) { builderFailure=error; }
    timings.electronAndNsis=Math.round(performance.now()-builderStarted);
    let msixFailure;
    if(modes.includes("appx")) {
      if(!msixJob&&!builderFailure)msixJob=createMsix(output,generated,config.appx.artifactName,timings);
      if(msixJob)try{await msixJob;}catch(error){msixFailure=error;}
    }
    if(builderFailure)throw builderFailure;
    if(msixFailure)throw msixFailure;
  for (const name of fs.readdirSync(output)) {
    if (/Setup\.exe(?:\.blockmap)?$|\.msix$|^latest\.yml$/.test(name))
      {
        const source=path.join(output,name),destination=path.join(root,"release",name),temporary=destination+".tmp-"+process.pid;
        try { fs.linkSync(source,temporary); } catch { fs.copyFileSync(source,temporary); }
        fs.renameSync(temporary,destination);
      }
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
  } finally {
    const cleanupStarted = performance.now();
    // Remove only this invocation's scratch files, including generated OAuth config.
    const releaseRoot = fs.realpathSync(path.join(root, "release"));
    if (fs.existsSync(output)) {
      const stat = fs.lstatSync(output), resolved = fs.realpathSync(output);
      if (!stat.isSymbolicLink() && resolved.startsWith(releaseRoot + path.sep) &&
          path.basename(resolved).startsWith("package-work-")) {
        fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    }
    timings.cleanup = Math.round(performance.now() - cleanupStarted);
    timings.total = Math.round(performance.now() - started);
    fs.writeFileSync(path.join(root,"release/build-timings.json"),JSON.stringify({ modes, milliseconds: timings },null,2));
    console.log("Packaging phases (ms): " + JSON.stringify(timings));
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
