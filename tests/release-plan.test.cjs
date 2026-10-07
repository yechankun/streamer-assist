"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const plan = require("../scripts/release-plan.cjs");
const sha = "a".repeat(40);
function fixture(eventName = "workflow_run", options = {}) {
  const context = { eventName, repo: { owner: "owner", repo: "app" }, sha, ref: "refs/heads/main", payload: { inputs: {}, workflow_run: { conclusion: "success", event: "push", head_branch: "main", head_sha: sha, head_repository: { full_name: "owner/app" } } } };
  let calls = 0;
  const outputs = {};
  return { context, outputs, calls: () => calls, version: "0.2.0", core: { setOutput(k, v) { outputs[k] = v; }, info() {} }, github: { rest: { repos: { async getReleaseByTag() {
    calls++;
    if (options.exists) return { data: {} };
    throw Object.assign(new Error("Fixture API failure"), { status: options.status || 404 });
  } } } } };
}
test("successful own main CI publishes a new version from the tested commit", async () => {
  const input = fixture();
  const result = await plan(input);
  assert.deepEqual(result, { tag: "v0.2.0", sha, publish: true, build: true, verified: true });
  assert.equal(input.outputs.sha, sha);
  assert.equal(input.outputs.verified, "true");
});
test("existing releases are preserved and do not repeat expensive packaging", async () => {
  const input = fixture("workflow_run", { exists: true });
  const result = await plan(input);
  assert.equal(result.publish, false); assert.equal(result.build, false);
});
test("manual builds remain artifacts only unless publication is explicitly selected", async () => {
  const input = fixture("workflow_dispatch");
  const built = await plan(input);
  assert.equal(built.build, true); assert.equal(built.publish, false); assert.equal(input.calls(), 0);
  input.context.payload.inputs.publish_release = "true";
  assert.equal((await plan(input)).publish, true);
  input.context.ref = "refs/heads/feature";
  await assert.rejects(plan(input), /Publish only/);
});
test("failed CI and fork or PR sources cannot reach publication metadata", async () => {
  for (const [key, value] of [["conclusion", "failure"], ["event", "pull_request"], ["head_branch", "feature"], ["head_repository", { full_name: "fork/app" }]]) {
    const input = fixture(); input.context.payload.workflow_run[key] = value;
    await assert.rejects(plan(input), /successful CI/);
    assert.equal(input.calls(), 0);
  }
});
test("tag mismatches and API authorization failures never create another release", async () => {
  const input = fixture("push"); input.context.ref = "refs/tags/v0.1.0";
  await assert.rejects(plan(input), /Tag must match/);
  await assert.rejects(plan(fixture("workflow_run", { status: 403 })), /Fixture API failure/);
});
