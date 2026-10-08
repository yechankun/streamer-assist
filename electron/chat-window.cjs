// Exact 10s/70s message counts without copying/scanning the recent transcript.
// Only timestamps/reaction bits are retained; unique viewers use lazy expiry.
class ChatWindow {
  constructor() { this.reset(); }
  reset() {
    this.times = new Float64Array(1024); this.flags = new Uint8Array(1024);
    this.head = 0; this.ten = 0; this.tail = 0; this.laughs = 0;
    this.users = new Map(); this.heap = []; this.samples = []; this.now = 0;
  }
  get length() { return this.tail - this.head; }
  resize(size) {
    const times = new Float64Array(size), flags = new Uint8Array(size), length = this.length;
    for (let i = 0; i < length; i++) {
      const previous = (this.head + i) % this.times.length;
      times[i] = this.times[previous]; flags[i] = this.flags[previous];
    }
    this.ten -= this.head; this.tail = length; this.head = 0; this.times = times; this.flags = flags;
  }
  heapPush(item) {
    const h = this.heap; let i = h.length; h.push(item);
    while (i && h[(i-1)>>1][0] > item[0]) { h[i] = h[(i-1)>>1]; i = (i-1)>>1; }
    h[i] = item;
  }
  heapPop() {
    const h = this.heap, first = h[0], last = h.pop();
    if (h.length) { let i = 0; while (i*2+1 < h.length) { let c = i*2+1; if(c+1<h.length&&h[c+1][0]<h[c][0])c++;if(h[c][0]>=last[0])break;h[i]=h[c];i=c; } h[i]=last; }
    return first;
  }
  expire(now) {
    now = this.now = Math.max(this.now, now);
    while (this.ten < this.tail && now - this.times[this.ten % this.times.length] >= 10000) { this.laughs -= this.flags[this.ten % this.times.length]; this.ten++; }
    while (this.head < this.tail && now - this.times[this.head % this.times.length] >= 70000) this.head++;
    while (this.heap.length && this.heap[0][0] <= now) {
      const [, user] = this.heapPop(), last = this.users.get(user);
      if (last === undefined) continue;
      if (last + 10000 <= now) this.users.delete(user); else this.heapPush([last+10000,user]);
    }
    if (this.times.length > 1024 && this.length <= this.times.length / 4) {
      let size = 1024; while (size < this.length * 2) size *= 2;
      this.resize(size);
    }
    return now;
  }
  push(user, text, now) {
    now = this.expire(now);
    if (this.length === this.times.length) {
      this.resize(this.times.length * 2);
    }
    const laugh = /ㅋ{2,}|ㅎ{2,}|lol|lmao|와|대박/i.test(text) ? 1 : 0, index = this.tail++ % this.times.length;
    this.times[index]=now;this.flags[index]=laugh;this.laughs+=laugh;
    if(!this.users.has(user))this.heapPush([now+10000,user]);this.users.set(user,now);
    this.samples.push({at:now,text:text.slice(0,300)});if(this.samples.length>5)this.samples.shift();
  }
  count(now) { this.expire(now); return this.tail - this.ten; }
  sampleTexts(now) { return [...new Set(this.samples.filter(row => now - row.at < 10000).map(row => row.text))]; }
  stats(now, includeSamples = true) {
    this.expire(now); const messages=this.tail-this.ten, baseline=(this.ten-this.head)/6;
    const stats = {messages,unique:this.users.size,ratio:messages/Math.max(3,baseline),laughs:this.laughs};
    if (includeSamples) stats.samples = this.sampleTexts(now);
    return stats;
  }
}
module.exports={ChatWindow};
