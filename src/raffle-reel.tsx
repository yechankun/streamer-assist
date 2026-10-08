import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Participant, RaffleDraw } from "./audience-types";
import { ParticipantName } from "./participant-name";
import { usePageActive } from "./activity";
const textScaleEvent = "assist:text-scale";

export function RaffleReel({ draw, active }: { draw: RaffleDraw; active: boolean }) {
  const visible = usePageActive(), shown = active && visible;
  const viewport = useRef<HTMLDivElement>(null), track = useRef<HTMLDivElement>(null);
  const request = useRef<Promise<Participant[]> | null>(null);
  const [rows, setRows] = useState<Participant[]>([]);
  useEffect(() => {
    if (!shown) return;
    let disposed = false;
    // Load the complete draw-time roster once. The recent-participant list is capped
    // at 100 and already excludes the winner from its eligible count after drawing.
    request.current ??= (async () => {
      const reply = await window.assist?.call("raffle-reel", { id: draw.id });
      if (!reply?.ok) throw new Error(reply?.error || "추첨 명단을 불러오지 못했습니다.");
      return (reply.data as Participant[]).slice().reverse();
    })();
    void request.current.then(participants => { if (!disposed) setRows(participants); })
      .catch(error => { if (!disposed) console.error(error); });
    return () => { disposed = true; };
  }, [draw.id, shown]);
  useLayoutEffect(() => {
    const window = viewport.current, strip = track.current;
    if (!window || !strip || !shown || !rows.length) return;
    const faces = [...strip.children] as HTMLDivElement[];
    const step = 360 / rows.length;
    // A reel travels a readable number of slots, rather than skipping hundreds of
    // names each second in a large roster. The winner is always face zero at rest.
    const travel = Math.min(rows.length * 6, 36), start = (travel + 0.5) * step, end = 0;
    const duration = draw.endsAt - draw.startedAt;
    strip.dataset.startAngle = String(start); strip.dataset.endAngle = String(end);
    strip.dataset.startedAt = String(draw.startedAt);
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, height = 0, radius = 0, bend = 1, visible = new Set<number>();
    const paint = () => {
      const progress = duration <= 0 || motion.matches ? 1 : Math.min(1, Math.max(0, (Date.now() - draw.startedAt) / duration));
      const angle = start + (end - start) * (1 - (1 - progress) ** 3);
      strip.dataset.rotation = String(angle); strip.dataset.animating = String(progress < 1);
      // Keep the draw's N-slot ring, but bend its visible arc into a screen-sized
      // drum. Large rosters must not turn into an almost-flat, enormous cylinder.
      // Only front-facing names receive 3D transforms and browser texture layers.
      const next = new Set<number>(), front = -angle / step;
      const reach = Math.min(rows.length, Math.ceil(90 / (step * bend)) + 1);
      for (let offset = -reach; offset <= reach; offset++) {
        const index = ((Math.floor(front) + offset) % rows.length + rows.length) % rows.length;
        if (next.has(index)) continue;
        const relative = ((angle + index * step + 180) % 360 + 360) % 360 - 180;
        const radians = rows.length === 1
          ? Math.sin(relative * Math.PI / 180) * Math.PI * 0.4
          : relative * bend * Math.PI / 180;
        if (Math.abs(radians) >= Math.PI / 2) continue;
        const cosine = Math.cos(radians), y = -radius * Math.sin(radians);
        if (Math.abs(y) > window.clientHeight / 2 + height / 2) continue;
        const depth = radius * (cosine - 1);
        const face = faces[index]; next.add(index);
        face.style.display = "flex";
        // Each face shares the same camera and origin at the slot center. Depth
        // narrows distant text while rotateX foreshortens it into the curved rim.
        face.style.transform = `perspective(var(--reel-perspective)) translate3d(0, ${y}px, ${depth}px) rotateX(${radians}rad)`;
        face.style.opacity = String(0.35 + cosine * 0.65);
      }
      for (const index of visible) if (!next.has(index)) faces[index].style.display = "none";
      visible = next;
      return progress < 1;
    };
    const measure = () => {
      height = Math.ceil(Math.max(48, parseFloat(getComputedStyle(window).fontSize) * 1.2 + 12));
      window.style.setProperty("--reel-row-height", height + "px");
      const logicalRadius = rows.length > 2 ? height / (2 * Math.tan(Math.PI / rows.length)) : height / 2;
      radius = Math.max(height * 1.05, window.clientHeight * 0.58);
      bend = Math.max(1, logicalRadius * 1.12 / radius);
      window.style.setProperty("--reel-perspective", Math.max(220, radius * 2.2) + "px");
      paint();
    };
    const tick = () => { if (paint()) frame = requestAnimationFrame(tick); };
    measure(); tick(); const observer = new ResizeObserver(measure); observer.observe(window);
    globalThis.window.addEventListener(textScaleEvent, measure);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); globalThis.window.removeEventListener(textScaleEvent, measure); };
  }, [draw.id, shown, rows]);
  return <div ref={viewport} className="raffle-reel" aria-hidden="true"><div ref={track} className="raffle-reel-track">{shown && rows.map((participant, index) => <div className="raffle-reel-row" key={participant.key} data-participant-key={participant.key} data-angle={index * 360 / rows.length} style={{ display: "none" }}><ParticipantName participant={participant} /></div>)}</div></div>;
}
