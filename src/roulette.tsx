import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { changeScreen } from "./presentation";

export type RouletteItem = { name: string; weight: number };
export type RouletteImport = {
  id: string;
  title: string;
  items: RouletteItem[];
};
type Entry = RouletteItem & { id: number };
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
function loadItems(): Entry[] {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem("streamer-assist-roulette-items") ?? "[]",
    );
    if (!Array.isArray(saved) || saved.length > 12) return [];
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
    return [];
  }
}
function segments(items: RouletteItem[]) {
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
}: {
  items: RouletteItem[];
  rotation?: number;
  spinning?: boolean;
  winner?: number | null;
  durationMs?: number;
}) {
  const discRef = useRef<SVGSVGElement>(null);
  const previousRotation = useRef(rotation);
  useLayoutEffect(() => {
    const from = previousRotation.current;
    previousRotation.current = rotation;
    if (
      !spinning ||
      from === rotation ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    // A Web Animation keeps its timeline when the tool is hidden by another tab.
    const animation = discRef.current?.animate(
      [
        { transform: "rotate(" + from + "deg)" },
        { transform: "rotate(" + rotation + "deg)" },
      ],
      { duration: durationMs, easing: "cubic-bezier(.1,.7,.12,1)" },
    );
    return () => animation?.cancel();
  }, [rotation, spinning, durationMs]);
  return (
    <div className={"wheel-frame" + (spinning ? " spinning" : "")}>
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
        {segments(items)
          .filter((item) => item.weight > 0)
          .map((item) => {
            const label = point(item.middle, 122);
            const labelLimit = Math.max(
              1,
              Math.min(
                11,
                Math.floor(
                  ((((item.end - item.start) * Math.PI) / 180) * 122) / 13,
                ) - 1,
              ),
            );
            return (
              <g
                key={item.index}
                data-segment={item.index}
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
        <span>
          {spinning ? "SPINNING" : winner !== null ? "PICKED!" : "READY"}
        </span>
      </div>
    </div>
  );
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
  const [items, setItems] = useState<Entry[]>(loadItems);
  const nextId = useRef(100);
  const [title, setTitle] = useState(() => {
    try {
      return (
        localStorage.getItem("streamer-assist-roulette-title") ?? ""
      ).slice(0, 100);
    } catch {
      return "";
    }
  });
  const [draft, setDraft] = useState("");
  const draftRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const [view, setView] = useState<"setup" | "stage">("setup");
  const [error, setError] = useState("");
  const [spinning, setSpinning] = useState(false);
  const [spinDurationMs, setSpinDurationMs] = useState(4000);
  useEffect(() => onSpinningChange(spinning), [spinning, onSpinningChange]);
  const spinLocked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rotation, setRotation] = useState(0);
  const [winner, setWinner] = useState<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
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
          "streamer-assist-roulette-items",
          JSON.stringify(items.map(({ name, weight }) => ({ name, weight }))),
        );
      localStorage.setItem("streamer-assist-roulette-title", title);
    } catch {}
  }, [items, title]);
  const lastImport = useRef<string | null>(null);
  useEffect(() => {
    if (!imported || imported.id === lastImport.current || spinLocked.current)
      return;
    lastImport.current = imported.id;
    setItems(imported.items.map((item) => ({ ...item, id: nextId.current++ })));
    setTitle(imported.title);
    setDraft("");
    setWinner(null);
    setRotation(0);
    setError("");
    setView("stage");
  }, [imported]);
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
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
    const name = draft.trim();
    if (!name || items.length >= 12) return;
    if (items.some((item) => item.name.trim() === name)) {
      setError("같은 항목이 이미 있습니다.");
      draftRef.current?.focus();
      return;
    }
    setItems([...items, { id: nextId.current++, name, weight: 1 }]);
    setDraft("");
    setWinner(null);
    setRotation(0);
    setError("");
    requestAnimationFrame(() => {
      draftRef.current?.focus();
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
      setSpinDurationMs(result.durationMs);
      const turns = Math.max(3, Math.round(result.durationMs / 1000));
      setRotation(
        (previous) => Math.ceil(previous / 360) * 360 + turns * 360 + stop,
      );
      const finish = () => {
        setWinner(result.index);
        setSpinning(false);
        spinLocked.current = false;
        timer.current = null;
      };
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) finish();
      else timer.current = setTimeout(finish, result.durationMs);
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
        <div className="roulette-setup screen-enter">
          <section className="panel roulette-editor">
            <div className="panel-heading">
              <h2>
                <Icon name="roulette" size={19} /> 룰렛 만들기
              </h2>
              <span className="tag">{items.length}/12</span>
            </div>
            <p className="panel-description">
              가중치가 클수록 당첨 확률이 높아집니다.
            </p>
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
              <span>가중치</span>
            </div>
            <ol className="roulette-item-list" ref={listRef}>
              {items.map((item, index) => (
                <li key={item.id}>
                  <i style={{ background: colors[index] }} />
                  <input
                    aria-label={"룰렛 항목 " + (index + 1)}
                    value={item.name}
                    placeholder="항목 이름"
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
                    }}
                  />
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
                  <button
                    className="icon-button"
                    aria-label={"룰렛 항목 " + (index + 1) + " 삭제"}
                    onClick={() => {
                      setItems(items.filter((entry) => entry.id !== item.id));
                      setWinner(null);
                      setRotation(0);
                      requestAnimationFrame(() => draftRef.current?.focus());
                    }}
                  >
                    <Icon name="close" size={15} />
                  </button>
                </li>
              ))}
            </ol>
            <div className="roulette-add">
              <input
                ref={draftRef}
                aria-label="새 룰렛 항목"
                value={draft}
                readOnly={items.length >= 12}
                maxLength={50}
                placeholder={
                  items.length >= 12
                    ? "최대 12개까지 추가할 수 있어요"
                    : "새 항목을 입력하세요"
                }
                onChange={(event) => {
                  setDraft(event.target.value);
                  setError("");
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.nativeEvent.isComposing &&
                    event.nativeEvent.keyCode !== 229
                  ) {
                    event.preventDefault();
                    addItem();
                  }
                }}
              />
              <button
                className="secondary"
                aria-label="룰렛 항목 추가"
                disabled={!draft.trim() || items.length >= 12}
                onClick={addItem}
              >
                <Icon name="plus" size={15} /> 추가
              </button>
            </div>
            <div className="roulette-form-bottom">
              <p className="roulette-form-error" role="status">
                {error ||
                  (items.length < 2
                    ? "최소 2개 항목을 추가하세요."
                    : !valid
                      ? "서로 다른 이름과 유효한 가중치를 입력하세요."
                      : "가중치 0인 항목은 당첨되지 않습니다.")}
              </p>
              <button
                className="secondary"
                disabled={!canImport || spinning}
                title={
                  canImport
                    ? "종료된 투표의 득표수를 가중치로 가져옵니다."
                    : "득표수가 있는 투표를 종료한 후 가져올 수 있습니다."
                }
                onClick={onImport}
              >
                <Icon name="poll" size={16} /> 투표 결과 가져오기
              </button>
              <button
                className="primary"
                disabled={!valid || !!draft.trim()}
                onClick={() =>
                  changeScreen(() => {
                    setWinner(null);
                    setRotation(0);
                    setError("");
                    setView("stage");
                  })
                }
              >
                <Icon name="play" size={17} /> 방송용 룰렛 보기
              </button>
            </div>
          </section>
          <section className="roulette-preview">
            <div className="roulette-wheel-space">
              <Wheel items={items} />
            </div>
            <p>
              {items.length
                ? "항목별 가중치가 룰렛에 바로 반영됩니다."
                : "항목을 추가하면 룰렛이 완성됩니다."}
            </p>
          </section>
        </div>
      ) : (
        <section
          className="roulette-stage screen-enter"
          aria-label="방송용 룰렛"
        >
          <div className="roulette-stage-heading">
            <div>
              <span className="stage-status">
                {spinning
                  ? "SPINNING"
                  : winner !== null
                    ? "WINNER"
                    : "READY TO SPIN"}
              </span>
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
              <span>
                {error ||
                  (spinning
                    ? "두근두근… 룰렛이 돌아가고 있어요."
                    : "돌려! 버튼을 눌러 선택을 맡겨보세요.")}
              </span>
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
