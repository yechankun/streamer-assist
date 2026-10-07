"use strict";
const { packageVersion } = require("./store-config.cjs");

module.exports = async function releasePlan({ github, context, core, version = require("../package.json").version }) {
  packageVersion(version);
  const tag = "v" + version;
  const source = context.payload.workflow_run;
  const repository = context.repo.owner + "/" + context.repo.repo;
  const verified = context.eventName === "workflow_run";
  if (verified && (source?.conclusion !== "success" || source.event !== "push" || source.head_branch !== "main"
    || source.head_repository?.full_name !== repository)) throw new Error("Release requires successful CI from this repository's main branch.");
  if (context.eventName === "push" && context.ref !== "refs/tags/" + tag) throw new Error("Tag must match package.json version.");
  const requested = context.eventName !== "workflow_dispatch" || context.payload.inputs?.publish_release === true || context.payload.inputs?.publish_release === "true";
  if (requested && context.eventName === "workflow_dispatch" && !["refs/heads/main", "refs/tags/" + tag].includes(context.ref))
    throw new Error("Publish only from main or the matching version tag.");
  const sha = verified ? source.head_sha : context.sha;
  if (!/^[0-9a-f]{40,64}$/.test(sha || "")) throw new Error("Release source commit is invalid.");
  let existing = false;
  if (requested) {
    try { await github.rest.repos.getReleaseByTag({ ...context.repo, tag }); existing = true; }
    catch (error) { if (error.status !== 404) throw error; }
  }
  const result = { tag, sha, publish: requested && !existing, build: !requested || !existing, verified };
  for (const [key, value] of Object.entries(result)) core.setOutput(key, String(value));
  core.info(existing ? tag + " already exists; immutable release files were preserved." : requested ? "Publish " + tag + " from verified commit " + sha : "Build packages only; publishing was not requested.");
  return result;
};
