// At most one pointer update is in flight. A busy bridge keeps only the newest
// point; release sends its own final point instead of replaying an event backlog.
export class WorkspacePointerDrag {
  constructor(send, payload, scheduler = { request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id) }) {
    this.send = send; this.payload = payload; this.scheduler = scheduler;
    this.pending = null; this.flight = null; this.frame = null; this.ended = false;
    this.ready = Promise.resolve(send("drag-start", payload));
  }
  move(point) {
    if (this.ended) return;
    this.pending = point;
    this.schedule();
  }
  schedule() {
    if (this.ended || this.flight || this.frame !== null || !this.pending) return;
    this.frame = this.scheduler.request(() => {
      this.frame = null;
      const flight = (async () => {
        const result = await this.ready;
        if (!result?.ok) { this.pending = null; return; }
        if (this.ended || !this.pending) return;
        const point = this.pending; this.pending = null;
        await this.send("drag-move", { token: this.payload.token, point });
      })();
      this.flight = flight;
      void flight.catch(() => {}).finally(() => { if (this.flight === flight) this.flight = null; this.schedule(); });
    });
  }
  finish(cancel, point) {
    if (this.ended) return this.finished;
    this.ended = true; this.pending = null;
    if (this.frame !== null) this.scheduler.cancel(this.frame);
    this.frame = null;
    this.finished = (async () => {
      const result = await this.ready;
      await this.flight?.catch(() => {});
      if (result?.ok) return this.send(cancel ? "drag-cancel" : "drag-end", { token: this.payload.token, point });
    })();
    return this.finished;
  }
}
