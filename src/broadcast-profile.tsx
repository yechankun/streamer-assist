import { useEffect, useRef, useState } from "react";
import type { State } from "./main";
import { platforms, platformLabel, type Platform } from "./platforms";
import { Icon, PlatformIcon } from "./icons";
import "./broadcast-profile.css";

export function BroadcastAvatar({ platform, name, avatar }: { platform:Platform; name:string; avatar?:string }) {
  const [failed,setFailed] = useState(false);
  useEffect(()=>setFailed(false),[avatar]);
  return <span className={"broadcast-avatar " + platform}>
    {!failed && avatar?.startsWith("data:image/") ? <img src={avatar} alt="" onError={()=>setFailed(true)} /> : <span>{name.trim().slice(0,1) || <PlatformIcon platform={platform} size={19} />}</span>}
    <span className="broadcast-avatar-platform"><PlatformIcon platform={platform} size={12}/></span>
  </span>;
}
export function BroadcastProfile({ state, onSettings, hideWhenUnconnected }: {state:State;onSettings:()=>void;hideWhenUnconnected:boolean}) {
  const [open,setOpen] = useState(false), [busy,setBusy] = useState(false),[error,setError] = useState("");
  const menu = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const available = platforms.filter(platform=>state.auth.accounts[platform]?.connected);
  const preferred = state.settings.broadcastProfile;
  const selected = available.find(platform=>platform === preferred) || available.find(platform=>state.livePlatforms?.[platform]) || available[0];
  const signature = available.map(platform=>platform+":"+(state.auth.accounts[platform].channelId || state.auth.accounts[platform].name)).join("|");
  useEffect(()=>{if(signature) void window.assist?.call("broadcast-profiles").catch(()=>{});},[signature]);
  async function choose(platform:Platform|null) {
    if(busy) return;
    setBusy(true);setError("");
    try {
      const result = await window.assist?.call("broadcast-profile-set",{platform});
      if(!result?.ok) throw Error(result?.error || "대표 프로필을 저장하지 못했습니다.");
      menu.current?.hidePopover();trigger.current?.focus();
    } catch(cause) {setError(cause instanceof Error ? cause.message : "프로필을 변경하지 못했습니다.");}
    finally {setBusy(false);}
  }
  if (hideWhenUnconnected && !selected) return null;
  const account = selected ? state.auth.accounts[selected] : null;
  return <div className="broadcast-profile">
    <button ref={trigger} className="broadcast-profile-trigger" aria-label="대표 방송 프로필 선택" aria-haspopup="menu" aria-expanded={open}
      title={account ? account.name+" · 대표 방송 프로필 선택" : "방송 플랫폼 연결"}
      onClick={()=>{
        if(!available.length){onSettings();return;}
        const element=menu.current, button=trigger.current;if(!element || !button)return;
        element.togglePopover();
        const bounds=button.getBoundingClientRect();element.style.top=(bounds.bottom+8)+"px";
        element.style.left=Math.max(12,Math.min(bounds.right-element.offsetWidth,innerWidth-element.offsetWidth-12))+"px";
      }}>
      {selected && account ? <><BroadcastAvatar platform={selected} name={account.name} avatar={account.avatar}/><span className="broadcast-profile-name"><strong>{account.name || platformLabel(selected)}</strong><small>{platformLabel(selected)} · {state.livePlatforms?.[selected] ? "방송 중" : "연결됨"}</small></span></> : <><span className="broadcast-avatar"><Icon name="viewers" size={20}/></span><span>{state.demo ? "테스트 채널" : "방송 연결"}</span></>}
      <span className="profile-chevron" aria-hidden="true">⌄</span>
    </button>
    <div ref={menu} popover="auto" className="broadcast-profile-menu" role="menu" aria-label="대표 프로필"
      onToggle={()=>setOpen(!!menu.current?.matches(":popover-open"))}
      onKeyDown={event=>{
        if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;
        const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitemradio"]:not(:disabled)')];
        const current=buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next=event.key === "Home" ? 0 : event.key === "End" ? buttons.length-1 : (current+(event.key === "ArrowDown"?1:-1)+buttons.length)%buttons.length;
        event.preventDefault();buttons[next]?.focus();
      }}>
      <h2>대표 방송 프로필</h2>
      {available.map(platform=>{
        const value=state.auth.accounts[platform];
        return <button key={platform} type="button" role="menuitemradio" aria-checked={preferred === platform} disabled={busy} onClick={()=>void choose(platform)}>
          <BroadcastAvatar platform={platform} name={value.name} avatar={value.avatar}/><span><strong>{value.name || platformLabel(platform)}</strong><small>{platformLabel(platform)} · {state.livePlatforms?.[platform] ? "방송 중" : "방송 대기"}</small></span>
          {preferred === platform && <Icon name="check" size={17}/>}</button>;
      })}
      <button type="button" role="menuitemradio" className="profile-auto" aria-checked={!preferred} disabled={busy} onClick={()=>void choose(null)}>자동 선택{!preferred && <Icon name="check" size={16}/>}</button>
      {error && <p role="status">{error}</p>}
      <button className="profile-manage" onClick={()=>{menu.current?.hidePopover();onSettings();}}><Icon name="settings" size={15}/>연결 관리</button>
    </div>
  </div>;
}
