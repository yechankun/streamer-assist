const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Engine } = require("../electron/engine.cjs");
const { Platforms } = require("../electron/platforms.cjs");
test("native poll publishes documented payload and reads final tally on close", async () => {
  const original = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "native",
        snippet: {
          pollDetails: {
            metadata: {
              status: requests.length === 1 ? "active" : "closed",
              options: [{ tally: "2" }, { tally: "5" }],
            },
          },
        },
      }),
    };
  };
  try {
    const e = new Engine();
    e.start("test");
    const poll = e.createPoll("Question", ["A", "B"], "native");
    const p = new Platforms(e, () => {});
    p.config = { youtubeToken: "fake", liveChatId: "chat" };
    p.status.youtube = "연결됨";
    await p.publishPoll(poll);
    const body = JSON.parse(requests[0].options.body);
    assert.equal(body.snippet.type, "pollEvent");
    assert.equal(body.snippet.liveChatId, "chat");
    assert.deepEqual(body.snippet.pollDetails.metadata.options, [
      { optionText: "A" },
      { optionText: "B" },
    ]);
    assert.equal(poll.youtubeId, "native");
    await p.closePoll(poll);
    assert.equal(new URL(requests[1].url).searchParams.get("status"), "closed");
    assert.equal(requests[1].options.body, undefined);
    assert.deepEqual(poll.youtubeCounts, [2, 5]);
    assert.equal(poll.active, false);
  } finally {
    global.fetch = original;
  }
});
test("API failure does not claim native poll publication succeeded", async () => {
  const original = global.fetch;
  global.fetch = async () => ({ ok: false, status: 403 });
  try {
    const e = new Engine();
    e.start("test");
    const poll = e.createPoll("Question", ["A", "B"], "native");
    const p = new Platforms(e, () => {});
    p.config = { youtubeToken: "fake", liveChatId: "chat" };
    p.status.youtube = "연결됨";
    await assert.rejects(() => p.publishPoll(poll), /403/);
    assert.equal(poll.youtubeId, undefined);
  } finally {
    global.fetch = original;
  }
});
