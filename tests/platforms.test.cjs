const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Engine } = require("../electron/engine.cjs");
const { Platforms, pollAnnouncement } = require("../electron/platforms.cjs");
test("shared collectors reuse connected transports and join pending connection setup", async () => {
  const p = new Platforms(new Engine(), () => {}), config = { youtube: true, liveChatId: "shared" };
  let opened = 0, release;
  p.youtubeLoop = async () => { opened++; await new Promise(resolve => { release = resolve; }); p.status.youtube = "연결됨"; };
  const first = p.ensureConnected(config), second = p.ensureConnected({ ...config }), third = p.connect({ ...config });
  assert.equal(opened, 1); release(); await Promise.all([first, second, third]);
  const generation = p.generation;
  await p.ensureConnected({ ...config, youtubeStatus: "different label" });
  assert.equal(opened, 1); assert.equal(p.generation, generation);
  p.youtubeLoop = async () => { opened++; p.status.youtube = "연결됨"; };
  await p.ensureConnected({ youtube: true, liveChatId: "other" }); assert.equal(opened, 2);
  await p.connect({ youtube: true, liveChatId: "other" }); assert.equal(opened, 3, "explicit reconnect remains available");
  p.disconnect();
});
test("failed shared connection can be retried without retaining a pending worker", async () => {
  const p = new Platforms(new Engine(), () => {}); let calls = 0;
  p.chzzkConnect = async () => { calls++; if (calls === 1) throw new Error("temporary failure"); p.status.chzzk = "연결됨"; };
  await p.ensureConnected({ chzzkChannelId: "channel" });
  assert.equal(p.status.chzzk, "temporary failure");
  await p.ensureConnected({ chzzkChannelId: "channel" }); assert.equal(calls, 2);
  assert.equal(p.connectionTask, null); p.disconnect();
});
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
  p.live.chzzk = true;
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
  p.live.youtube = true;
  assert.deepEqual(p.pollConfiguration(["youtube"], { accounts }), {
    mode: "chat",
    platforms: ["youtube"],
  });
  assert.throws(
    () => p.pollConfiguration(["chzzk", "youtube"], { accounts }),
    /치지직 방송/,
  );
  p.status.chzzk = "연결됨";
  assert.deepEqual(p.pollConfiguration(["youtube", "chzzk"], { accounts }), {
    mode: "chat",
    platforms: ["chzzk", "youtube"],
  });
});
test("connected chat cannot start participation when the broadcast is offline or unknown", () => {
  const p = new Platforms(new Engine(), () => {});
  p.config = { youtube: true, liveChatId: "cached-chat" };
  p.status.youtube = "연결됨";
  const accounts = { youtube: { connected: true } };
  for (const live of [false, undefined, null]) assert.throws(() => p.pollConfiguration(["youtube"], { accounts, livePlatforms: { youtube: live } }), /방송이 켜져/);
  p.live.youtube = true;
  assert.throws(() => p.pollConfiguration(["youtube"], { accounts, livePlatforms: { youtube: false }, youtubeMethod: "native" }), /방송이 켜져/);
  assert.equal(p.pollConfiguration(["youtube"], { accounts, livePlatforms: { youtube: true } }).mode, "chat");
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

test("vote instructions match the selected participation method and command", () => {
  const base = {
    question: "Q",
    options: ["A", "B"],
    mode: "native",
    chatPrefix: "!투표",
    votePolicy: "latest",
  };
  const native = pollAnnouncement({ ...base, platforms: ["youtube"] });
  assert.match(native, /실시간 투표에서 선택/);
  assert.doesNotMatch(native, /!투표/);
  const combined = pollAnnouncement({
    ...base,
    platforms: ["chzzk", "youtube"],
  });
  assert.match(combined, /!투표1: A/);
  assert.match(combined, /다시 입력하면 선택 변경/);
  assert.match(combined, /YouTube 실시간 투표에서 선택/);
  const chat = pollAnnouncement({
    ...base,
    mode: "chat",
    chatPrefix: "#",
    platforms: ["youtube"],
  });
  assert.match(chat, /#1: A/);
  assert.doesNotMatch(chat, /실시간 투표에서 선택/);
});

test("YouTube chat voting skips publication while native mode remains selectable", async () => {
  const e = new Engine();
  e.start("chat");
  const p = new Platforms(e, () => {}, {
    getAccess: async () => {
      throw new Error("chat must not publish");
    },
  });
  p.config = { youtube: true, liveChatId: "live" };
  p.status.youtube = "연결됨";
  const accounts = { youtube: { connected: true } };
  p.live.youtube = true;
  assert.equal(p.pollConfiguration(["youtube"], { accounts }).mode, "chat");
  assert.equal(
    p.pollConfiguration(["youtube"], { accounts, youtubeMethod: "native" })
      .mode,
    "native",
  );
  assert.throws(
    () =>
      p.pollConfiguration(["youtube"], { accounts, youtubeMethod: "other" }),
    /투표 방식/,
  );
  const poll = e.createPoll("Q", ["A", "B"], "chat", ["youtube"]);
  await p.publishPoll(poll);
  e.ingest({ platform: "youtube", userId: "one", text: "!투표2" });
  assert.deepEqual(poll.counts, [0, 1]);
  assert.equal(poll.youtubeId, undefined);
});

test("YouTube live paging routes fresh text and Super Chats independently and excludes the initial history page", async () => {
  const original = global.fetch;
  const e = new Engine();
  e.audience.startRaffle({
    title: "",
    platforms: ["youtube"],
    entryMode: "any",
    keyword: "!참여",
    subscribersOnly: false,
    excludeWinners: true,
    timerSeconds: null,
  });
  e.audience.startDonation({
    question: "Q",
    options: ["A", "B"],
    platforms: ["youtube"],
    chatPrefix: "!투표",
    currency: "USD",
    minimumMicros: 1e6,
    plural: true,
    timerSeconds: null,
  });
  const authorDetails = {
    channelId: "u",
    displayName: "Viewer",
    isChatSponsor: true,
  };
  const publishedAt = new Date().toISOString();
  const items = [
    {
      id: "text",
      authorDetails,
      snippet: {
        type: "textMessageEvent",
        publishedAt,
        textMessageDetails: { messageText: "hello" },
      },
    },
    {
      id: "paid",
      authorDetails,
      snippet: {
        type: "superChatEvent",
        publishedAt,
        superChatDetails: {
          amountMicros: "2990000",
          currency: "USD",
          userComment: "!투표2",
        },
      },
    },
  ];
  const p = new Platforms(e, () => {}, { getAccess: async () => "fake" });
  p.config = { youtube: true, liveChatId: "test" };
  global.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => ({
      items,
      nextPageToken: "next",
      pollingIntervalMillis: 10000,
      offlineAt: new URL(url).searchParams.has("pageToken")
        ? publishedAt
        : undefined,
    }),
  });
  try {
    await p.youtubeLoop(0);
    assert.equal(e.audience.snapshot().raffle.candidateCount, 0);
    assert.deepEqual(e.audience.donationPoll.counts, [0, 0]);
    await p.youtubeLoop(0, "next");
    assert.equal(e.audience.snapshot().raffle.candidateCount, 1);
    assert.equal(e.audience.snapshot().raffle.candidates[0].subscriber, true);
    assert.deepEqual(e.audience.donationPoll.counts, [0, 2]);
    assert.equal(
      e.chatCount,
      0,
      "standalone tools do not start a timeline implicitly",
    );
  } finally {
    p.disconnect();
    global.fetch = original;
  }
});
