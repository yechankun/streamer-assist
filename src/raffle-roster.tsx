import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Participant, RaffleState } from "./audience-types";
import { Icon } from "./icons";
import { ParticipantName } from "./participant-name";
import { openViewerChat } from "./viewer-chat";

const nameGap = 16;
function fittingNames(widths: number[], available: number, rows: number) {
  let row = 1, used = 0;
  for (let index = 0; index < widths.length; index++) {
    const next = used ? used + nameGap + widths[index] : widths[index];
    if (next > available && used) {
      if (++row > rows) return index;
      used = widths[index];
    } else used = next;
  }
  return widths.length;
}

export function RaffleRoster({ raffle, active, drawing, nameSize }: { raffle: RaffleState; active: boolean; drawing: boolean; nameSize: number }) {
  const area = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement | null>(null);
  const previousPages = useRef(new Map<number, number>());
  const [geometry, setGeometry] = useState({ width: 900, height: 600, scale: 1 });
  const [cursor, setCursor] = useState({ offset: 0, before: false }), [automatic, setAutomatic] = useState(true), [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; offset: number; people: Participant[] } | null>(null);
  const [error, setError] = useState("");
  const fontSize = nameSize * geometry.scale, rowHeight = Math.ceil(fontSize * 1.3) + 12;
  const visibleRows = Math.min(120, Math.max(1, Math.floor((geometry.height + 4) / (rowHeight + 4))));
  const offset = cursor.before ? Math.max(0, cursor.offset - 120) : cursor.offset;
  const requestKey = raffle.id + ":" + cursor.offset + ":" + cursor.before;
  useLayoutEffect(() => {
    const element = area.current; if (!element) return;
    const measure = () => {
      const scale = Number(getComputedStyle(document.documentElement).getPropertyValue("--text-scale")) || 1;
      if (!element.clientWidth || !element.clientHeight) return;
      const next = { width: element.clientWidth, height: element.clientHeight, scale };
      setGeometry(previous => previous.width === next.width && previous.height === next.height && previous.scale === next.scale ? previous : next);
    };
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    window.addEventListener("assist:text-scale", measure);
    return () => { observer.disconnect(); window.removeEventListener("assist:text-scale", measure); };
  }, [active]);
  useEffect(() => { setCursor({ offset: 0, before: false }); setAutomatic(true); setResult(null); }, [raffle.id]);
  useLayoutEffect(() => { previousPages.current.clear(); }, [geometry, nameSize, raffle.rosterRevision]);
  useEffect(() => {
    if (cursor.offset > raffle.candidateCount || (!cursor.before && cursor.offset > 0 && cursor.offset === raffle.candidateCount))
      setCursor({ offset: cursor.before && raffle.candidateCount ? raffle.candidateCount : 0, before: cursor.before && raffle.candidateCount > 0 });
  }, [cursor, raffle.candidateCount]);
  useEffect(() => {
    if (!active) return;
    let disposed = false; setError("");
    void window.assist?.call("raffle-participants", { id: raffle.id, offset, limit: 120 }).then(reply => {
      if (disposed) return;
      if (!reply.ok) throw Error(reply.error || "명단을 불러오지 못했습니다.");
      const data = reply.data as { id: string; offset: number; participants: Participant[] };
      if (data.id === raffle.id && data.offset === offset) setResult({ key: requestKey, offset, people: data.participants });
    }).catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : "명단을 불러오지 못했습니다."); });
    return () => { disposed = true; };
  }, [raffle.id, raffle.rosterRevision, raffle.candidateCount, active, offset, requestKey, retry]);
  const { people, widths, start, end } = useMemo(() => {
    if (!result || result.key !== requestKey) return { people: [] as Participant[], widths: [] as number[], start: cursor.offset, end: cursor.offset };
    const candidates = cursor.before ? result.people.slice(0, cursor.offset - result.offset) : result.people;
    canvas.current ??= document.createElement("canvas");
    const context = canvas.current.getContext("2d");
    if (context) context.font = `650 ${fontSize}px ` + getComputedStyle(area.current || document.body).fontFamily;
    const badge = Math.min(44, Math.max(18, fontSize * .72));
    const widths = candidates.map(person => Math.min(geometry.width, Math.ceil((context?.measureText(person.name).width ?? person.name.length * fontSize) + badge + 18 + (person.subscriber ? 21 : 0))));
    let from = 0, count = fittingNames(widths, geometry.width, visibleRows);
    // Previous pages pack a suffix ending immediately before the current page.
    // Forward packing keeps every name intact and provides exact next offsets.
    if (cursor.before) {
      while (from < candidates.length - 1 && fittingNames(widths.slice(from), geometry.width, visibleRows) < candidates.length - from) from++;
      count = candidates.length - from;
    }
    const start = result.offset + from;
    return { people: candidates.slice(from, from + count), widths: widths.slice(from, from + count), start, end: start + count };
  }, [result, requestKey, cursor, fontSize, geometry, visibleRows]);
  const multiple = start > 0 || end < raffle.candidateCount;
  const ready = result?.key === requestKey && people.length > 0;
  useEffect(() => {
    if (!automatic || !active || drawing || !multiple || !ready) return;
    const timer = setInterval(() => {
      if (!document.hidden && !document.querySelector("dialog[open]")) {
        const next = end < raffle.candidateCount ? end : 0;
        previousPages.current.set(next, start);
        setCursor({ offset: next, before: false });
      }
    }, 8000);
    return () => clearInterval(timer);
  }, [automatic, active, drawing, multiple, ready, start, end, raffle.candidateCount]);
  const advance = (direction: number) => {
    if (!ready) return;
    setAutomatic(false);
    if (direction > 0) {
      const next = end < raffle.candidateCount ? end : 0;
      previousPages.current.set(next, start);
      setCursor({ offset: next, before: false });
    } else {
      const previous = previousPages.current.get(start);
      setCursor(previous !== undefined ? { offset: previous, before: false } : { offset: start || raffle.candidateCount, before: true });
    }
  };
  return <section className="raffle-participants" aria-label="참여자 명단">
    <div ref={area} className="raffle-roster-area">
      <ul style={{ "--roster-name-gap": nameGap + "px", "--roster-row-height": rowHeight + "px", "--roster-font-size": fontSize + "px" } as CSSProperties} aria-label="참여자 이름" onKeyDown={() => setAutomatic(false)}>
        {people.map((person, index) => <li key={person.key} style={{ width: widths[index] }}>
          <button className="raffle-participant-button" aria-label={person.name + " 채팅 열기"} title={person.name} onClick={() => { setAutomatic(false); openViewerChat(person); }}><ParticipantName participant={person} /></button>
        </li>)}
      </ul>
      {!people.length && <div className="raffle-roster-empty" role="status">{error ? <><p>{error}</p><button className="text-button" onClick={() => setRetry(value => value + 1)}>다시 불러오기</button></> : raffle.candidateCount ? "명단을 불러오고 있어요" : <><Icon name="viewers" size={36} /><p>{raffle.config.entryMode === "keyword" ? raffle.config.keyword + "로 참여하세요" : "채팅으로 참여하세요"}</p></>}</div>}
    </div>
    {multiple && <div className="raffle-roster-controls" role="group" aria-label="참여자 명단 넘기기">
      <button type="button" className="icon-button" aria-label="이전 참여자 명단" title="이전 명단" disabled={!ready} onClick={() => advance(-1)}><Icon name="arrow" className="roster-previous" size={18} /></button>
      <button type="button" className="icon-button" aria-label={automatic ? "명단 자동 넘김 끄기" : "명단 자동 넘김 켜기"} title={automatic ? "자동 넘김 켜짐" : "자동 넘김 꺼짐"} aria-pressed={automatic} onClick={() => setAutomatic(value => !value)}><Icon name={automatic ? "stop" : "play"} size={16} /></button>
      <button type="button" className="icon-button" aria-label="다음 참여자 명단" title="다음 명단" disabled={!ready} onClick={() => advance(1)}><Icon name="arrow" size={18} /></button>
    </div>}
  </section>;
}
