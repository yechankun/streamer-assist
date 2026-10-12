import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { ParticipantName } from "./participant-name";
import type { RaffleDraw, WinnerChat, WinnerChatMessage } from "./audience-types";
import { WinnerCelebration } from "./winner-celebration";
import "./raffle-winner.css";

function ChatMessage({ message }: { message: WinnerChatMessage }) {
  return <><time dateTime={new Date(message.timestamp).toISOString()}>{new Date(message.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</time><p>{message.text}</p></>;
}

export function RaffleWinner({ draw, chat, active, busy, onClose }: {
  draw: RaffleDraw; chat: WinnerChat; active: boolean; busy: boolean; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), list = useRef<HTMLOListElement>(null);
  const followLatest = useRef(true), [following, setFollowing] = useState(true);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (active && !element.open) element.showModal();
    else if (!active && element.open) element.close();
    return () => { if (element.open) element.close(); };
  }, [active]);
  useEffect(() => { if (followLatest.current && list.current) list.current.scrollTop = list.current.scrollHeight; }, [chat.messageCount, active]);
  return <dialog ref={dialog} className="raffle-winner-dialog" aria-labelledby="raffle-winner-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <WinnerCelebration id={draw.id} enabled={active} />
    <div className="winner-panel">
    <header className="winner-heading">
      <div><span className="winner-kicker"><Icon name="sparkles" size={12} /> WINNER SELECTED</span><h2 id="raffle-winner-title">당첨을 축하합니다!</h2></div>
      <button className="secondary raffle-winner-close" type="button" autoFocus disabled={busy} onClick={onClose}><Icon name="close" size={16} /> 닫기</button>
    </header>
    <div className="winner-identity"><ParticipantName participant={draw.winner} /></div>
    {(chat.lastMessage || chat.messages.length > 0) && <div className="winner-chat-layout">
      <ol ref={list} className="winner-chat-messages" role="log" aria-label="당첨자 채팅" aria-live="polite" aria-relevant="additions" onScroll={() => { const e = list.current; if (!e) return; const next = e.scrollHeight - e.scrollTop - e.clientHeight < 32; followLatest.current = next; setFollowing(next); }}>
        {chat.lastMessage && <li className="winner-chat-before" key="before-draw"><ChatMessage message={chat.lastMessage} /></li>}
        {chat.messages.map((message, index) => <li className="winner-chat-current" key={"live:" + (message.id || message.receivedAt + ":" + index)}><ChatMessage message={message} /></li>)}
      </ol>
      {!following && <button className="text-button winner-chat-follow" onClick={() => { followLatest.current = true; setFollowing(true); if (list.current) list.current.scrollTop = list.current.scrollHeight; }}>최신 채팅으로 <Icon name="arrow" size={14} /></button>}
    </div>}
    </div>
  </dialog>;
}
