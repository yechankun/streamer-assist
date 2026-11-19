import { useLayoutEffect, useId, useRef, useState } from "react";
import { Icon, PlatformIcon } from "./icons";
import { platformLabel, supportsDonation, type Platform, type ParticipationPlatform } from "./platforms";
import { PollTimerInput, pollTimerSeconds } from "./poll-timer";
import "./live-stage.css";

export type LiveOptionsValue = {
  active?:boolean;
  id:string; settingsRevision?:number; title?:string; question?:string; options?:string[]; counts?:number[]; youtubeCounts?:number[]|null;
  platforms?:ParticipationPlatform[]; mode?:string; chatPrefix?:string; endsAt?:number|null;
  config?:{platforms:ParticipationPlatform[];entryMode:"any"|"keyword";keyword:string;subscribersOnly:boolean;excludeWinners:boolean};
  donation?:{currency:string;minimumMicros:number;plural:boolean};
};
function micros(text:string) {
  if(!/^\d+(?:\.\d{1,6})?$/.test(text))return NaN;
  const [whole,fraction=""]=text.split(".");
  const value=Number(BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,"0")));
  return Number.isSafeInteger(value)?value:NaN;
}
export function LiveOptionsDialog({kind,value,available,livePlatforms,onClose}: {
  kind:"raffle"|"poll"|"donation";value:LiveOptionsValue;available:Platform[];livePlatforms:Partial<Record<Platform,boolean>>;onClose:()=>void;
}) {
  const dialog=useRef<HTMLDialogElement>(null), heading=useId();
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const [title,setTitle]=useState(value.title||value.question||"");
  const [options,setOptions]=useState(()=>value.options?.map((text,index)=>({key:index,source:index as number|null,text}))||[]);
  const nextKey=useRef(options.length);
  const [targets,setTargets]=useState<ParticipationPlatform[]>(()=>[...(value.config?.platforms||value.platforms||[])]);
  const [entryMode,setEntryMode]=useState(value.config?.entryMode||"any"),[keyword,setKeyword]=useState(value.config?.keyword||"!참여");
  const [subscribersOnly,setSubscribersOnly]=useState(value.config?.subscribersOnly||false),[excludeWinners,setExcludeWinners]=useState(value.config?.excludeWinners??true);
  const [prefix,setPrefix]=useState(value.chatPrefix??"!투표"),[currency,setCurrency]=useState(value.donation?.currency||"KRW");
  const [price,setPrice]=useState(String((value.donation?.minimumMicros||1000000000)/1000000)),[plural,setPlural]=useState(value.donation?.plural||false);
  const remaining=useRef(Math.max(1,Math.ceil(((value.endsAt||Date.now()+60000)-Date.now())/1000)));
  const [timerEnabled,setTimerEnabled]=useState(!!value.endsAt),[minutes,setMinutes]=useState(String(Math.floor(remaining.current/60))),[seconds,setSeconds]=useState(String(remaining.current%60));
  const baseline=useRef({revision:value.settingsRevision||0,timerEnabled:!!value.endsAt,minutes:String(Math.floor(remaining.current/60)),seconds:String(remaining.current%60)});
  const conflict=(value.settingsRevision||0)!==baseline.current.revision;
  const native=value.mode==="native";
  const timerSeconds=pollTimerSeconds(timerEnabled,minutes,seconds);
  const timerChanged=timerEnabled!==baseline.current.timerEnabled || minutes!==baseline.current.minutes || seconds!==baseline.current.seconds;
  const valid=value.active!==false && targets.length>0 && !Number.isNaN(timerSeconds) && title.length<=100 && (kind==="raffle" ? entryMode==="any"||!!keyword.trim() :
    !!title.trim() && options.length>=2 && options.length<=4 && options.every(option=>!!option.text.trim()) && new Set(options.map(option=>option.text.trim())).size===options.length) &&
    (kind!=="donation" || micros(price)>=1 && micros(price)<=1e15);
  useLayoutEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    dialog.current?.showModal();
    return()=>{dialog.current?.close();if(previous?.isConnected)previous.focus();};
  },[]);
  async function apply() {
    if(!valid || busy || conflict)return;
    setBusy(true);setError("");
    const payload={id:value.id,revision:baseline.current.revision,platforms:targets,
      ...(timerChanged?{timerSeconds}:{}),
      ...(kind==="raffle" ? {title,entryMode,keyword,subscribersOnly,excludeWinners} :
        {question:title,options:options.map(option=>option.text.trim()),optionIndices:options.map(option=>option.source),chatPrefix:prefix}),
      ...(kind==="donation"?{currency,minimumMicros:micros(price),plural}:{})};
    try {
      const reply=await window.assist?.call(kind+"-update",payload);
      if(!reply?.ok)throw Error(reply?.error||"설정을 변경하지 못했습니다.");
      onClose();
    }catch(cause){setError(cause instanceof Error?cause.message:"설정을 변경하지 못했습니다.");setBusy(false);}
  }
  return <dialog ref={dialog} className="live-options-dialog" aria-labelledby={heading} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
    <form onSubmit={event=>{event.preventDefault();void apply();}}>
      <header><div><span className="live-settings-eyebrow">진행 중 설정</span><h2 id={heading}>{kind==="raffle"?"시청자 추첨":kind==="donation"?"도네 투표":"숫자 투표"}</h2></div>
        <button type="button" className="icon-button" aria-label="실시간 설정 닫기" disabled={busy} onClick={onClose}><Icon name="close" size={20}/></button></header>
      <fieldset className="live-options-body" disabled={busy}>
        <label>{kind==="raffle"?"추첨 제목":"투표 질문"}<input aria-label="진행 중 제목" value={title} maxLength={100} disabled={native} onChange={event=>setTitle(event.target.value)}/></label>
        {kind==="raffle" ? <>
          <div className="live-option-group"><span>참여 방식</span><div className="segmented-buttons">
            <button type="button" className={entryMode==="any"?"selected":""} onClick={()=>setEntryMode("any")}>아무 채팅</button>
            <button type="button" className={entryMode==="keyword"?"selected":""} onClick={()=>setEntryMode("keyword")}>참여 키워드</button>
          </div>{entryMode==="keyword" && <input aria-label="진행 중 참여 키워드" value={keyword} maxLength={30} onChange={event=>setKeyword(event.target.value)}/>}</div>
          <div className="live-checks"><label className="check-label"><input type="checkbox" checked={subscribersOnly} onChange={event=>setSubscribersOnly(event.target.checked)}/>구독자·멤버십만 참여</label>
            <label className="check-label"><input type="checkbox" checked={excludeWinners} onChange={event=>setExcludeWinners(event.target.checked)}/>이미 뽑힌 참여자 제외</label></div>
        </> : <div className="live-option-group"><span>선택지</span>
          <ol className="live-choice-list">{options.map((option,index)=>{
            const votes=option.source===null?0:(value.counts?.[option.source]||0)+(value.youtubeCounts?.[option.source]||0);
            return <li key={option.key}><span>{index+1}</span><input aria-label={"진행 중 선택지 "+(index+1)} value={option.text} maxLength={50} disabled={native}
              onChange={event=>setOptions(options.map(row=>row.key===option.key?{...row,text:event.target.value}:row))}/>
              {votes>0 && <small>{votes.toLocaleString()}표</small>}
              {options.length>2 && <button type="button" className="icon-button" aria-label={"진행 중 선택지 "+(index+1)+" 삭제"} disabled={native||votes>0}
                title={votes>0?"표를 받은 선택지는 이름만 수정할 수 있습니다.":"선택지 삭제"} onClick={()=>setOptions(options.filter(row=>row.key!==option.key))}><Icon name="close" size={15}/></button>}</li>;
          })}</ol>
          {!native && options.length<4 && <button type="button" className="secondary live-add-choice" onClick={()=>setOptions([...options,{key:nextKey.current++,source:null,text:""}])}><Icon name="plus" size={15}/>선택지 추가</button>}
          {native && <p className="live-option-note">YouTube 기본 투표의 질문·선택지는 진행 중 변경을 지원하지 않습니다.</p>}
        </div>}
        {(targets.includes("demo") || available.length > 0) && <div className="live-option-group"><span>참여 플랫폼</span><div className="platform-picker">
          {targets.includes("demo")?<span className="tag">테스트 채팅</span>:available.map(platform=>{
            const selected=targets.includes(platform),unsupported=kind==="donation"&&(!supportsDonation(platform)||platform==="chzzk"&&currency!=="KRW");
            return <button type="button" key={platform} className={"audience-platform "+platform+(selected?" selected":"")} aria-pressed={selected}
              disabled={(!selected&&(!livePlatforms[platform]||unsupported)) || native&&platform==="youtube"}
              onClick={()=>setTargets(selected?targets.filter(value=>value!==platform):[...targets,platform])}><PlatformIcon platform={platform} size={18}/>{platformLabel(platform)}{selected&&<Icon name="check" size={13}/>}</button>;
          })}
        </div></div>}
        {kind!=="raffle" && <label>참여 명령 접두어<input aria-label="진행 중 투표 접두어" value={prefix} maxLength={12} onChange={event=>setPrefix(event.target.value)}/></label>}
        {kind==="donation" && <>
          <div className="live-price-fields"><label>통화<select aria-label="진행 중 도네 통화" value={currency} onChange={event=>{setCurrency(event.target.value);if(event.target.value!=="KRW")setTargets(targets.filter(platform=>platform!=="chzzk"));}}>{["KRW","USD","JPY","EUR","GBP","CAD","AUD"].map(currency=><option key={currency}>{currency}</option>)}</select></label>
            <label>{plural?"1표당 금액":"최소 후원 금액"}<input aria-label="진행 중 도네 금액" type="number" min="0.000001" max="1000000000" step="any" value={price} onChange={event=>setPrice(event.target.value)}/></label></div>
          <div className="live-option-group"><span>투표수 계산</span><div className="segmented-buttons"><button type="button" className={!plural?"selected":""} onClick={()=>setPlural(false)}>1인 1표</button><button type="button" className={plural?"selected":""} onClick={()=>setPlural(true)}>금액 배수</button></div></div>
        </>}
        <div className="live-option-group"><span>자동 종료 · 시간을 바꾸면 지금부터 적용</span><PollTimerInput enabled={timerEnabled} minutes={minutes} seconds={seconds} onEnabled={setTimerEnabled} onMinutes={setMinutes} onSeconds={setSeconds}/></div>
        <p className="live-option-note">기존 참여자와 받은 표는 유지합니다. 새 규칙은 적용 후 수신한 메시지부터 사용합니다.</p>
      </fieldset>
      <footer>{(error||conflict&&!busy||value.active===false)&&<p role="alert">{error||(value.active===false?"진행이 종료되었습니다. 닫고 결과를 확인하세요.":"다른 창에서 설정이 변경됐습니다. 닫았다가 다시 열어 주세요.")}</p>}
        <button type="button" className="secondary" disabled={busy} onClick={onClose}>취소</button><button type="submit" className="primary" disabled={busy||!valid||conflict}>{busy?"적용 중…":"적용"}</button></footer>
    </form>
  </dialog>;
}
