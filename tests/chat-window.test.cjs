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
