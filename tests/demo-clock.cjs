// Test-only control of the real demo generator. Production timers are unchanged.
const { ipcMain } = require("electron");
function installDemoClock() {
  const interval = global.setInterval, clear = global.clearInterval;
  const handle = ipcMain.handle.bind(ipcMain), callbacks = new Map();
  global.setInterval = function(callback, milliseconds, ...args) {
    if (milliseconds !== 3000 || !callback.toString().includes("engine.sampleViewers")) return interval(callback,milliseconds,...args);
    const timer = interval(()=>{},3600000);
    timer.unref();
    callbacks.set(timer,()=>callback(...args));
    return timer;
  };
  global.clearInterval = function(timer) { callbacks.delete(timer); return clear(timer); };
  ipcMain.handle = function(channel, callback) {
    if (channel !== "assist:call") return handle(channel,callback);
    return handle(channel,async(event,action,...args)=>{
      const result=await callback(event,action,...args);
      if (result.ok && ["poll-start","raffle-start","donation-start"].includes(action))
        for (const pulse of callbacks.values()) pulse();
      return result;
    });
  };
}
module.exports={installDemoClock};
