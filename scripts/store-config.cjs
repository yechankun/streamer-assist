const fs = require("node:fs");
const path = require("node:path");
const DEV_IDENTITY = {
  identityName: "StreamerAssist.Development",
  publisher: "CN=StreamerAssistDevelopment",
  publisherDisplayName: "yechankun",
  productId: "",
};
function packageVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error(
      "Store releases require a stable major.minor.patch version.",
    );
  const [major, minor, patch] = version.split(".").map(Number);
  if (major >= 65535 || minor > 65535 || patch > 65535)
    throw new Error("Version exceeds MSIX limits.");
  // Store requires a positive major and a zero revision. This remains monotonic through 0.x -> 1.x.
  return [major + 1, minor, patch, 0].join(".");
}
function xml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
}
function storeConfig(env = process.env, local = {}) {
  const values = {
    identityName: env.MSIX_IDENTITY_NAME || local.identityName || "",
    publisher: env.MSIX_PUBLISHER || local.publisher || "",
    publisherDisplayName:
      env.MSIX_PUBLISHER_DISPLAY_NAME || local.publisherDisplayName || "",
    productId: env.MSSTORE_PRODUCT_ID || local.productId || "",
  };
  const configured = !!(
    values.identityName ||
    values.publisher ||
    values.publisherDisplayName ||
    values.productId
  );
  if (!configured) return { ...DEV_IDENTITY, configured: false };
  if (
    !/^[A-Za-z0-9][A-Za-z0-9.-]{2,49}$/.test(values.identityName) ||
    /^Microsoft\./i.test(values.identityName)
  )
    throw new Error("Invalid MSIX_IDENTITY_NAME.");
  if (
    !/^CN=.+/.test(values.publisher) ||
    values.publisher.length > 512 ||
    /[\u0000-\u001f]/.test(values.publisher)
  )
    throw new Error(
      "MSIX_PUBLISHER must match the Partner Center Publisher value.",
    );
  if (
    !values.publisherDisplayName ||
    values.publisherDisplayName.length > 256 ||
    /[\u0000-\u001f]/.test(values.publisherDisplayName)
  )
    throw new Error("MSIX_PUBLISHER_DISPLAY_NAME is required.");
  if (values.productId && !/^[A-Za-z0-9]{8,20}$/.test(values.productId))
    throw new Error("Invalid MSSTORE_PRODUCT_ID.");
  if (
    values.identityName === DEV_IDENTITY.identityName ||
    values.publisher === DEV_IDENTITY.publisher
  )
    throw new Error("Development identity cannot be used as a Store identity.");
  return { ...values, configured: true };
}
function localConfig(root) {
  const file = path.join(root, ".store.local.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}
function manifest(config, version) {
  const name = xml(config.identityName),
    publisher = xml(config.publisher),
    display = xml(config.publisherDisplayName);
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10" xmlns:desktop="http://schemas.microsoft.com/appx/manifest/desktop/windows10" xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities" IgnorableNamespaces="uap desktop rescap">',
    '<Identity Name="' +
      name +
      '" ProcessorArchitecture="x64" Publisher="' +
      publisher +
      '" Version="' +
      packageVersion(version) +
      '" />',
    "<Properties><DisplayName>Streamer Assist</DisplayName><PublisherDisplayName>" +
      display +
      "</PublisherDisplayName><Description>방송 타임라인, 시청자 추첨과 치지직·YouTube 투표 도구</Description><Logo>assets\\StoreLogo.png</Logo></Properties>",
    '<Resources><Resource Language="ko-KR" /></Resources>',
    '<Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" /></Dependencies>',
    '<Capabilities><Capability Name="internetClient" /><rescap:Capability Name="runFullTrust" /></Capabilities>',
    '<Applications><Application Id="StreamerAssist" Executable="app\\Streamer Assist.exe" EntryPoint="Windows.FullTrustApplication">',
    '<uap:VisualElements DisplayName="Streamer Assist" Description="방송 참여 도구" BackgroundColor="#111214" Square150x150Logo="assets\\Square150x150Logo.png" Square44x44Logo="assets\\Square44x44Logo.png"><uap:DefaultTile Wide310x150Logo="assets\\Wide310x150Logo.png" /></uap:VisualElements>',
    '<Extensions><desktop:Extension Category="windows.startupTask" Executable="app\\Streamer Assist.exe" EntryPoint="Windows.FullTrustApplication"><desktop:StartupTask TaskId="StreamerAssistStartup" Enabled="false" DisplayName="Streamer Assist" /></desktop:Extension></Extensions>',
    "</Application></Applications></Package>",
  ].join("\n");
}
module.exports = {
  DEV_IDENTITY,
  packageVersion,
  xml,
  storeConfig,
  localConfig,
  manifest,
};
