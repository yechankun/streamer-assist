// Sequential suites avoid global-shortcut contention. Child profiles are reclaimed
// after Electron exits; --screenshots additionally captures successful screens.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { spawn } = require("node:child_process");
const suites = ["icon", "desktop", "timeline", "presentation", "audience", "twitch", "privacy", "youtube-consent", "lifecycle", "ai", "ai-component", "design", "workspace", "collection", "appearance", "idle", "replay"];
async function main() {
  const args=process.argv.slice(2), option=args.indexOf("--suite");
  const positional=option<0?args.filter(value=>!value.startsWith("--")).flatMap(value=>value.split(",")):[];
  const named=option<0?[]:args.slice(option+1).filter(value=>!value.startsWith("--")).flatMap(value=>value.split(","));
  const selected=[...new Set(option>=0?named:positional.length?positional:suites)];
  if (args.some(value=>value.startsWith("--") && !["--build","--screenshots","--suite","--hidden"].includes(value)))
    throw new Error("Unknown test option. Use --build, --screenshots, --hidden or --suite.");
  if (!selected?.length || selected.some(name=>!suites.includes(name)))
    throw new Error("--suite expects one or more of: "+suites.join(", "));
  if (args.includes("--build")) {
    await new Promise((resolve,reject)=>{
      const child=process.env.npm_execpath
        ? spawn(process.execPath,[process.env.npm_execpath,"run","build"],{stdio:"inherit",windowsHide:true})
        : spawn("npm run build",{stdio:"inherit",shell:true,windowsHide:true});
      child.once("error",reject);
      child.once("exit",code=>code===0?resolve():reject(new Error("Renderer build failed")));
    });
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(),"streamer-desktop-tests-"));
  const root = path.resolve(__dirname,".."), timings = [];
  // Parse test and backend modules in Node before Electron can show a native
  // startup-error dialog. This is fast and does not execute module code.
  const syntaxFiles = [...selected.map(suite => path.join(root,"tests",suite+"-smoke.cjs")), path.join(root,"tests","hidden-runner.cjs"),
    ...fs.readdirSync(path.join(root,"electron")).filter(file => file.endsWith(".cjs")).map(file => path.join(root,"electron",file))];
  try {
    for (const file of syntaxFiles) new (require("node:vm").Script)(require("node:module").wrap(fs.readFileSync(file,"utf8")), { filename: file });
    for (const suite of selected) {
      const start = Date.now();
      const stages = ["workspace", "appearance"].includes(suite) ? ["0", "1"] : ["0"];
      for (const restart of stages) await new Promise((resolve,reject)=>{
        const smoke = path.join(root,"tests",suite+"-smoke.cjs");
        const testArgs = args.includes("--hidden") ? [path.join(root,"tests","hidden-runner.cjs"),smoke,"--hidden"] : [smoke];
        const child = spawn(process.execPath,[require.resolve("electron/cli.js"),...testArgs],{
          cwd: root, stdio: "inherit", windowsHide: true,
          env: { ...process.env, STREAMER_ASSIST_TEST_PROFILE: path.join(temporary,suite), STREAMER_ASSIST_TEST_SCREENSHOTS: args.includes("--screenshots")?"1":"0", STREAMER_ASSIST_WORKSPACE_RESTART: restart, STREAMER_ASSIST_APPEARANCE_RESTART: restart }
        });
        const timeout = setTimeout(()=>{child.kill();reject(new Error(suite+" exceeded 120 seconds"));},120000);
        child.once("error",error=>{clearTimeout(timeout);reject(error);});
        child.once("exit",code=>{clearTimeout(timeout);code===0?resolve():reject(new Error(suite+" exited with "+code));});
      });
      timings.push({ suite, milliseconds: Date.now()-start });
    }
    fs.mkdirSync(path.join(root,"release"),{recursive:true});
    const report=selected.length===suites.length?"desktop-test-results.json":"desktop-test-results-"+selected.join("-")+".json";
    fs.writeFileSync(path.join(root,"release",report),JSON.stringify(timings,null,2));
    console.log("PASS: "+selected.length+" desktop suites in "+(timings.reduce((n,t)=>n+t.milliseconds,0)/1000).toFixed(1)+"s; temporary profiles reclaimed.");
  } finally {
    const resolved=fs.realpathSync(temporary);
    if (fs.lstatSync(temporary).isSymbolicLink() || !resolved.startsWith(fs.realpathSync(os.tmpdir())+path.sep+"streamer-desktop-tests-"))
      throw new Error("Unsafe desktop profile cleanup");
    fs.rmSync(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  }
}
// Node's default unit-test discovery matches this test-* filename. Desktop
// tests must be started explicitly so discovery cannot open Electron windows.
if (require.main===module && !process.env.NODE_TEST_CONTEXT) main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={suites};
