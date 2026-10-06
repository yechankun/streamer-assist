const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startupSettings } = require("../electron/startup.cjs");
test("MSIX startup is controlled by Windows and never queries registry login settings", () => {
  const state = startupSettings(
    {
      isPackaged: true,
      getLoginItemSettings() {
        throw new Error("must not call");
      },
    },
    true,
  );
  assert.deepEqual(state, {
    startupAvailable: false,
    startupManagedByWindows: true,
    openAtLogin: false,
  });
});
test("EXE uses its existing startup settings while development does not alter startup", () => {
  assert.equal(
    startupSettings(
      {
        isPackaged: true,
        getLoginItemSettings: (o) => {
          assert.deepEqual(o.args, ["--hidden"]);
          return { openAtLogin: true };
        },
      },
      false,
    ).openAtLogin,
    true,
  );
  assert.equal(
    startupSettings(
      {
        isPackaged: false,
        getLoginItemSettings() {
          throw new Error("must not call");
        },
      },
      false,
    ).startupAvailable,
    false,
  );
});
