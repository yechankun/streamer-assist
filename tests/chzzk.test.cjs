const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PublicChat, channelIdFrom } = require("../electron/chzzk.cjs");
const { Engine } = require("../electron/engine.cjs");
const channelId = "a".repeat(32);
function socketClass() {
  return class Socket extends EventEmitter {
    static instances = [];
    constructor(url) {
      super();
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      this.constructor.instances.push(this);
    }
    send(packet) {
      this.sent.push(JSON.parse(packet));
    }
    terminate() {
      this.terminated = true;
      this.readyState = 3;
      this.emit("close");
    }
    open() {
      this.readyState = 1;
      this.emit("open");
    }
    packet(packet) {
      this.emit("message", Buffer.from(JSON.stringify(packet)));
    }
  };
}
function chatMessage(userId, text = "!투표1", time = Date.now()) {
  return {
    msgTypeCode: 1,
    profile: JSON.stringify({ userIdHash: userId }),
    msg: text,
    msgTime: time,
  };
}
test("channel input accepts CHZZK URLs and rejects foreign hosts and malformed IDs", () => {
  assert.equal(
    channelIdFrom(" https://chzzk.naver.com/live/" + channelId + "?view=chat "),
    channelId,
  );
  assert.equal(channelIdFrom(channelId.toUpperCase()), channelId);
  for (const input of [
    "https://chzzk.naver.com.evil.example/" + channelId,
    "https://user:pass@chzzk.naver.com/" + channelId,
    "http://chzzk.naver.com/" + channelId,
    "https://chzzk.naver.com:9000/" + channelId,
    "../file",
    null,
  ])
    assert.throws(() => channelIdFrom(input));
});
test("public websocket joins READ, counts fresh text once and excludes history and hidden chats", async () => {
  const Socket = socketClass();
  const e = new Engine();
  e.start("Public");
  e.createPoll("Q", ["A", "B"]);
  e.audience.startDonation({
    question: "Q",
    options: ["A", "B"],
    platforms: ["chzzk"],
    chatPrefix: "!투표",
    currency: "KRW",
    minimumMicros: 1e9,
    plural: true,
    timerSeconds: null,
  });
  const statuses = [];
  const requests = [];
  const chat = new PublicChat({
    channelId,
    Socket,
    onStatus: (status) => statuses.push(status),
    onMessage: (message) => e.ingest(message),
    fetcher: async (url, options) => {
      requests.push(url);
      assert.equal(options.headers.Cookie, undefined);
      assert.equal(options.headers.Authorization, undefined);
      return {
        ok: true,
        json: async () => ({
          code: 200,
          content: url.includes("access-token")
            ? { accessToken: "anonymous-read-token" }
            : { status: "OPEN", chatChannelId: "abcd12" },
        }),
      };
    },
  });
  try {
    await chat.connect();
    const socket = Socket.instances[0];
    assert.match(socket.url, /^wss:\/\/kr-ss[1-9]\.chat\.naver\.com\/chat$/);
    socket.open();
    assert.equal(socket.sent[0].bdy.auth, "READ");
    assert.equal(socket.sent[0].bdy.uid, null);
    socket.packet({ cmd: 10100, bdy: { sid: "session" } });
    assert.equal(statuses.at(-1), "연결됨");
    const fresh = chatMessage("first");
    socket.packet({
      cmd: 93101,
      bdy: [
        fresh,
        fresh,
        chatMessage("second", "!투표2"),
        { ...chatMessage("hidden"), msgStatusType: "HIDDEN" },
        { msgTypeCode: 1, profile: "malformed" },
      ],
    });
    socket.packet({
      cmd: 15101,
      bdy: { messageList: [chatMessage("history")] },
    });
    socket.packet({
      cmd: 93102,
      bdy: [{ ...chatMessage("donation"), msgTypeCode: 10 }],
    });
    const paid = {
      ...chatMessage("paid", "!투표2"),
      msgTypeCode: 10,
      msgSn: "payment-1",
      extras: JSON.stringify({ payAmount: 2500 }),
    };
    socket.packet({ cmd: 93102, bdy: [paid, paid] });
    socket.packet({
      cmd: 15101,
      bdy: { messageList: [{ ...paid, msgSn: "historical-payment" }] },
    });
    assert.deepEqual(e.audience.donationPoll.counts, [0, 2]);
    socket.packet({ cmd: 0 });
    assert.equal(e.chatCount, 2);
    assert.deepEqual(e.poll.counts, [1, 1]);
    assert.deepEqual(
      socket.sent.map((x) => x.cmd),
      [100, 10000],
    );
    assert.equal(requests.length, 2);
    chat.disconnect();
    socket.packet({ cmd: 93101, bdy: [chatMessage("late")] });
    assert.equal(e.chatCount, 2);
    assert.equal(socket.terminated, true);
  } finally {
    chat.disconnect();
  }
});
test("disconnect during anonymous token retrieval never creates a late socket", async () => {
  const Socket = socketClass();
  let resolveToken;
  const chat = new PublicChat({
    channelId,
    Socket,
    onStatus: () => {},
    onMessage: () => {},
    fetcher: async (url) => {
      if (url.includes("access-token"))
        return new Promise((resolve) => {
          resolveToken = resolve;
        });
      return {
        ok: true,
        json: async () => ({
          code: 200,
          content: { status: "OPEN", chatChannelId: "abcd12" },
        }),
      };
    },
  });
  const connecting = chat.connect();
  try {
    while (!resolveToken) await new Promise((resolve) => setImmediate(resolve));
    chat.disconnect();
    resolveToken({
      ok: true,
      json: async () => ({ code: 200, content: { accessToken: "read" } }),
    });
    await connecting;
    assert.equal(Socket.instances.length, 0);
    assert.equal(chat.closed, true);
  } finally {
    chat.disconnect();
  }
});
test("age-restricted chat stops without requesting account cookies or retrying the gate", async () => {
  const Socket = socketClass();
  const statuses = [];
  const chat = new PublicChat({
    channelId,
    Socket,
    retryDelay: 10,
    onStatus: (status) => statuses.push(status),
    onMessage: () => {},
    fetcher: async (url) => ({
      ok: true,
      json: async () =>
        url.includes("access-token")
          ? { code: 42601 }
          : { code: 200, content: { status: "OPEN", chatChannelId: "abcd12" } },
    }),
  });
  try {
    await chat.connect();
    assert.match(statuses.at(-1), /로그인이 필요한/);
    assert.equal(Socket.instances.length, 0);
    assert.equal(chat.timer, undefined);
  } finally {
    chat.disconnect();
  }
});
test("offline channel waits and a failed socket can reconnect without crashing", async () => {
  const Socket = socketClass();
  let live = false;
  const statuses = [];
  const chat = new PublicChat({
    channelId,
    Socket,
    onStatus: (status) => statuses.push(status),
    onMessage: () => {},
    fetcher: async (url) => ({
      ok: true,
      json: async () => ({
        code: 200,
        content: url.includes("access-token")
          ? { accessToken: "read" }
          : {
              status: live ? "OPEN" : "CLOSE",
              chatChannelId: live ? "abcd12" : null,
            },
      }),
    }),
  });
  try {
    await chat.connect();
    assert.equal(statuses.at(-1), "방송 대기");
    assert.equal(Socket.instances.length, 0);
    live = true;
    await chat.check();
    const first = Socket.instances[0];
    first.emit("error", new Error("simulated failure"));
    assert.equal(first.terminated, true);
    assert.match(statuses.at(-1), /연결 실패/);
    await chat.check();
    const second = Socket.instances[1];
    second.open();
    second.packet({ cmd: 10100, bdy: { sid: "second" } });
    assert.equal(statuses.at(-1), "연결됨");
  } finally {
    chat.disconnect();
  }
});
