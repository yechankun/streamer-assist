const {test}=require("node:test"),assert=require("node:assert/strict"),{ChatWindow}=require("../electron/chat-window.cjs");
test("reaction windows retain exact counts beyond 10,000 messages and expire at actual time boundaries",()=>{
  const window=new ChatWindow();for(let i=0;i<25000;i++)window.push("user"+(i%7),i%2?"hello":"ㅋㅋ",1000);
  assert.equal(window.stats(10999).messages,25000);assert.equal(window.stats(10999).unique,7);assert.equal(window.stats(10999).laughs,12500);
  assert.equal(window.stats(11000).messages,0);assert.equal(window.stats(11000).unique,0);assert.equal(window.length,25000);
  window.stats(71000);assert.equal(window.length,0);assert.equal(window.times.length,1024);
});
test("one viewer's renewed expiry stays exact without a heap entry for each message",()=>{
  const window=new ChatWindow();window.push("one","a",1000);for(let i=0;i<10000;i++)window.push("one","b",10000);
  assert.equal(window.heap.length,1);assert.equal(window.stats(11000).unique,1);assert.equal(window.stats(20000).unique,0);assert.equal(window.stats(20000).messages,0);
});

test("counts and optional evidence follow the same expiry boundaries", () => {
  const window = new ChatWindow(); window.push("one", "ㅋㅋ", 1000); window.push("two", "second", 2000);
  assert.equal(window.count(10999), 2); assert.equal(window.count(11000), 1);
  assert.deepEqual(window.stats(11000, false), { messages: 1, unique: 1, ratio: 1 / 3, laughs: 0 });
  assert.deepEqual(window.sampleTexts(11000), ["second"]);
});

test("burst buffers shrink while chat continues, retaining live counts and reaction evidence", () => {
  const window = new ChatWindow();
  for (let i = 0; i < 40000; i++) window.push("burst-" + i, "old", 1000);
  assert.ok(window.times.length >= 40000);
  for (let i = 0; i < 40; i++) window.push("current", i % 2 ? "hello" : "ㅋㅋ", 70000);
  const stats = window.stats(71000);
  assert.equal(window.times.length, 1024); assert.equal(window.length, 40);
  assert.equal(stats.messages, 40); assert.equal(stats.unique, 1); assert.equal(stats.laughs, 20);
  assert.equal(window.count(80000), 0);
  for (let i = 0; i < 3000; i++) window.push("new-" + i, "hello", 80001);
  assert.equal(window.stats(80001).messages, 3000); assert.equal(window.stats(80001).unique, 3000);
});
