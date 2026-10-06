const assert = require("node:assert/strict");
async function assertLayout(window, name) {
  const measure = () => {
    const viewport = { width: innerWidth, height: innerHeight };
    const roots = [
      "html",
      "body",
      "#root",
      ".layout",
      "main",
      ".content",
      ".page-body",
    ].map((selector) => {
      const element = document.querySelector(selector);
      return {
        selector,
        width: element.clientWidth,
        height: element.clientHeight,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight,
      };
    });
    const clipped = [
      ...document.querySelectorAll(
        "button, input, textarea, select, summary, .info-popover, .option-list, .roulette-item-list",
      ),
    ]
      .filter((element) => {
        if (!element.getClientRects().length) return false;
        const rectangle = element.getBoundingClientRect();
        // Editable rows outside a deliberately scrollable list are not visible
        // controls. The list boundary and its pinned add/actions are checked.
        const list = element.closest(".option-list, .roulette-item-list");
        if (list && list !== element) {
          const bounds = list.getBoundingClientRect();
          if (rectangle.top < bounds.top || rectangle.bottom > bounds.bottom)
            return false;
        }
        const panel = element.matches(".info-popover")
          ? null
          : element.closest(".panel")?.getBoundingClientRect();
        return (
          rectangle.left < -1 ||
          rectangle.top < -1 ||
          rectangle.right > viewport.width + 1 ||
          rectangle.bottom > viewport.height + 1 ||
          (panel &&
            (rectangle.left < panel.left - 1 ||
              rectangle.top < panel.top - 1 ||
              rectangle.right > panel.right + 1 ||
              rectangle.bottom > panel.bottom + 1))
        );
      })
      .map(
        (element) =>
          element.getAttribute("aria-label") ||
          element.textContent.trim() ||
          element.tagName,
      );
    return { roots, clipped, viewport };
  };
  const result = await window.webContents.executeJavaScript(
    "(" + measure.toString() + ")()",
  );
  for (const root of result.roots) {
    assert.ok(
      root.scrollWidth <= root.width + 1,
      name +
        ": horizontal overflow in " +
        root.selector +
        " " +
        JSON.stringify(root),
    );
    assert.ok(
      root.scrollHeight <= root.height + 1,
      name +
        ": vertical overflow in " +
        root.selector +
        " " +
        JSON.stringify(root),
    );
  }
  assert.deepEqual(
    result.clipped,
    [],
    name + ": controls clipped " + JSON.stringify(result.clipped),
  );
  return result.viewport;
}
async function waitFor(check, name, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("Timed out: " + name);
}
function renderFixture(window, getState) {
  const originalSend = window.webContents.send;
  // Substitute only renderer snapshots, leaving the actual engine/auth/IPC alone.
  window.webContents.send = function (channel, ...args) {
    return originalSend.call(
      this,
      channel,
      ...(channel === "assist:state" ? [getState()] : args),
    );
  };
  const deliver = () =>
    originalSend.call(window.webContents, "assist:state", getState());
  const timer = setInterval(deliver, 30);
  deliver();
  return () => {
    clearInterval(timer);
    window.webContents.send = originalSend;
  };
}
async function rendered(window) {
  await window.webContents.executeJavaScript("("+ (() => new Promise(resolve=>{
    if (document.visibilityState==="hidden") setTimeout(resolve,0);
    else requestAnimationFrame(resolve);
  })).toString()+")()");
}
async function settleUI(window) {
  await window.webContents.executeJavaScript("("+ (async () => {
    if (!window.__testTransitions) {
      window.__testTransitions = new Set();
      if (document.startViewTransition) {
        const start = document.startViewTransition.bind(document);
        document.startViewTransition = (...args) => {
          const transition = start(...args);
          const finished = transition.finished.catch(()=>{});
          window.__testTransitions.add(finished);
          finished.finally(()=>window.__testTransitions.delete(finished));
          return transition;
        };
      }
    }
    const frame = () => new Promise(resolve => {
      if (document.visibilityState === "hidden") setTimeout(resolve,0);
      else requestAnimationFrame(resolve);
    });
    await frame(); await frame();
    // Accelerate short decorative animations in this test renderer only.
    // The real 5.6-second wheel and application timers retain their timings.
    for (const animation of document.getAnimations()) {
      const timing=animation.effect?.getComputedTiming();
      if (animation.playState==="running" && timing && Number.isFinite(timing.endTime) && timing.endTime<=1500)
        animation.playbackRate=4;
    }
    await Promise.all([...window.__testTransitions]);
    // Wait for actual finite UI transitions. Keep long roulette motion in progress
    // for assertions covering mid-spin behavior and tab changes.
    await Promise.all(document.getAnimations().filter(animation=>{
      const timing=animation.effect?.getComputedTiming();
      return animation.playState==="running" && timing && Number.isFinite(timing.endTime) && timing.endTime<=1500;
    }).map(animation=>animation.finished.catch(()=>{})));
    await frame();
  }).toString()+")()");
}
module.exports = { assertLayout, waitFor, renderFixture, settleUI, rendered };
