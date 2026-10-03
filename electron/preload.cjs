const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("assist", {
  call: (action, payload) => ipcRenderer.invoke("assist:call", action, payload),
  subscribe: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("assist:state", listener);
    return () => ipcRenderer.removeListener("assist:state", listener);
  },
});
