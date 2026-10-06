const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const asar = require("@electron/asar");
const { spawnSync } = require("node:child_process");
async function verify(file) {
  // The packager's unpacked payload is also checked by CI. Extract the ASAR with native ZIP APIs.
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "streamer-msix-asar-"),
  );
  const target = path.join(temporary, "app.asar");
  try {
    const script =
      '$a=[IO.Compression.ZipFile]::OpenRead($env:MSIX_VERIFY_PACKAGE);try{$e=$a.Entries|Where-Object{$_.FullName.Replace("\\","/") -eq "app/resources/app.asar"};[IO.Compression.ZipFileExtensions]::ExtractToFile($e,$env:MSIX_VERIFY_ASAR)}finally{$a.Dispose()}';
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Add-Type -AssemblyName System.IO.Compression.FileSystem;" + script,
      ],
      {
        env: {
          ...process.env,
          MSIX_VERIFY_PACKAGE: file,
          MSIX_VERIFY_ASAR: target,
        },
        stdio: "inherit",
        windowsHide: true,
      },
    );
    if (result.status !== 0) throw new Error("Cannot read packaged ASAR.");
    const files = asar.listPackage(target).map((p) => p.replaceAll("\\", "/"));
    for (const required of [
      "/electron/main.cjs",
      "/electron/app-icon.cjs",
      "/electron/timeline-store.cjs",
      "/electron/timeline-history.cjs",
      "/electron/timeline-export.cjs",
      "/electron/chat-analysis.cjs",
      "/electron/ai-service.cjs",
      "/electron/ai-components.cjs",
      "/electron/ai-components-config.json",
      "/electron/ai-api.cjs",
      "/electron/ai-runtime.cjs",
      "/electron/ai-context.cjs",
      "/electron/ai-models.cjs",
      "/electron/ai-quota.cjs",
      "/electron/ai-usage.cjs",
      "/electron/broadcast-monitor.cjs",
      "/electron/record-store.cjs",
      "/electron/audience.cjs",
      "/resources/privacy.json",
      "/dist/index.html",
    ])
      if (!files.includes(required))
        throw new Error("Missing packaged app file: " + required);
    if (files.some(p => /^\/node_modules\/(react|react-dom|scheduler)(\/|$)/.test(p)))
      throw new Error("Renderer dependencies were bundled twice.");
    if (
      files.some((p) =>
        /(^|\/)(\.env(?:\.[^/]*)?|\.dev|tests|accounts\.enc|credentials\.enc|results\.enc|records\.enc|sessions\.json|channels\.json)(\/|$)/.test(
          p,
        ),
      )
    )
      throw new Error("Private data was embedded in ASAR.");
    if (files.some(p => /^\/ai\/(adapters|components|jobs)(\/|$)/.test(p) || /(^|\/)ai-connectors(\/|$)/.test(p) || /\.(exe|dll|tgz|tar\.gz|saip\.json)$/i.test(p)))
      throw new Error("Downloaded AI runtimes were embedded in ASAR.");
    console.log("PASS: packaged code, privacy document and profile exclusion.");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
if (require.main === module)
  verify(path.resolve(process.argv[2])).catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { verify };
