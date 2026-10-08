// These caches remove only their oldest entry. A separate ring avoids scanning
// deleted Map/Set slots to discover that entry on every incoming message.
class KeyQueue {
  constructor() { this.clear(); }
  clear() { this.items = new Array(1024); this.head = 0; this.length = 0; }
  push(key) {
    if (this.length === this.items.length) {
      const next = new Array(this.items.length * 2);
      for (let i = 0; i < this.length; i++) next[i] = this.items[(this.head + i) % this.items.length];
      this.items = next; this.head = 0;
    }
    this.items[(this.head + this.length++) % this.items.length] = key;
  }
  shift() {
    const key = this.items[this.head]; this.items[this.head] = undefined;
    this.head = (this.head + 1) % this.items.length; this.length--;
    return key;
  }
  peek() { return this.items[this.head]; }
}
class FifoCache {
  constructor() { this.items = new Map(); this.order = new KeyQueue(); }
  get size() { return this.items.size; }
  get(key) { return this.items.get(key); }
  has(key) { return this.items.has(key); }
  set(key, value) { if (!this.items.has(key)) this.order.push(key); this.items.set(key, value); return this; }
  evictOldest(beforeDelete) {
    if (!this.items.size) return;
    const key = this.order.peek(); beforeDelete?.(key); this.order.shift(); this.items.delete(key);
    return key;
  }
  clear() { this.items.clear(); this.order.clear(); }
  keys() { return this.items.keys(); }
  values() { return this.items.values(); }
  [Symbol.iterator]() { return this.items[Symbol.iterator](); }
}
class FifoSet extends FifoCache {
  constructor(values = []) { super(); for (const value of values) this.add(value); }
  add(value) { this.set(value, true); return this; }
  values() { return this.keys(); }
  [Symbol.iterator]() { return this.values(); }
}
module.exports = { FifoCache, FifoSet };
