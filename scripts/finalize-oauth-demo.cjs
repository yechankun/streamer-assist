const fs = require("node:fs"), path = require("node:path"), { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..", "release", "google-oauth-demo");
function stamp(seconds) { const ms = Math.round(seconds * 1000); return [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60].map(n => String(n).padStart(2, "0")).join(":") + "," + String(ms % 1000).padStart(3, "0"); }
function main(directory, { draft = false } = {}) {
  const resolved = fs.realpathSync(directory);
  if (!resolved.startsWith(fs.realpathSync(root) + path.sep) || fs.lstatSync(directory).isSymbolicLink()) throw Error("Select a recording session inside the demo directory.");
  const manifest = JSON.parse(fs.readFileSync(path.join(resolved, "recording.json"), "utf8").replace(/^\uFEFF/, ""));
  const scenes = require("./oauth-demo-scenes.json").scenes;
  const ffmpeg = path.join(root, "tools", "ffmpeg.exe"), ffprobe = path.join(root, "tools", "ffprobe.exe");
  let offset = 0, subtitles = [], index = 0; const observed = new Set(), segments = [];
  for (const part of manifest.parts) {
    if (!/^segment-\d+\.(mp4|mkv)$/.test(part.file)) throw Error("Unexpected recording filename.");
    let relative = "segments/" + part.file; const file = path.join(resolved, relative);
    const probe = spawnSync(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height", "-of", "json", file], { encoding: "utf8", windowsHide: true });
    if (probe.status !== 0) throw Error("Recording segment is unreadable; originals were preserved.");
    const info = JSON.parse(probe.stdout), seconds = Number(info.format?.duration);
    if (!Number.isFinite(seconds) || seconds <= 0 || !info.streams.some(s => s.codec_name === "h264")) throw Error("Invalid recording segment");
    const scene = scenes.find(s => s.id === part.scene); if (!scene) throw Error("Unknown demo scene.");
    {
      // OBS output modes use different time bases even for MP4 files.
      // Normalize every take before concatenation, preserving all originals.
      fs.mkdirSync(path.join(resolved, "normalized"), { recursive: true });
      relative = "normalized/" + part.file.replace(/\.(mp4|mkv)$/, ".mp4");
      const normalized = spawnSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "warning", "-i", file, "-an", "-vf", "setpts=PTS-STARTPTS", "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-video_track_timescale", "15360", path.join(resolved, relative)], { stdio: "inherit", windowsHide: true });
      if (normalized.status !== 0) throw Error("Recording normalization failed; originals were preserved.");
    }
    observed.add(scene.id); segments.push("file '" + relative + "'");
    const caption = part.caption === undefined ? scene.caption : part.caption;
    if (typeof caption !== "string" || !caption.trim() || caption.length > 1000) throw Error("Invalid scene caption.");
    const words = caption.split(" "); let lines = [""];
    for (const word of words) { if ((lines.at(-1) + " " + word).trim().length > 82) lines.push(word); else lines[lines.length - 1] = (lines.at(-1) + " " + word).trim(); }
    subtitles.push(++index + "\n" + stamp(offset) + " --> " + stamp(offset + seconds) + "\n" + lines.join("\n")); offset += seconds;
  }
  if (!segments.length) throw Error("No footage recorded.");
  fs.writeFileSync(path.join(resolved, "concat.txt"), segments.join("\n") + "\n");
  fs.writeFileSync(path.join(resolved, "captions.en.srt"), subtitles.join("\n\n") + "\n");
  const outputName = manifest.testOnly ? "recorder-smoke.mp4" : draft ? "oauth-demo-draft.mp4" : "google-oauth-demo.mp4";
  const args = ["-y", "-hide_banner", "-loglevel", "warning", "-f", "concat", "-safe", "1", "-i", "concat.txt", "-vf", "scale=1920:960:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=1920:1080:(ow-iw)/2:0:color=black,setsar=1,subtitles=filename=captions.en.srt:force_style='FontName=Arial,Fontsize=12,Outline=1,MarginV=7,Alignment=2'", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outputName];
  const result = spawnSync(ffmpeg, args, { cwd: resolved, stdio: "inherit", windowsHide: true });
  if (result.status !== 0) throw Error("Video rendering failed; recorded segments and subtitles were preserved.");
  const output = path.join(resolved, outputName);
  const probe = spawnSync(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height,avg_frame_rate", "-of", "json", output], { encoding: "utf8", windowsHide: true });
  const info = JSON.parse(probe.stdout); if (probe.status !== 0 || !info.streams.some(s => s.codec_name === "h264" && s.width === 1920 && s.height === 1080)) throw Error("Final video verification failed.");
  if (Math.abs(Number(info.format.duration) - offset) > 2 || !info.streams.some(s => s.codec_name === "h264" && s.avg_frame_rate === "30/1")) throw Error("Final video timing verification failed.");
  const missingScenes = scenes.filter(scene => scene.required && !observed.has(scene.id)).map(scene => scene.id);
  fs.writeFileSync(path.join(resolved, draft ? "draft-review.json" : "review.json"), JSON.stringify({ output: outputName, draft, testOnly: manifest.testOnly === true, duration: Number(info.format.duration), missingScenes, status: manifest.testOnly ? "Tool verification only; do not submit" : draft ? "Incomplete real-footage draft; do not submit" : "Recorded footage requires human review before submission", actualOAuthAndApiSuccess: "Not inferred from chapter markers", privateLoginFrames: "Review before upload", uploaded: false }, null, 2));
  console.log("Created 1920x1080 video with English subtitles. Required scenes missing: " + (missingScenes.join(", ") || "none") + ". Review real OAuth/API actions before upload.");
  return { output, missingScenes };
}
if (require.main === module) { try { main(process.argv[2], { draft: process.argv.includes("--draft") }); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { main, stamp };
