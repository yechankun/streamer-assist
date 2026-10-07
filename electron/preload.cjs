const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("assist", {
  call: (action, payload) => ipcRenderer.invoke("assist:call", action, payload),
  windowControl: (action) => ipcRenderer.invoke("assist:window", action),
  workspace: (action, payload) => ipcRenderer.invoke("assist:workspace", action, payload),
  subscribeWorkspace: (callback) => {
    const state = (_event, value) => callback("state", value);
    const settings = (_event, value) => callback("settings", value);
    const error = (_event, value) => callback("error", value);
    const resetRoulette = (_event, value) => callback("reset-roulette", value);
    const dismissMenu = () => callback("dismiss-menu");
    ipcRenderer.on("assist:workspace-state", state);
    ipcRenderer.on("assist:workspace-settings", settings);
    ipcRenderer.on("assist:workspace-error", error);
    ipcRenderer.on("assist:workspace-reset-roulette", resetRoulette);
    ipcRenderer.on("assist:workspace-dismiss-menu", dismissMenu);
    return () => {
      ipcRenderer.removeListener("assist:workspace-state", state);
      ipcRenderer.removeListener("assist:workspace-settings", settings);
      ipcRenderer.removeListener("assist:workspace-error", error);
      ipcRenderer.removeListener("assist:workspace-reset-roulette", resetRoulette);
      ipcRenderer.removeListener("assist:workspace-dismiss-menu", dismissMenu);
    };
  },
  subscribe: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("assist:state", listener);
    return () => ipcRenderer.removeListener("assist:state", listener);
  },
});
