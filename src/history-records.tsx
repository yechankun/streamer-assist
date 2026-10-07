import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, PlatformIcon } from "./icons";
import { useTextScale } from "./text-size";
import type { HistoryCursor, HistoryRecordsResult, TimelineEvent } from "./timeline-types";

export type HistoryFilters = {
  sessionId?: string; dates: string[]; platform: string; kind: string; text: string;
  from: number; to?: number; participantKey?: string;
};
const batchSize = 100;
const identity = (event: TimelineEvent) => event.sessionId + ":" + event.seq;
const clockLabel = (timestamp: number) => {
  const date = new Date(timestamp);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(value => String(value).padStart(2, "0")).join(":");
};

export function HistoryRecords({ filters, refresh, live, disabled, onParticipant }: {
  filters: HistoryFilters; refresh: number; live: boolean; disabled: boolean; onParticipant: (key: string) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null), more = useRef<(() => void) | null>(null);
  const liveRef = useRef(live); liveRef.current = live;
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false), [hasMore, setHasMore] = useState(true), [error, setError] = useState("");
  const [position, setPosition] = useState({ top: 0, height: 0 });
  const rowHeight = Math.round(50 * Math.max(1, useTextScale()) * 100) / 100;
  const previousRowHeight = useRef(rowHeight);
  useLayoutEffect(() => {
    const node = viewport.current;
    if (node && previousRowHeight.current !== rowHeight) {
      node.scrollTop = node.scrollTop / previousRowHeight.current * rowHeight;
      setPosition({ top: node.scrollTop, height: node.clientHeight });
    }
    previousRowHeight.current = rowHeight;
  }, [rowHeight]);
  useLayoutEffect(() => {
    const node = viewport.current; if (!node) return;
    const measure = () => setPosition({ top: node.scrollTop, height: node.clientHeight });
    measure(); const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let disposed = false, busy = false, records: TimelineEvent[] = [], cursor: HistoryCursor | null = null, remaining = true;
    setEvents([]); setError(""); setHasMore(true); setLoading(!disabled);
    if (viewport.current) viewport.current.scrollTop = 0;
    setPosition(previous => ({ ...previous, top: 0 }));
    if (disabled) return;
    const load = async (append: boolean, headRefresh = false) => {
      if (disposed || busy || (append && (!remaining || !cursor))) return;
      busy = true; setLoading(true); setError("");
      try {
        const reply = await window.assist?.call("timeline-history", { ...filters, limit: batchSize, before: append ? cursor : undefined });
        if (disposed) return;
        if (!reply?.ok) throw Error(reply?.error || "기록을 불러오지 못했습니다.");
        // A reader who moved down while the latest batch was loading keeps their place.
        if (headRefresh && viewport.current && viewport.current.scrollTop > 0) return;
        const data = reply.data as HistoryRecordsResult;
        const seen = new Set(append ? records.map(identity) : []);
        const next = data.events.filter(event => { const key = identity(event); if (seen.has(key)) return false; seen.add(key); return true; });
        records = append ? [...records, ...next] : next;
        cursor = data.nextCursor; remaining = data.hasMore;
        setEvents(records); setHasMore(remaining);
      } catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : "기록 조회 실패"); }
      finally { busy = false; if (!disposed) setLoading(false); }
    };
    const loadMore = () => { void load(records.length > 0); };
    more.current = loadMore;
    const debounce = setTimeout(() => void load(false), 120);
    const timer = setInterval(() => {
      const node = viewport.current;
      if (liveRef.current && node && node.clientHeight > 0 && node.scrollTop === 0) void load(false, true);
    }, 5000);
    return () => { disposed = true; clearTimeout(debounce); clearInterval(timer); if (more.current === loadMore) more.current = null; };
  }, [filters, refresh, disabled]);
  const nearEnd = () => {
    const node = viewport.current;
    if (node && events.length && hasMore && !loading && !error && node.scrollHeight - node.scrollTop - node.clientHeight < rowHeight * 3) more.current?.();
  };
  useEffect(nearEnd, [events.length, position.height, rowHeight, hasMore, loading, error]);
  const start = Math.max(0, Math.min(events.length, Math.floor(position.top / rowHeight) - 3));
  const end = Math.min(events.length, Math.ceil((position.top + position.height) / rowHeight) + 3);
  return <>
    {error && <div className="history-record-error" role="alert"><span>{error}</span><button className="text-button" disabled={loading || disabled} onClick={() => more.current?.()}>다시 시도</button></div>}
    <div ref={viewport} className="history-records" role="feed" aria-label="채팅 기록 목록" aria-busy={loading || disabled} tabIndex={0}
      data-loaded-count={events.length} data-has-more={hasMore} onScroll={event => { setPosition({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight }); nearEnd(); }}>
      <div aria-hidden="true" style={{ height: start * rowHeight, flex: "none" }} />
      {events.slice(start, end).map((event, index) => <article key={identity(event)} className={"telemetry-chat-row history-chat-row " + event.type}
        style={{ height: rowHeight }} aria-posinset={start + index + 1} aria-setsize={hasMore ? -1 : events.length} data-record-id={event.id}>
        <time title={event.sessionTitle + " · 방송 경과 " + Math.floor(event.at / 1000) + "초"}><span>{event.date?.slice(2)}</span>{clockLabel(event.timestamp)}</time>
        <span>{event.platform === "demo" ? <Icon name="message" size={15} /> : <PlatformIcon platform={event.platform} size={15} />}</span>
        <div className="chat-author"><button title={"분석용 ID: " + (event.participantKey || "익명")} onClick={() => onParticipant(event.participantKey || "")}>{event.displayName || "시청자"}</button>{event.subscriber && <small>구독/멤버</small>}</div>
        <div className="chat-body"><span title={event.text}>{event.text}</span>{event.type === "donation" && <strong>{((event.amountMicros || 0) / 1000000).toLocaleString()} {event.currency}</strong>}</div>
      </article>)}
      <div aria-hidden="true" style={{ height: (events.length - end) * rowHeight, flex: "none" }} />
      {!events.length && <div className="telemetry-empty"><Icon name="message" size={24} /><strong>{loading ? "기록 불러오는 중" : error ? "기록을 불러오지 못했습니다" : "조건에 맞는 기록이 없습니다"}</strong><span>전체 날짜에서 조회합니다. 날짜·용량 관리에서 범위를 선택할 수 있습니다.</span></div>}
      {!!events.length && <div className="history-load-status" role="status">{loading ? "기록 불러오는 중…" : !hasMore ? "모든 기록을 불러왔습니다." : null}</div>}
    </div>
  </>;
}
