const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Engine } = require("../electron/engine.cjs");
const { Platforms, pollAnnouncement } = require("../electron/platforms.cjs");
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
    const p = new Platforms(e, () => {}, { getAccess: async () => "fake" });
    p.config = { youtube: true, liveChatId: "chat" };
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
    const p = new Platforms(e, () => {}, { getAccess: async () => "fake" });
    p.config = { youtube: true, liveChatId: "chat" };
    p.status.youtube = "연결됨";
    await assert.rejects(() => p.publishPoll(poll), /403/);
    assert.equal(poll.youtubeId, undefined);
  } finally {
    global.fetch = original;
  }
});

test("unauthorized YouTube request refreshes once without exposing the error body", async () => {
  const original = global.fetch;
  const refreshed = [];
  let count = 0;
  global.fetch = async () =>
    ++count === 1
      ? { ok: false, status: 401 }
      : { ok: true, status: 200, json: async () => ({ id: "success" }) };
  try {
    const p = new Platforms(new Engine(), () => {}, {
      getAccess: async (_platform, force) => {
        refreshed.push(!!force);
        return "fake";
      },
    });
    assert.deepEqual(
      await p.api("youtube", "https://www.googleapis.com/example"),
      { id: "success" },
    );
    assert.deepEqual(refreshed, [false, true]);
  } finally {
    global.fetch = original;
  }
});

test("poll selection requires only the selected accounts and live chats", () => {
  const p = new Platforms(new Engine(), () => {});
  p.config = { chzzkChannelId: "channel" };
  p.status.chzzk = "연결됨";
  const accounts = {
    chzzk: { connected: true },
    youtube: { connected: false },
  };
  assert.deepEqual(p.pollConfiguration(["chzzk"], { accounts }), {
    mode: "chat",
    platforms: ["chzzk"],
  });
  assert.throws(
    () => p.pollConfiguration(["youtube"], { accounts }),
    /YouTube 계정/,
  );
  accounts.youtube.connected = true;
  p.config.youtube = true;
  p.config.liveChatId = "live";
  assert.throws(
    () => p.pollConfiguration(["chzzk", "youtube"], { accounts }),
    /YouTube 방송/,
  );
  p.status.youtube = "연결됨";
  p.status.chzzk = "방송 대기";
  assert.deepEqual(p.pollConfiguration(["youtube"], { accounts }), {
    mode: "native",
    platforms: ["youtube"],
  });
  assert.throws(
    () => p.pollConfiguration(["chzzk", "youtube"], { accounts }),
    /치지직 방송/,
  );
  p.status.chzzk = "연결됨";
  assert.deepEqual(p.pollConfiguration(["youtube", "chzzk"], { accounts }), {
    mode: "native",
    platforms: ["chzzk", "youtube"],
  });
});
test("missing, invalid, and mixed test/live targets are rejected before publication", () => {
  const p = new Platforms(new Engine(), () => {});
  for (const selection of [
    undefined,
    [],
    null,
    ["other"],
    ["youtube", "youtube"],
    ["demo"],
  ])
    assert.throws(() => p.pollConfiguration(selection), /플랫폼/);
  assert.deepEqual(p.pollConfiguration(["demo"], { demo: true }), {
    mode: "demo",
    platforms: ["demo"],
  });
  for (const selection of [["youtube"], ["demo", "chzzk"], []])
    assert.throws(
      () => p.pollConfiguration(selection, { demo: true }),
      /테스트/,
    );
});
test("CHZZK-only polls never call the YouTube API", async () => {
  const e = new Engine();
  e.start("CHZZK");
  const poll = e.createPoll("Q", ["A", "B"], "chat", ["chzzk"]);
  const p = new Platforms(e, () => {}, {
    getAccess: async () => {
      throw new Error("must not call YouTube");
    },
  });
  p.config = { youtube: true, liveChatId: "live", chzzkChannelId: "channel" };
  p.status = { youtube: "연결됨", chzzk: "연결됨" };
  await p.publishPoll(poll);
  await p.closePoll(poll);
  assert.equal(poll.youtubeId, undefined);
});

test("vote instructions match the selected participation method", () => {
  const base = { question: "Q", options: ["A", "B"], mode: "native" };
  assert.match(
    pollAnnouncement({ ...base, platforms: ["youtube"] }),
    /실시간 투표에서 선택/,
  );
  assert.doesNotMatch(
    pollAnnouncement({ ...base, platforms: ["youtube"] }),
    /번호만 입력/,
  );
  assert.match(
    pollAnnouncement({ ...base, platforms: ["chzzk", "youtube"] }),
    /번호만 입력/,
  );
});
