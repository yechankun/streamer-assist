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
        "button, input, textarea, select, summary, .info-popover",
      ),
    ]
      .filter((element) => {
        if (!element.getClientRects().length) return false;
        const rectangle = element.getBoundingClientRect();
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
async function waitFor(check, name) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("Timed out: " + name);
}
module.exports = { assertLayout, waitFor };
