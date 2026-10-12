const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { spawnSync } = require("node:child_process"), { parseEnv } = require("node:util");
const { pipeline } = require("node:stream/promises"), { Readable, Transform } = require("node:stream");
const root = path.resolve(__dirname, ".."), target = path.join(root, "release", "google-oauth-demo");
const version = "9.0.2", expectedHash = "4705843ccaaf54257c16ad90f3e952ece33c17df964ecf7bfdbb0f49c7171077";
async function main() {
  if (process.platform !== "win32") throw Error("This recorder uses Windows screen capture.");
  require("./build-cache.cjs").assertCheckedBuild(root);
  const config = parseEnv(fs.readFileSync(path.join(root, ".env.local"), "utf8"));
  if (config.STREAMER_ASSIST_GOOGLE_CLIENT_ID !== require("../electron/oauth-config.json").youtubeClientId || !config.STREAMER_ASSIST_GOOGLE_CLIENT_SECRET)
    throw Error("Set the submitted Desktop OAuth client in .env.local before recording.");
  fs.mkdirSync(target, { recursive: true });
  const tools = path.join(target, "tools"); fs.mkdirSync(tools, { recursive: true });
  if (!fs.existsSync(path.join(tools, "ffmpeg.exe")) || !fs.existsSync(path.join(tools, "ffprobe.exe"))) {
    const archive = path.join(tools, "ffmpeg-" + version + ".7z");
    if (!fs.existsSync(archive) || crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex") !== expectedHash) {
      console.log("Downloading FFmpeg " + version + " from the Windows build provider linked by ffmpeg.org.");
      const response = await fetch("https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-" + version + "-essentials_build.7z", { signal: AbortSignal.timeout(600000) });
      if (!response.ok || !response.body) throw Error("FFmpeg download failed: HTTP " + response.status);
      let bytes = 0; const hash = crypto.createHash("sha256");
      let progress = 0;
      const check = new Transform({ transform(chunk, _encoding, done) { bytes += chunk.length; if (bytes > 60 * 1024 * 1024) return done(Error("Unexpected FFmpeg archive size")); if (bytes - progress >= 8 * 1024 * 1024) { progress = bytes; console.log("Download progress: " + Math.round(bytes / 1024 / 1024) + " MiB"); } hash.update(chunk); done(null, chunk); } });
      await pipeline(Readable.fromWeb(response.body), check, fs.createWriteStream(archive + ".part"));
      if (hash.digest("hex") !== expectedHash) throw Error("FFmpeg SHA-256 mismatch; the downloaded file was not executed.");
      fs.renameSync(archive + ".part", archive);
    }
    const extract = spawnSync("pwsh.exe", ["-NoProfile", "-File", path.join(__dirname, "extract-oauth-demo-tools.ps1"), "-Archive", archive, "-Target", tools], { stdio: "inherit", windowsHide: true });
    if (extract.status !== 0) throw Error("FFmpeg extraction failed.");
  }
  for (const exe of ["ffmpeg", "ffprobe"]) {
    const result = spawnSync(path.join(tools, exe + ".exe"), ["-version"], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0 || !result.stdout.includes("version " + version)) throw Error("Unexpected " + exe + " version");
  }
  fs.writeFileSync(path.join(tools, "source.json"), JSON.stringify({ version, sha256: expectedHash, provider: "https://www.gyan.dev/ffmpeg/builds/", officialDownloadPage: "https://ffmpeg.org/download.html" }, null, 2));
  fs.copyFileSync(path.join(__dirname, "oauth-demo-scenes.json"), path.join(target, "scenes.json"));
  const launch = '@echo off\r\npwsh.exe -STA -NoProfile -WindowStyle Hidden -File "%~dp0..\\..\\scripts\\record-oauth-demo.ps1"\r\n';
  fs.writeFileSync(path.join(target, "record-demo.cmd"), launch);
  fs.writeFileSync(path.join(target, "README.txt"), '\uFEFF' + [
    "Google OAuth 데모 촬영", "", "record-demo.cmd를 실행합니다. 앱 열기 → 촬영 영역 선택 → 녹화 시작 순서로 진행합니다.",
    "F6: 녹화 시작/일시 중지, F7: 다음 장면, F8: 녹화 종료 및 영어 자막 영상 만들기.",
    "녹화는 직접 시작하기 전에는 실행되지 않습니다. 마이크·컴퓨터 소리는 녹음하지 않습니다.",
    "앱과 브라우저를 같은 촬영 영역에 두세요. 제어 창은 촬영 영역 밖에 놓습니다.",
    "Google 권한 동의는 English로 보여주세요. 비밀번호·인증 코드 입력 전 F6으로 멈추고 입력 후 다시 시작하세요.",
    "촬영용 앱은 별도 로컬 프로필입니다. 실제 계정·Google 권한·YouTube 방송은 본인이 조작합니다. 테스트 채팅 생성은 끕니다.",
    "같은 계정의 Google 권한을 철회하면 다른 설치의 이 앱 연결에도 영향을 줄 수 있습니다. 별도 테스트 계정을 권장합니다.",
    "각 장면 안내를 따라 실제 동작을 촬영하세요. 장면 선택과 자막은 API 동작의 성공을 자동 입증하지 않습니다.",
    "완료된 session 폴더의 google-oauth-demo.mp4를 확인한 뒤 일부 공개로 업로드합니다. 원본은 segments 폴더에 남습니다.",
    "영상 검토 뒤 docs/google-oauth-scope-justification.txt의 사유와 일부 공개 URL을 검증 센터에 입력합니다.",
    "FFmpeg는 로컬 촬영·편집용이며 앱 설치 프로그램에 포함하지 않습니다."
  ].join("\r\n"));
  console.log("Ready: " + path.join(target, "record-demo.cmd"));
  console.log("App version " + require("../package.json").version + "; submitted OAuth client matched; no recording or Google request started.");
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
