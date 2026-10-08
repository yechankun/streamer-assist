import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTabState } from "./workspace-state";
import { usePageActive } from "./activity";
import { Icon } from "./icons";
import { platformLabel, type Platform } from "./platforms";
import type { HistoryCalendar, TimelineSession } from "./timeline-types";
import { HistoryRecords } from "./history-records";
import { groupDays, bytesLabel, type HistoryZoom } from "./history-utils";
import { currentTextScale, textScaleEvent } from "./text-size";
const empty: HistoryCalendar = { days: [], totalBytes: 0, selectedBytes: 0, sharedBytes: 0, timeZone: "", token: "", selectedDates: [] };
function useCapacity(ref: React.RefObject<HTMLDivElement | null>, height: number, mode: string) {
  const [rows,setRows] = useState(1);
  useLayoutEffect(()=>{
    const node=ref.current;
    if(!node)return;
    const measure=()=>{const scale=Math.max(1,currentTextScale());setRows(Math.max(1,Math.floor((node.clientHeight-38*scale)/(height*scale))));};
    measure(); const observer=new ResizeObserver(measure); observer.observe(node); window.addEventListener(textScaleEvent,measure);
    return()=>{observer.disconnect();window.removeEventListener(textScaleEvent,measure);};
  },[ref,height,mode]);
  return rows;
}
export function HistoryWorkspace({ sessions, current, initialText, initialParticipant, onDeleted }: {
  sessions: TimelineSession[]; current: TimelineSession | null; initialText: string; initialParticipant: string; onDeleted: ()=>void;
}) {
  const pageActive = usePageActive();
  const [mode,setMode]=useTabState<"records"|"calendar">("history.mode", "records");
  const [scope,setScope]=useTabState("history.scope", "");
  const [zoom,setZoom]=useTabState<HistoryZoom>("history.zoom", "day");
  const [dates,setDates]=useTabState<string[]>("history.dates", []);
  const [calendar,setCalendar]=useState(empty);
  const [calendarPage,setCalendarPage]=useTabState("history.calendarPage", 0);
  const [from,setFrom]=useTabState("history.from", ""),[to,setTo]=useTabState("history.to", "");
  const [elapsedFrom,setElapsedFrom]=useTabState("history.elapsedFrom", ""),[elapsedTo,setElapsedTo]=useTabState("history.elapsedTo", "");
  const [query,setQuery]=useTabState("history.query", initialText),[participant,setParticipant]=useTabState("history.participant", initialParticipant);
  const [platform,setPlatform]=useTabState("history.platform", ""),[kind,setKind]=useTabState("history.kind", "all");
  const [loading,setLoading]=useState(false),[deleting,setDeleting]=useState(false),[error,setError]=useState(""),[refresh,setRefresh]=useState(0);
  const area=useRef<HTMLDivElement>(null), generation=useRef(0), anchor=useRef<string|null>(null);
  const rows=useCapacity(area,65,mode+zoom);
  const [columns,setColumns]=useState(7);
  useLayoutEffect(()=>{
    const node=area.current;if(!node)return;
    const measure=()=>{const grid=node.querySelector(".history-grid");if(grid)setColumns(getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length);};
    measure();const observer=new ResizeObserver(measure);observer.observe(node);window.addEventListener(textScaleEvent,measure);
    return()=>{observer.disconnect();window.removeEventListener(textScaleEvent,measure);};
  },[mode,zoom]);
  const groups=useMemo(()=>groupDays(calendar.days,zoom),[calendar.days,zoom]);
  const perPage=rows*columns, pages=Math.max(1,Math.ceil(groups.length/perPage)), visiblePage=Math.min(calendarPage,pages-1);
  const selected=new Set(dates);
  const recordFilters=useMemo(()=>({sessionId:scope||undefined,dates,platform,kind,text:query,from:scope&&elapsedFrom?Number(elapsedFrom)*60000:0,to:scope&&elapsedTo?Number(elapsedTo)*60000:undefined,participantKey:participant||undefined}),[scope,dates,platform,kind,query,elapsedFrom,elapsedTo,participant]);
  useEffect(()=>{setCalendarPage(0);anchor.current=null;},[zoom,scope]);
  useEffect(()=>{
    if(!pageActive)return;
    let disposed=false;
    const update=async()=>{
      if(!window.assist || deleting)return;
      const id=++generation.current;
      setLoading(true);
      try {
        const catalog=await window.assist.call("timeline-calendar",{sessionId:scope||undefined,dates});
        if(disposed || id!==generation.current)return;
        if(!catalog.ok)throw Error(catalog.error);
        setCalendar(catalog.data as HistoryCalendar);
        setError("");
      }catch(err){if(!disposed && id===generation.current)setError(err instanceof Error?err.message:"기록 조회 실패");}
      finally{if(!disposed && id===generation.current)setLoading(false);}
    };
    const debounce=setTimeout(()=>void update(),120);
    const timer=current?setInterval(()=>void update(),5000):undefined;
    return()=>{disposed=true;clearTimeout(debounce);clearInterval(timer);};
  },[pageActive,scope,dates,mode,refresh,current?.id,sessions.length,deleting]);
  const allDates=calendar.days.filter(d=>!d.protected).map(d=>d.date);
  const selectedDays=calendar.days.filter(d=>selected.has(d.date));
  const protectedSelection=selectedDays.some(d=>d.protected);
  const previewReady=calendar.selectedDates.join(",")===dates.join(",");
  const toggle=(index:number,shift:boolean)=>{
    let target=[groups[index]];
    if(shift && anchor.current){
      const previous=groups.findIndex(g=>g.key===anchor.current);
      if(previous>=0)target=groups.slice(Math.min(index,previous),Math.max(index,previous)+1);
    }
    const enabled=target.flatMap(g=>g.dates.filter(d=>!d.protected).map(d=>d.date));
    setDates(previous=>{
      const next=new Set(previous), remove=enabled.length>0 && enabled.every(d=>next.has(d));
      for(const date of enabled)remove?next.delete(date):next.add(date);
      return [...next].sort();
    });
    anchor.current=groups[index].key;
  };
  const deleteSelected=async()=>{
    if(!window.assist || deleting)return;
    setDeleting(true);
    try{
      const result=await window.assist.call("timeline-delete-dates",{sessionId:scope||undefined,dates,token:calendar.token});
      if(!result.ok)throw Error(result.error);
      const data=result.data as {canceled?:boolean;freedBytes?:number};
      if(!data.canceled){setDates([]);onDeleted();}
      setRefresh(n=>n+1);setError("");
    }catch(err){setError(err instanceof Error?err.message:"삭제 실패");setRefresh(n=>n+1);}
    finally{setDeleting(false);}
  };
  return <section className="panel history-panel" aria-label="전체 날짜 방송 기록">
    <div className="history-toolbar">
      <div className="history-modes">
        <button className={mode==="records"?"selected":""} onClick={()=>setMode("records")}>채팅 기록</button>
        <button className={mode==="calendar"?"selected":""} onClick={()=>setMode("calendar")}>날짜·용량 관리</button>
      </div>
      <select aria-label="채팅 기록 방송 범위" value={scope} onChange={e=>{setScope(e.target.value);setDates([]);setElapsedFrom("");setElapsedTo("");}}>
        <option value="">전체 방송 · 전체 날짜</option>
        {[...(current?[current]:[]),...sessions].map(s=><option key={s.id} value={s.id}>{new Date(s.startedAt).toLocaleDateString()} · {s.title}</option>)}
      </select>
      {mode==="calendar" && <div className="history-zoom" role="group" aria-label="날짜 줌">
        {([["day","일별"],["week","주별"],["month","월별"]] as const).map(([id,name])=><button key={id} aria-pressed={zoom===id} onClick={()=>setZoom(id)}>{name}</button>)}
      </div>}
    </div>
    {mode==="records"?<div className="history-filters">
      <select aria-label="전체 기록 플랫폼" value={platform} onChange={e=>setPlatform(e.target.value)}>
        <option value="">모든 플랫폼</option>{["chzzk","youtube","twitch","demo"].map(p=><option key={p} value={p}>{p==="demo"?"테스트":platformLabel(p as Platform)}</option>)}
      </select>
      <select aria-label="전체 기록 유형" value={kind} onChange={e=>setKind(e.target.value)}>
        <option value="all">채팅 + 후원</option><option value="chat">채팅</option><option value="donation">후원</option>
      </select>
      <input aria-label="전체 기록 검색" value={query} onChange={e=>setQuery(e.target.value)} placeholder="채팅·닉네임 검색" maxLength={200}/>
      {scope && <label className="time-range">
        <input type="number" min="0" aria-label="기록 시작 분" value={elapsedFrom} onChange={e=>setElapsedFrom(e.target.value)} placeholder="시작"/>
        <span>~</span><input type="number" min="0" aria-label="기록 종료 분" value={elapsedTo} onChange={e=>setElapsedTo(e.target.value)} placeholder="종료"/><span>분</span>
      </label>}
      {participant && <button className="text-button" onClick={()=>setParticipant("")}>시청자 필터 해제</button>}
      <button className="text-button" onClick={()=>setMode("calendar")}>{dates.length?dates.length+"개 날짜 선택됨":"전체 날짜"}</button>
    </div>:<div className="history-range">
      <input type="date" aria-label="선택 시작 날짜" value={from} onChange={e=>setFrom(e.target.value)}/>
      <span>~</span><input type="date" aria-label="선택 종료 날짜" value={to} onChange={e=>setTo(e.target.value)}/>
      <button disabled={!from||!to||from>to} onClick={()=>setDates(allDates.filter(d=>d>=from&&d<=to))}>범위 선택</button>
      <button disabled={!allDates.length} onClick={()=>setDates(allDates)}>전체 선택</button>
      <small>Shift 범위 선택</small>
    </div>}
    {error && <div role="alert" className="telemetry-error" title={error}>{error}</div>}
    <div ref={area} className="history-area" aria-busy={loading||deleting}>
      {mode==="calendar"?<>
        <div className={"history-grid "+zoom}>
          {groups.slice(visiblePage*perPage,(visiblePage+1)*perPage).map((group,i)=>{
            const available=group.dates.filter(d=>!d.protected), count=available.filter(d=>selected.has(d.date)).length;
            const checked=count>0 && count===available.length, mixed=count>0&&!checked;
            const bytes=group.dates.reduce((n,d)=>n+d.bytes,0), chats=group.dates.reduce((n,d)=>n+d.chats,0);
            return <button key={group.key} className="history-date" role="checkbox" aria-checked={mixed?"mixed":checked} disabled={!available.length||deleting}
              data-date={group.key} onClick={e=>toggle(visiblePage*perPage+i,e.shiftKey)} title={group.dates.map(d=>d.date).join(", ")}>
              <span className="history-check">{checked?"✓":mixed?"−":""}</span>
              <span><strong>{group.label}</strong><small>{chats.toLocaleString()}개 채팅 · {bytesLabel(bytes)}{group.dates.some(d=>d.protected)?" · 기록 중 보호":""}</small></span>
            </button>;
          })}
        </div>
        {!groups.length && <div className="telemetry-empty"><Icon name="message" size={24}/><strong>저장된 날짜 기록이 없습니다</strong><span>방송 중 채팅을 수집하면 날짜별로 표시됩니다.</span></div>}
        <div className="telemetry-pagination">
          <button disabled={visiblePage===0} onClick={()=>setCalendarPage(n=>n-1)}>이전</button><span>{visiblePage+1} / {pages}</span><button disabled={visiblePage+1>=pages} onClick={()=>setCalendarPage(n=>n+1)}>다음</button>
        </div>
      </>:<HistoryRecords filters={recordFilters} refresh={refresh} live={!!current} disabled={deleting} onParticipant={setParticipant}/>}
    </div>
    <div className="history-selection">
      <div><strong>{dates.length?dates.length+"개 날짜 선택":"전체 날짜"}</strong><span>{dates.length?bytesLabel(calendar.selectedBytes):bytesLabel(calendar.totalBytes)} · 암호화 원본 파일</span>
        <small>{calendar.sharedBytes?"공유 파일 "+bytesLabel(calendar.sharedBytes)+" · 실제 확보량은 다를 수 있습니다.":"색인 제외 · "+(calendar.timeZone||"로컬 시각")}</small>
      </div>
      {!!dates.length&&<button className="secondary" disabled={deleting} onClick={()=>setDates([])}>선택 해제</button>}
      <button className="secondary history-delete" disabled={!dates.length||!previewReady||loading||deleting||protectedSelection} onClick={()=>void deleteSelected()}>{deleting?"정리 중…":"선택 날짜 삭제"}</button>
    </div>
  </section>;
}
