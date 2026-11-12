const { app } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { assertLayout, waitFor, rendered } = require("./layout-check.cjs");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.setPath("userData", process.env.STREAMER_ASSIST_TEST_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), "streamer-preview-test-")));
process.env.STREAMER_ASSIST_SHORTCUT = "CommandOrControl+Alt+Shift+F19";
let stage = "initializing";
const deadline = setTimeout(() => { console.error("Preview test timed out at " + stage); app.exit(1); }, 60000);
app.once("browser-window-created", (_, window) => window.webContents.once("did-finish-load", async () => {
  const web = window.webContents;
  const js = (fn, ...args) => web.executeJavaScript(`(${fn})(${args.map(value => JSON.stringify(value)).join(",")})`);
  const call = async (action, payload = {}) => {
    const reply = await js((a, p) => window.assist.call(a, p), action, payload);
    assert.ok(reply.ok, reply.error);
  };
  const input = async (selector, value) => {
    await js((s, value) => {
      const element = document.querySelector(s);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, selector, value);
    await rendered(window);
  };
  const click = async selector => { await js(s => document.querySelector(s).click(), selector); await rendered(window); };
  const settled = () => waitFor(() => js(() => document.querySelector('.roulette-setup-preview .wheel-frame')?.dataset.morphing === "false"), "preview settles");
  const sample = (selector, value, index = 0) => js(async (selector, value, index) => {
    const element = document.querySelector(selector);
    const read = () => {
      const shape = document.querySelector(`.roulette-setup-preview [data-segment="${index}"]`);
      return shape ? Number(shape.dataset.endAngle) - Number(shape.dataset.startAngle) : 0;
    };
    const before = read();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    const after = read();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const running = document.querySelector('.roulette-setup-preview .wheel-frame').dataset.morphing;
    await new Promise(resolve => setTimeout(resolve, 75));
    const middle = read();
    await new Promise(resolve => setTimeout(resolve, 75));
    return { before, after, running, middle, later: read() };
  }, selector, value, index);
  const span = index => js(index => {
    const shape = document.querySelector(`.roulette-setup-preview [data-segment="${index}"]`);
    return shape ? Number(shape.dataset.endAngle) - Number(shape.dataset.startAngle) : 0;
  }, index);
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < .001, `${actual} should equal ${expected}`);
  try {
    window.setContentSize(1280, 720);
    window.showInactive();
    web.debugger.attach("1.3");
    const motion = value => web.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value }] });
    await motion("no-preference");
    await waitFor(() => js(() => document.visibilityState === "visible"), "visible animation test window");
    await js(() => [...document.querySelectorAll("nav button")].find(button => button.textContent.includes("룰렛")).click());
    await waitFor(() => js(() => !!document.querySelector('.roulette-setup-preview')), "preview mounted");
    await settled();

    stage = "first fill";
    const fill = await sample('[aria-label="룰렛 항목 1"]', "첫 번째");
    assert.equal(fill.running, "true");
    assert.ok(fill.middle > 0 && fill.middle < 360 && fill.later > fill.middle, "the first slice unfolds through intermediate angles");
    await settled(); near(await span(0), 360);

    stage = "split and weight changes";
    const split = await sample('[aria-label="룰렛 항목 2"]', "두 번째");
    assert.ok(split.middle > 180 && split.middle < 360 && split.later < split.middle, "adding an item smoothly divides the existing slice");
    await settled(); near(await span(0), 180); near(await span(1), 180);
    const weighted = await sample('[aria-label="룰렛 가중치 1"]', "3");
    assert.ok(weighted.middle > 180 && weighted.middle < 270 && weighted.later > weighted.middle);
    await settled(); near(await span(0), 270);

    stage = "retargeting mid-animation";
    const interrupted = await sample('[aria-label="룰렛 가중치 1"]', "1");
    assert.ok(interrupted.later > 180 && interrupted.later < 270);
    const retargeted = await sample('[aria-label="룰렛 가중치 1"]', "5");
    near(retargeted.before, retargeted.after);
    assert.ok(retargeted.middle > retargeted.before && retargeted.middle < 300, "rapid edits continue from the currently displayed shape");
    await settled(); near(await span(0), 300);

    stage = "removing a middle item";
    await click('[aria-label="룰렛 항목 추가"]');
    await input('[aria-label="룰렛 항목 3"]', "세 번째");
    await settled();
    const removal = await js(async () => {
      const segment = document.querySelector('.roulette-setup-preview [data-segment="1"]');
      const key = segment.dataset.segmentKey;
      const width = element => element ? Number(element.dataset.endAngle) - Number(element.dataset.startAngle) : 0;
      const before = width(segment);
      document.querySelector('[aria-label="룰렛 항목 2 삭제"]').click();
      await new Promise(resolve => setTimeout(resolve, 90));
      const middle = width(document.querySelector(`.roulette-setup-preview [data-segment-key="${key}"]`));
      const total = [...document.querySelectorAll('.roulette-setup-preview [data-segment]')].reduce((sum, element) => sum + width(element), 0);
      return { key, before, middle, total };
    });
    assert.ok(removal.middle > 0 && removal.middle < removal.before);
    near(removal.total, 360);
    await settled();
    assert.equal(await js(key => !!document.querySelector(`.roulette-setup-preview [data-segment-key="${key}"]`), removal.key), false);

    stage = "shrinking to zero and an empty wheel";
    const zero = await sample('[aria-label="룰렛 가중치 1"]', "0");
    assert.ok(zero.middle > 0 && zero.middle < zero.before && zero.later < zero.middle);
    await settled(); near(await span(0), 0); near(await span(1), 360);
    const empty = await sample('[aria-label="룰렛 가중치 2"]', "0", 1);
    assert.ok(empty.middle > 0 && empty.middle < 360 && empty.later < empty.middle);
    await settled();
    assert.equal(await js(() => document.querySelectorAll('.roulette-setup-preview [data-segment]').length), 0);
    await input('[aria-label="룰렛 가중치 1"]', "5");
    await input('[aria-label="룰렛 가중치 2"]', "1");
    await settled();

    stage = "reduced motion";
    await input('[aria-label="룰렛 가중치 1"]', "1");
    await motion("reduce");
    await waitFor(() => js(() => matchMedia('(prefers-reduced-motion: reduce)').matches), "reduced motion applies");
    await settled(); near(await span(0), 180);
    await input('[aria-label="룰렛 가중치 1"]', "3");
    await rendered(window);
    near(await span(0), 270);
    assert.equal(await js(() => document.querySelector('.roulette-setup-preview .wheel-frame').dataset.morphing), "false");

    stage = "inactive tab and hidden window";
    await motion("no-preference");
    await input('[aria-label="룰렛 가중치 1"]', "1");
    await js(() => [...document.querySelectorAll("nav button")].find(button => button.textContent.includes("방송 타임라인")).click());
    await settled(); near(await span(0), 180);
    await js(() => [...document.querySelectorAll("nav button")].find(button => button.textContent.includes("룰렛")).click());
    await input('[aria-label="룰렛 가중치 1"]', "3");
    web.setBackgroundThrottling(true);
    window.hide();
    await waitFor(() => js(() => document.visibilityState === "hidden"), "hidden document");
    await settled(); near(await span(0), 270);
    window.showInactive();
    web.setBackgroundThrottling(false);
    await waitFor(() => js(() => document.visibilityState === "visible"), "preview window restored");
    await assertLayout(window, "animated preview layout");

    stage = "start during a morph and weighted result";
    await input('[aria-label="룰렛 가중치 1"]', "0");
    await click('.roulette-form-bottom .primary');
    await waitFor(() => js(() => !!document.querySelector('.roulette-stage')), "stage opens immediately during a morph");
    assert.equal(await js(() => !!document.querySelector('.roulette-setup-preview')), false);
    await call("draw-animations-set", { enabled: false });
    await click('.roulette-spin');
    await waitFor(() => js(() => document.querySelector('.roulette-outcome strong')?.textContent === "세 번째"), "the stage still excludes zero weight");
    near(await js(() => (Number(document.querySelector('.roulette-disc').dataset.wheelAngle) + Number(document.querySelector('[data-segment="1"]').dataset.middleAngle)) % 360), 0);
    console.log("PASS: unfolding fill, smooth division and weight changes, continuous rapid edits, shrinking middle removal without gaps, reduced motion, background cancellation, start during morph, exact weighted result.");
    app.quit();
  } catch (error) {
    console.error(stage + ": " + error.message);
    app.exit(1);
  } finally { clearTimeout(deadline); }
}));
require("../electron/main.cjs");
