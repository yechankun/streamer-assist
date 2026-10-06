const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  packageVersion,
  storeConfig,
  manifest,
} = require("../scripts/store-config.cjs");
test("Store versions are positive, monotonic across pre-1.0 and retain revision zero", () => {
  assert.equal(packageVersion("0.1.0"), "1.1.0.0");
  assert.equal(packageVersion("1.0.0"), "2.0.0.0");
  for (const v of ["1.2.3-beta.1", "1.2", "1.65536.0", "65535.0.0", "-1.0.0"])
    assert.throws(() => packageVersion(v));
});
test("missing Store identity generates a development package while partial or reserved settings fail", () => {
  assert.equal(storeConfig({}).configured, false);
  assert.throws(() => storeConfig({ MSIX_IDENTITY_NAME: "Only.Name" }));
  assert.throws(() =>
    storeConfig({
      MSIX_IDENTITY_NAME: "Microsoft.Other",
      MSIX_PUBLISHER: "CN=Test",
      MSIX_PUBLISHER_DISPLAY_NAME: "Test",
    }),
  );
});
test("manifest escapes Partner Center metadata, declares only needed capabilities and opt-in startup", () => {
  const c = storeConfig({
    MSIX_IDENTITY_NAME: "12345Example.StreamerAssist",
    MSIX_PUBLISHER: 'CN=Example & "Publisher"',
    MSIX_PUBLISHER_DISPLAY_NAME: "Example & Co",
    MSSTORE_PRODUCT_ID: "9N1234567890",
  });
  const xml = manifest(c, "0.1.0");
  assert.match(xml, /CN=Example &amp; &quot;Publisher&quot;/);
  assert.match(xml, /Version="1.1.0.0"/);
  assert.match(xml, /runFullTrust/);
  assert.match(xml, /Enabled="false"/);
  assert.doesNotMatch(xml, /broadFileSystemAccess|microphone|webcam/);
});
