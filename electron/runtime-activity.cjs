// Maintenance and deadlines belong to the app, never to a renderer's visibility.
class RuntimeActivity {
  constructor({ read, run, clock = Date.now, schedule = setTimeout, cancel = clearTimeout, interval = 1000 }) {
    Object.assign(this, { read, run, clock, schedule, cancel, interval });
    this.timer = null; this.at = null; this.flushAt = null; this.closed = false;
  }
  refresh() {
    if (this.closed) return;
    const now = this.clock(), state = this.read();
    if (!state.recording) this.flushAt = null;
    else this.flushAt ??= now + this.interval;
    const deadlines = [this.flushAt, state.dirty ? state.saveAt : null, ...(state.deadlines || [])].filter(value => Number.isFinite(value));
    const at = deadlines.length ? Math.max(now, Math.min(...deadlines)) : null;
    if (at === this.at) return;
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null; this.at = at;
    if (at === null) return;
    this.timer = this.schedule(() => {
      this.timer = null; this.at = null;
      const current = this.clock(), maintenance = this.flushAt !== null && current >= this.flushAt;
      if (maintenance) this.flushAt = current + this.interval;
      try { this.run(current, maintenance); } finally { this.refresh(); }
    }, Math.min(0x7fffffff, Math.max(0, at - now)));
    this.timer?.unref?.();
  }
  close() { this.closed = true; if (this.timer !== null) this.cancel(this.timer); this.timer = null; this.at = null; }
}
class StatePublisher {
  constructor({ windows, build, send, schedule = setTimeout, cancel = clearTimeout, delay = 100 }) {
    Object.assign(this, { windows, build, send, schedule, cancel, delay }); this.timer = null;
  }
  targets(force, target) {
    return this.windows().filter(win => !win.isDestroyed() && (!target || win === target) && (force || (win.isVisible() && !win.isMinimized())));
  }
  publish(force = false, target) {
    if (this.closed) return;
    const targets = this.targets(force, target);
    if (!targets.length) return;
    const snapshot = this.build();
    for (const win of targets) if (!win.isDestroyed()) this.send(win, snapshot);
  }
  request(force = false, target) {
    if (this.closed) return;
    if (force) { this.publish(true, target); return; }
    if (this.timer !== null || !this.targets(false).length) return;
    this.timer = this.schedule(() => { this.timer = null; this.publish(); }, this.delay);
    this.timer?.unref?.();
  }
  close() { this.closed = true; if (this.timer !== null) this.cancel(this.timer); this.timer = null; }
}
module.exports = { RuntimeActivity, StatePublisher };
