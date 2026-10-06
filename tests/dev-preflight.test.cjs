"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { preflightBackend } = require("../scripts/dev.cjs");

test("dev backend preflight imports local modules and blocks syntax or startup exceptions", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "streamer-dev-preflight-"));
  t.after(async () => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "good.cjs"), "module.exports = { ready: true };", "utf8");
  await fs.writeFile(path.join(root, "reference-error.cjs"), "throw new ReferenceError('COMPONENTS is not defined');", "utf8");
  await fs.writeFile(path.join(root, "syntax-error.cjs"), "module.exports = {", "utf8");
  await fs.writeFile(path.join(root, "parse-only.cjs"), "throw new Error('syntax checks must not execute this file');", "utf8");

  const ready = await preflightBackend({ root, modules: ["good.cjs"], syntaxFiles: ["parse-only.cjs"] });
  assert.equal(ready.ok, true);

  const referenceError = await preflightBackend({ root, modules: ["good.cjs", "reference-error.cjs"], syntaxFiles: [] });
  assert.equal(referenceError.ok, false);
  assert.match(referenceError.output, /COMPONENTS is not defined/);

  const syntaxError = await preflightBackend({ root, modules: ["syntax-error.cjs"], syntaxFiles: [] });
  assert.equal(syntaxError.ok, false);
  assert.match(syntaxError.output, /SyntaxError/);

  const syntaxOnlyError = await preflightBackend({ root, modules: ["good.cjs"], syntaxFiles: ["syntax-error.cjs"] });
  assert.equal(syntaxOnlyError.ok, false);
  assert.match(syntaxOnlyError.output, /SyntaxError/);
});
