import { useTabState, TabDraftContext, rouletteStorageKey } from "./workspace-state";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { HelpTip } from "./help-tip";
import { useTextScale } from "./text-size";
import { changeScreen } from "./presentation";
import { useDrawAnimations, usePageActive } from "./activity";

export type RouletteItem = { name: string; weight: number };
export type RouletteImport = {
  id: string;
  title: string;
  items: RouletteItem[];
};
type Entry = RouletteItem & { id: number };
type WheelItem = RouletteItem & { id?: number };
const colors = [
  "#1fbd88",
  "#268cda",
  "#7258cf",
  "#dc7850",
  "#bc5797",
  "#369ca4",
  "#5876d7",
  "#99804b",
  "#4aa66a",
  "#a666cf",
  "#bf5861",
  "#547d98",
];
const maxWeight = 1000000000;
const blankItems = (): Entry[] => [{ id: 1, name: "", weight: 1 }, { id: 2, name: "", weight: 1 }];
function loadItems(id = "roulette"): Entry[] {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(rouletteStorageKey("items", id)) ?? "[]",
    );
    if (!Array.isArray(saved) || saved.length > 12 || !saved.length) return blankItems();
    return saved.map((item, id) => ({
      id,
      name: typeof item?.name === "string" ? item.name.slice(0, 50) : "",
      weight:
        Number.isSafeInteger(item?.weight) &&
        item.weight >= 0 &&
        item.weight <= maxWeight
          ? item.weight
          : 1,
    }));
  } catch {
    return blankItems();
  }
}
function segments(items: WheelItem[]) {
  const safeItems = items.map((item) => ({
    ...item,
    weight:
      Number.isFinite(item.weight) && item.weight > 0
        ? Math.min(maxWeight, item.weight)
        : 0,
  }));
  const total = safeItems.reduce((sum, item) => sum + item.weight, 0);
  let start = 0;
  return safeItems.map((item, index) => {
    const end = start + (total ? (item.weight / total) * 360 : 0);
    const segment = { ...item, index, start, end, middle: (start + end) / 2 };
    start = end;
    return segment;
  });
}
type WheelSegment = ReturnType<typeof segments>[number];
type PreviewArc = { key: number; degrees: number };
const segmentKey = (item: WheelSegment) => item.id ?? item.index;
function point(angle: number, radius = 184) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return [200 + radius * Math.cos(radians), 200 + radius * Math.sin(radians)];
}
function wedge(start: number, end: number) {
  const a = point(start),
    b = point(end);
  return (
    "M200 200L" +
    a.join(" ") +
    "A184 184 0 " +
    (end - start > 180 ? "1" : "0") +
    " 1 " +
    b.join(" ") +
    "Z"
  );
}
function Wheel({
  items,
  rotation = 0,
  spinning = false,
  winner = null,
  durationMs = 4000,
  startedAt = 0,
  fromRotation,
  slices,
  morphing = false,
}: {
  items: RouletteItem[];
  rotation?: number;
  spinning?: boolean;
  winner?: number | null;
  durationMs?: number;
  startedAt?: number;
  fromRotation?: number;
  slices?: WheelSegment[];
  morphing?: boolean;
}) {
  const discRef = useRef<SVGSVGElement>(null);
  const textScale = useTextScale();
  const previousRotation = useRef(rotation);
  useLayoutEffect(() => {
    const from = startedAt && fromRotation !== undefined ? fromRotation : previousRotation.current;
    previousRotation.current = rotation;
    if (
      !spinning ||
      from === rotation ||
      durationMs <= 0
    )
      return;
    // Resume the same spin clock after transferring this tool to another renderer.
    const animation = discRef.current?.animate(
      [
        { transform: "rotate(" + from + "deg)" },
        { transform: "rotate(" + rotation + "deg)" },
      ],
      { duration: durationMs, easing: "cubic-bezier(.1,.7,.12,1)" },
    );
    if (animation && startedAt) animation.currentTime = Math.min(durationMs, Math.max(0, Date.now() - startedAt));
    return () => animation?.cancel();
  }, [rotation, spinning, durationMs, startedAt, fromRotation]);
  return (
    <div className={"wheel-frame" + (spinning ? " spinning" : "")} data-morphing={morphing}>
      <div className="wheel-pointer" aria-hidden="true" />
      <svg
        ref={discRef}
        className="roulette-disc"
        viewBox="0 0 400 400"
        role="img"
        aria-label="가중치에 따른 룰렛"
        style={{
          transform: "rotate(" + rotation + "deg)",
        }}
        data-wheel-angle={rotation}
      >
        <circle cx="200" cy="200" r="192" className="wheel-rim" />
        <circle cx="200" cy="200" r="184" className="wheel-empty" />
        {(slices ?? segments(items))
          .filter((item) => item.end > item.start)
          .map((item) => {
            const label = point(item.middle, 122);
            const labelLimit = Math.max(
              1,
              Math.min(
                Math.floor(11 / textScale),
                Math.floor(
                  ((((item.end - item.start) * Math.PI) / 180) * 122) / (13 * textScale),
                ) - 1,
              ),
            );
            return (
              <g
                key={segmentKey(item)}
                data-segment={item.index}
                data-segment-key={segmentKey(item)}
                data-start-angle={item.start}
                data-end-angle={item.end}
                data-middle-angle={item.middle}
              >
                {item.end - item.start >= 359.99999 ? (
                  <circle cx="200" cy="200" r="184" fill={colors[item.index]} />
                ) : (
                  <path
                    d={wedge(item.start, item.end)}
                    fill={colors[item.index]}
                    stroke="var(--bg)"
                    strokeWidth="2"
                  />
                )}
                {item.end - item.start > 7 && (
                  <text
                    x={label[0]}
                    y={label[1]}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={
                      "rotate(" + item.middle + " " + label.join(" ") + ")"
                    }
                  >
                    {item.name.length > labelLimit
                      ? item.name.slice(0, labelLimit - 1) + "…"
                      : item.name}
                  </text>
                )}
                <title>{item.name + " · 가중치 " + item.weight}</title>
              </g>
            );
          })}
        <circle
          cx="200"
          cy="200"
          r="184"
          fill="none"
          stroke="var(--border-hover)"
          strokeWidth="1"
        />
      </svg>
      <div className={"wheel-center" + (winner !== null ? " selected" : "")}>
        <Icon
          name={spinning ? "refresh" : winner !== null ? "check" : "roulette"}
          size={27}
        />
      </div>
    </div>
  );
}
function PreviewWheel({ items }: { items: WheelItem[] }) {
  const active = usePageActive();
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [arcs, setArcs] = useState<PreviewArc[]>([]);
  const [morphing, setMorphing] = useState(false);
  const current = useRef<PreviewArc[]>([]);
  const metadata = useRef(new Map<number, WheelSegment>());
  const targets = segments(items);
  const targetArcs = targets.map(item => ({ key: segmentKey(item), degrees: item.end - item.start }));
  const signature = targetArcs.map(item => `${item.key}:${item.degrees}`).join("|");
  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(motion.matches);
    update();
    motion.addEventListener("change", update);
    return () => motion.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    for (const item of targets) metadata.current.set(segmentKey(item), item);
  }, [items]);
  useLayoutEffect(() => {
    let frame = 0;
    const finish = () => {
      current.current = targetArcs;
      setArcs(targetArcs);
      setMorphing(false);
      metadata.current = new Map(targetArcs.map(item => [item.key, metadata.current.get(item.key)!]));
    };
    if (!active || reducedMotion) { finish(); return; }
    const from = new Map(current.current.map(item => [item.key, item.degrees]));
    const to = new Map(targetArcs.map(item => [item.key, item.degrees]));
    // Keep retiring slices until they shrink away; new slices start at zero.
    const order = current.current.map(item => item.key);
    for (const [index, item] of targetArcs.entries()) {
      if (order.includes(item.key)) continue;
      const next = targetArcs.slice(index + 1).find(candidate => order.includes(candidate.key));
      order.splice(next ? order.indexOf(next.key) : order.length, 0, item.key);
    }
    const changes = order.map(key => ({ key, from: from.get(key) ?? 0, to: to.get(key) ?? 0 }));
    if (changes.every(item => Math.abs(item.from - item.to) < 0.0001)) { finish(); return; }
    const startedAt = performance.now();
    setMorphing(true);
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - startedAt) / 420));
      if (progress === 1) { finish(); return; }
      const eased = 1 - (1 - progress) ** 3;
      current.current = changes.map(item => ({ key: item.key, degrees: item.from + (item.to - item.from) * eased }));
      setArcs(current.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [signature, active, reducedMotion]);
  const latest = new Map(targets.map(item => [segmentKey(item), item]));
  let angle = 0;
  const displayed = arcs.flatMap(arc => {
    const item = latest.get(arc.key) ?? metadata.current.get(arc.key);
    const start = angle;
    angle += arc.degrees;
    return item ? [{ ...item, start, end: angle, middle: (start + angle) / 2 }] : [];
  });
  return <Wheel items={items} slices={displayed} morphing={morphing && active && !reducedMotion} />;
}
export function RoulettePage({
  active,
  imported,
  canImport,
  onImport,
  onSpinningChange,
}: {
  active: boolean;
  imported: RouletteImport | null;
  canImport: boolean;
  onImport: () => void;
  onSpinningChange: (spinning: boolean) => void;
}) {
  const context = useContext(TabDraftContext);
  const drawAnimations = useDrawAnimations();
  const seedId = typeof context.draft.__seedFrom === "string" ? context.draft.__seedFrom : context.id;
  const [items, setItems] = useTabState<Entry[]>("roulette.items", () => loadItems(seedId));
  const nextId = useRef(Math.max(99, ...items.map(item => item.id)) + 1);
  const [title, setTitle] = useTabState("roulette.title", () => {
    try {
      return (
        localStorage.getItem(rouletteStorageKey("title", seedId)) ?? ""
      ).slice(0, 100);
    } catch {
      return "";
    }
  });
  const itemInputs = useRef<(HTMLInputElement | null)[]>([]);
  const listRef = useRef<HTMLOListElement>(null);
  const [view, setView] = useTabState<"setup" | "stage">("roulette.view", "setup");
  const [error, setError] = useState("");
  const [spinEndsAt, setSpinEndsAt] = useTabState("roulette.spinEndsAt", 0);
  const [spinResult, setSpinResult] = useTabState<number | null>("roulette.spinResult", null);
  const [spinning, setSpinning] = useState(spinEndsAt > Date.now());
  const [spinDurationMs, setSpinDurationMs] = useTabState("roulette.spinDurationMs", 4000);
  const [spinStartsAt, setSpinStartsAt] = useTabState("roulette.spinStartsAt", 0);
  const [spinFromRotation, setSpinFromRotation] = useTabState("roulette.spinFromRotation", 0);
  useEffect(() => onSpinningChange(spinning), [spinning, onSpinningChange]);
  const spinLocked = useRef(spinEndsAt > Date.now());
  const [rotation, setRotation] = useTabState("roulette.rotation", 0);
  const [winner, setWinner] = useTabState<number | null>("roulette.winner", null);
  useEffect(() => {
    if (!spinEndsAt || spinResult === null) return;
    const finish = () => {
      setWinner(spinResult);
      setSpinning(false);
      spinLocked.current = false;
      setSpinEndsAt(0);
    };
    const remaining = spinEndsAt - Date.now();
    if (remaining <= 0) { finish(); return; }
    setSpinning(true);
    spinLocked.current = true;
    const pending = setTimeout(finish, remaining);
    return () => clearTimeout(pending);
  }, [spinEndsAt, spinResult, setSpinEndsAt, setWinner]);
  useEffect(() => {
    try {
      if (
        items.every(
          (item) =>
            Number.isSafeInteger(item.weight) &&
            item.weight >= 0 &&
            item.weight <= maxWeight,
        )
      )
        localStorage.setItem(
          rouletteStorageKey("items", context.id),
          JSON.stringify(items.map(({ name, weight }) => ({ name, weight }))),
        );
      localStorage.setItem(rouletteStorageKey("title", context.id), title);
    } catch {}
  }, [items, title, context.id]);
  const [lastImport, setLastImport] = useTabState<string | null>("roulette.lastImport", null);
  useEffect(() => {
    if (!imported || imported.id === lastImport || spinLocked.current)
      return;
    setLastImport(imported.id);
    setItems(imported.items.map((item) => ({ ...item, id: nextId.current++ })));
    setTitle(imported.title);
    setWinner(null);
    setRotation(0);
    setError("");
    setView("stage");
  }, [imported]);
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  const previewItems = items.map(item => ({
    id: item.id,
    name: item.name.trim(),
    weight: item.name.trim() && Number.isSafeInteger(item.weight) && item.weight > 0 && item.weight <= maxWeight ? item.weight : 0,
  }));
  const previewTotalWeight = previewItems.reduce((sum, item) => sum + item.weight, 0);
  const valid =
    items.length >= 2 &&
    items.length <= 12 &&
    totalWeight > 0 &&
    items.every(
      (item) =>
        item.name.trim() &&
        item.name.length <= 50 &&
        Number.isSafeInteger(item.weight) &&
        item.weight >= 0 &&
        item.weight <= maxWeight,
    ) &&
    new Set(items.map((item) => item.name.trim())).size === items.length;
  function addItem() {
    if (items.length >= 12) return;
    setItems([...items, { id: nextId.current++, name: "", weight: 1 }]);
    setWinner(null);
    setRotation(0);
    setError("");
    requestAnimationFrame(() => {
      itemInputs.current[items.length]?.focus();
      listRef.current?.scrollTo({
        top: listRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }
  async function spin() {
    if (spinLocked.current || !valid) return;
    spinLocked.current = true;
    setSpinning(true);
    setWinner(null);
    setError("");
    try {
      const reply = await window.assist?.call("roulette-spin", {
        items: items.map(({ name, weight }) => ({ name, weight })),
      });
      if (!reply?.ok)
        throw new Error(reply?.error || "데스크톱 앱에서 룰렛을 실행하세요.");
      const result = reply.data as { index: number; name: string; durationMs: number };
      if (
        !result ||
        !Number.isInteger(result.index) ||
        !items[result.index] ||
        items[result.index].weight <= 0 ||
        result.name !== items[result.index].name.trim() || !Number.isSafeInteger(result.durationMs) ||
        result.durationMs < 4000 || result.durationMs > 7000
      )
        throw new Error("룰렛 결과를 확인하지 못했습니다.");
      const stop = (360 - segments(items)[result.index].middle) % 360;
      const durationMs = drawAnimations ? result.durationMs : 0;
      setSpinDurationMs(durationMs);
      const startedAt = Date.now();
      setSpinFromRotation(rotation);
      setSpinStartsAt(startedAt);
      const turns = Math.max(3, Math.round(result.durationMs / 1000));
      setRotation(
        (previous) => Math.ceil(previous / 360) * 360 + turns * 360 + stop,
      );
      setSpinResult(result.index);
      setSpinEndsAt(startedAt + durationMs);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "룰렛을 돌리지 못했습니다.",
      );
      setSpinning(false);
      spinLocked.current = false;
    }
  }
  return (
    <div hidden={!active} className="roulette-page page-body" aria-label="룰렛">
      {view === "setup" ? (
        <div className="roulette-setup tool-setup screen-enter">
          <section className="roulette-editor tool-composer">
            <div className="tool-heading">
              <h1>룰렛</h1>
              <button className="secondary roulette-import" disabled={!canImport || spinning}
                title={canImport ? "종료된 투표의 득표수를 가중치로 가져옵니다." : "득표수가 있는 투표를 종료한 후 가져올 수 있습니다."}
                onClick={onImport}><Icon name="poll" size={16} /> 투표 결과 가져오기</button>
            </div>
            <label>
              룰렛 제목
              <input
                aria-label="룰렛 제목"
                value={title}
                placeholder="예: 다음 게임을 골라볼까요?"
                maxLength={100}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <div className="roulette-list-heading">
              <span>항목</span>
              <span>가중치 <HelpTip label="룰렛 가중치 안내">가중치에 비례해 당첨 확률이 정해집니다. 가중치가 0인 항목은 추첨에서 제외됩니다.</HelpTip></span>
              <span>확률</span>
            </div>
            <ol className="roulette-item-list" ref={listRef}>
              {items.map((item, index) => (
                <li key={item.id}>
                  <div className="tool-option-field">
                    <i className="roulette-item-color" style={{ background: colors[index] }} />
                    <input
                      ref={element => { itemInputs.current[index] = element; }}
                      aria-label={"룰렛 항목 " + (index + 1)}
                      value={item.name}
                      placeholder={"항목 " + (index + 1)}
                      maxLength={50}
                      onChange={(event) => {
                        setItems(
                          items.map((entry) =>
                            entry.id === item.id
                              ? { ...entry, name: event.target.value }
                              : entry,
                          ),
                        );
                        setWinner(null);
                        setError("");
                      }}
                      onKeyDown={event => {
                        if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                          event.preventDefault();
                          itemInputs.current[index + 1]?.focus();
                        }
                      }}
                    />
                  </div>
                  <input
                    aria-label={"룰렛 가중치 " + (index + 1)}
                    type="number"
                    min={0}
                    max={maxWeight}
                    step={1}
                    value={item.weight}
                    onChange={(event) => {
                      setItems(
                        items.map((entry) =>
                          entry.id === item.id
                            ? { ...entry, weight: Number(event.target.value) }
                            : entry,
                        ),
                      );
                      setWinner(null);
                    }}
                  />
                  <span className="roulette-item-chance" aria-label={"룰렛 확률 " + (index + 1)}>{item.name.trim() && Number.isSafeInteger(item.weight) && item.weight >= 0 && item.weight <= maxWeight && previewTotalWeight > 0 ? `${(previewItems[index].weight / previewTotalWeight * 100).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%` : "—"}</span>
                  {items.length > 2 && <button
                    className="icon-button"
                    aria-label={"룰렛 항목 " + (index + 1) + " 삭제"}
                    onClick={() => {
                      setItems(items.filter((entry) => entry.id !== item.id));
                      setWinner(null);
                      setRotation(0);
                      requestAnimationFrame(() => itemInputs.current[Math.min(index, items.length - 2)]?.focus());
                    }}
                  >
                    <Icon name="close" size={15} />
                  </button>}
                </li>
              ))}
            </ol>
            {items.length < 12 &&
              <button
                className="secondary tool-add-option"
                aria-label="룰렛 항목 추가"
                onClick={addItem}
              >
                <Icon name="plus" size={15} /> 항목 추가
              </button>}
            <div className="roulette-form-bottom">
              {(error || (items.length >= 2 && items.every(item => item.name.trim()) && !valid)) && <p className="roulette-form-error" role="status">
                {error || "서로 다른 이름과 유효한 가중치를 입력하세요."}
              </p>}
              <button
                className="primary"
                disabled={!valid}
                onClick={() =>
                  changeScreen(() => {
                    setWinner(null);
                    setRotation(0);
                    setError("");
                    setView("stage");
                  })
                }
              >
                <Icon name="play" size={17} /> 시작
              </button>
            </div>
          </section>
          <aside className="roulette-setup-preview" aria-label="룰렛 미리보기">
            <div className="roulette-wheel-space">
              <PreviewWheel items={previewItems} />
            </div>
          </aside>
        </div>
      ) : (
        <section
          className="roulette-stage screen-enter"
          aria-label="방송용 룰렛"
        >
          <div className="roulette-stage-heading">
            <div>
              <h2 title={title}>{title || "어떤 항목이 선택될까요?"}</h2>
            </div>
            <button
              className="text-button"
              disabled={spinning}
              onClick={() => changeScreen(() => setView("setup"))}
            >
              <Icon name="settings" size={16} /> 항목 수정
            </button>
          </div>
          <div className="roulette-stage-main">
            <div className="roulette-wheel-space">
              <Wheel
                items={items}
                rotation={rotation}
                spinning={spinning}
                winner={winner}
                durationMs={spinDurationMs}
                startedAt={spinStartsAt}
                fromRotation={spinFromRotation}
              />
            </div>
            <ol className="roulette-legend">
              {items.map((item, index) => (
                <li
                  key={item.id}
                  className={
                    (winner === index ? "chosen" : "") +
                    (item.weight === 0 ? " excluded" : "")
                  }
                  data-item-index={index}
                >
                  <i style={{ background: colors[index] }} />
                  <span title={item.name}>{item.name}</span>
                  <b>
                    {totalWeight
                      ? ((item.weight / totalWeight) * 100).toFixed(1)
                      : "0.0"}
                    %
                  </b>
                </li>
              ))}
            </ol>
          </div>
          <div
            className={
              "roulette-outcome" + (winner !== null ? " revealed" : "")
            }
            role="status"
            aria-live="polite"
            data-winner-index={winner ?? ""}
          >
            {winner !== null ? (
              <>
                <Icon name="sparkles" size={24} />
                <span>선택된 항목</span>
                <strong title={items[winner].name}>{items[winner].name}</strong>
              </>
            ) : (
              error && <span>{error}</span>
            )}
          </div>
          <div className="roulette-stage-controls">
            <button
              className="secondary"
              disabled={spinning}
              onClick={() => changeScreen(() => setView("setup"))}
            >
              돌아가기
            </button>
            <button
              className="primary stage-primary roulette-spin"
              disabled={spinning || !valid}
              onClick={() => void spin()}
            >
              <Icon name="refresh" size={20} />
              {spinning
                ? "돌아가는 중…"
                : winner !== null
                  ? "다시 돌려!"
                  : "돌려!"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
