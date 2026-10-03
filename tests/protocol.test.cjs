const { test } = require("node:test");
const assert = require("node:assert/strict");
test("safe URL adapter preserves legacy CHZZK Socket.IO protocol and auth query", () => {
  const io = require("socket.io-client");
  const parse = require("parseuri");
  const socketUrl = require("socket.io-client/lib/url");
  const input = "https://ssio08.nchat.naver.com:443?auth=token%2Bvalue";
  assert.equal(io.protocol, 4); // Socket.IO 2 packet protocol, not Socket.IO client v4.
  assert.equal(require("engine.io-parser").protocol, 3);
  assert.equal(parse(input).protocol, "https");
  assert.equal(parse(input).query, "auth=token%2Bvalue");
  assert.equal(socketUrl(input).id, "https://ssio08.nchat.naver.com:443");
  const ipv6 = socketUrl("https://[::1]:8443/?auth=x");
  assert.equal(ipv6.id, "https://[::1]:8443");
  assert.throws(() => parse("a".repeat(20000)));
});
