function startupSettings(app, packagedStore) {
  if (packagedStore)
    return {
      startupAvailable: false,
      startupManagedByWindows: true,
      openAtLogin: false,
    };
  return {
    startupAvailable: app.isPackaged,
    startupManagedByWindows: false,
    openAtLogin: app.isPackaged
      ? app.getLoginItemSettings({ args: ["--hidden"] }).openAtLogin
      : false,
  };
}
module.exports = { startupSettings };
