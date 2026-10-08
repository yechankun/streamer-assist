// Render the existing logo and brand typography into committed share images.
// Run explicitly with: node node_modules/electron/cli.js scripts/generate-social-preview.cjs
const {app,BrowserWindow}=require("electron");
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const root=path.resolve(__dirname,"..");
const profile=path.join(root,".dev/social-preview-profile");fs.mkdirSync(profile,{recursive:true});app.setPath("userData",profile);
app.commandLine.appendSwitch("force-device-scale-factor","1");
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-features","CalculateNativeWinOcclusion");
function template(english){
 const logo="data:image/svg+xml;base64,"+fs.readFileSync(path.join(root,"docs/assets/logo.svg")).toString("base64");
 return `<!doctype html><html lang="${english?'en':'ko'}"><meta charset="utf-8"><style>
 *{box-sizing:border-box}html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#101413;color:#edf4ef;font-family:"Segoe UI","Malgun Gothic",sans-serif}
 .card{height:630px;position:relative;text-align:center;display:flex;flex-direction:column;align-items:center;padding:62px 50px 40px;background:radial-gradient(ellipse at 50% 5%,#1c3c2b 0%,#101413 65%)}
 .card:before{content:"";position:absolute;inset:24px;border:1px solid #2d4839;border-radius:22px;pointer-events:none}
 .logo{width:104px;height:104px;border-radius:27px;box-shadow:0 12px 48px #65edaf14}
 h1{font-size:76px;letter-spacing:-4px;line-height:1.1;margin:25px 0 20px;font-weight:720}
 .tagline{font-size:31px;letter-spacing:-.6px;line-height:1.5;margin:0;color:#c3d2c8}
 .platforms{display:flex;gap:12px;margin-top:34px;font-size:20px;font-weight:600}
 .platforms span{padding:10px 21px;border:1px solid #365141;background:#18271e;border-radius:8px;color:#83f2b7}
 .footer{margin-top:auto;font-size:17px;color:#9cb0a4;letter-spacing:.4px}.footer i{display:inline-block;width:7px;height:7px;border-radius:50%;background:#65edaf;margin:0 10px 2px}
 </style><div class="card"><img class="logo" src="${logo}" alt=""><h1>Streamer Assist</h1><p class="tagline">${english?'Broadcast archives. Audience participation.':'방송 기록과 시청자 참여를 한곳에.'}</p><div class="platforms"><span>${english?'CHZZK':'치지직'}</span><span>YouTube</span><span>Twitch</span></div><p class="footer">Windows 10 / 11 · x64 <i></i> ${english?'Open source':'오픈소스'}</p></div></html>`;
}
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false,width:1200,height:630,useContentSize:true,webPreferences:{offscreen:true}});
 window.webContents.setBackgroundThrottling(false);
 try{
  for(const english of [false,true]){
   await window.loadURL("data:text/html;charset=utf-8,"+encodeURIComponent(template(english)));
   const fits=await window.webContents.executeJavaScript("(async()=>{await document.fonts.ready;await document.querySelector('.logo').decode();return [...document.querySelectorAll('h1,.tagline,.platforms,.footer')].every(e=>{const r=e.getBoundingClientRect();return r.left>=24&&r.right<=1176&&r.top>=24&&r.bottom<=606;});})()");
   assert(fits,"Share image content clipped");
   await new Promise(resolve=>setTimeout(resolve,200));
   const image=await window.webContents.capturePage();assert.deepEqual(image.getSize(),{width:1200,height:630});
   const file=path.join(root,"docs/assets",english?"social-preview.en.png":"social-preview.png");fs.writeFileSync(file,image.toPNG());console.log("Generated "+path.basename(file)+" (1200x630)");
  }
  window.destroy();app.exit(0);
 }catch(error){console.error(error);window.destroy();app.exit(1);}
});
