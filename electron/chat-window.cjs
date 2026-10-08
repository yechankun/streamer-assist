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
    if (!this.length && this.times.length > 1024) { this.times = new Float64Array(1024); this.flags = new Uint8Array(1024); this.head=this.ten=this.tail=0; }
    return now;
  }
  push(user, text, now) {
    now = this.expire(now);
    if (this.length === this.times.length) {
      const size = this.times.length, times = new Float64Array(size*2), flags = new Uint8Array(size*2);
      for(let i=this.head;i<this.tail;i++){times[i-this.head]=this.times[i%size];flags[i-this.head]=this.flags[i%size];}
      this.ten-=this.head;this.tail-=this.head;this.head=0;this.times=times;this.flags=flags;
    }
    const laugh = /ㅋ{2,}|ㅎ{2,}|lol|lmao|와|대박/i.test(text) ? 1 : 0, index = this.tail++ % this.times.length;
    this.times[index]=now;this.flags[index]=laugh;this.laughs+=laugh;
    if(!this.users.has(user))this.heapPush([now+10000,user]);this.users.set(user,now);
    this.samples.push({at:now,text:text.slice(0,300)});if(this.samples.length>5)this.samples.shift();
  }
  stats(now) {
    this.expire(now); const messages=this.tail-this.ten, baseline=(this.ten-this.head)/6;
    return {messages,unique:this.users.size,ratio:messages/Math.max(3,baseline),laughs:this.laughs,samples:[...new Set(this.samples.filter(row=>now-row.at<10000).map(row=>row.text))]};
  }
}
module.exports={ChatWindow};
