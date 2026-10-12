import { useEffect, useRef } from "react";
import type confetti from "canvas-confetti";
import type { Fireworks } from "fireworks-js";
import { usePageActive } from "./activity";

export function WinnerCelebration({ id, enabled }: { id: string; enabled: boolean }) {
  const layer = useRef<HTMLDivElement>(null), sky = useRef<HTMLDivElement>(null), paper = useRef<HTMLCanvasElement>(null);
  const cannon = useRef<confetti.CreateTypes | null>(null), celebrated = useRef(false);
  const active = usePageActive() && enabled;
  useEffect(() => {
    const element = layer.current, container = sky.current, canvas = paper.current;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    if (!element || !container || !canvas || !active || celebrated.current || motion.matches) return;
    let disposed = false, fireworks: Fireworks | undefined;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const stop = () => {
      disposed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear(); cannon.current?.reset(); fireworks?.stop(true);
      element.dataset.running = "false";
    };
    const later = (milliseconds: number, action: () => void) => {
      const timer = setTimeout(() => { timers.delete(timer); if (!disposed) action(); }, milliseconds);
      timers.add(timer);
    };
    void Promise.all([import("canvas-confetti"), import("fireworks-js")]).then(([{ default: confetti }, { Fireworks }]) => {
      if (disposed) return;
      celebrated.current = true;
      const width = container.clientWidth, height = container.clientHeight;
      fireworks = new Fireworks(container, {
        autoresize: true, rocketsPoint: { min: 15, max: 85 },
        hue: { min: 35, max: 190 }, particles: 80, explosion: 5,
        traceLength: 4, traceSpeed: 9, acceleration: 1.045,
        friction: .955, gravity: 1.05, opacity: .22,
        brightness: { min: 58, max: 82 }, decay: { min: .018, max: .029 }, flickering: 20,
        lineWidth: { trace: { min: 1, max: 2 }, explosion: { min: 1, max: 2.4 } },
        mouse: { click: false, move: false, max: 0 }, sound: { enabled: false, files: [] },
      });
      fireworks.updateBoundaries({ x: Math.round(width * .08), y: Math.round(height * .1), width, height: Math.round(height * .6) });
      cannon.current ??= confetti.create(canvas, { resize: true, useWorker: true, disableForReducedMotion: true });
      const colors = ["#ffcb69", "#ff8fab", "#80eddb", "#72bfff", "#c4b5fd", "#fff1b8"];
      const ribbon = confetti.shapeFromPath({ path: "M0 0 L3 0 L3 18 L0 18 Z" });
      const burst = (x: number, angle: number) => { void cannon.current?.({
        particleCount: 85, angle, spread: 72, startVelocity: 43, decay: .92,
        gravity: 1.1, ticks: 200, scalar: .95, colors,
        shapes: ["square", "circle", ribbon], origin: { x, y: .76 },
      }); };
      element.dataset.running = "true";
      fireworks.launch(2);
      later(300, () => fireworks?.launch(1));
      later(720, () => { burst(.04, 58); burst(.96, 122); });
      later(1320, () => { void cannon.current?.({
        particleCount: 40, spread: 160, startVelocity: 15, gravity: .65,
        decay: .94, ticks: 170, scalar: .85, colors,
        shapes: ["star", "square"], origin: { x: .5, y: .12 },
      }); });
      later(4900, stop);
    }).catch(error => { stop(); console.error("당첨 축하 효과를 불러오지 못했습니다.", error); });
    motion.addEventListener("change", stop);
    return () => { motion.removeEventListener("change", stop); stop(); };
  }, [id, active]);
  return <div className="winner-celebration" ref={layer} aria-hidden="true" data-effects="fireworks confetti" data-libraries="fireworks-js canvas-confetti">
    <div className="winner-fireworks" ref={sky} />
    <canvas className="winner-confetti" ref={paper} />
  </div>;
}
