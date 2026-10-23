import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { ParticipantName } from "./participant-name";
import { ChatSpeechButton } from "./chat-speech";
import { cancelScreenTransition } from "./presentation";
import type { Participant, WinnerChatMessage } from "./audience-types";
import "./viewer-chat.css";

const chatClock = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export type ViewerChatState = { id: string; participant: Pick<Participant, "key" | "platform" | "name" | "subscriber">; lastMessage: WinnerChatMessage | null; messages: WinnerChatMessage[]; messageCount: number };
export type ViewerChatTarget = { platform: Participant["platform"]; name: string; userId?: string; participantKey?: string; subscriber?: boolean };
export function openViewerChat(target: ViewerChatTarget) { window.dispatchEvent(new CustomEvent("assist:viewer-chat", { detail: target })); }

export function ChatMessages({ lastMessage, messages, messageCount, active, label, controls }: {
  lastMessage: WinnerChatMessage | null; messages: WinnerChatMessage[]; messageCount: number; active: boolean; label: string; controls?: ReactNode;
}) {
  const list = useRef<HTMLOListElement>(null), follow = useRef(true), [following, setFollowing] = useState(true);
  useEffect(() => { if (follow.current && list.current) list.current.scrollTop = list.current.scrollHeight; }, [messageCount, active]);
  const render = (message: WinnerChatMessage) => <><time dateTime={new Date(message.timestamp).toISOString()}>{chatClock.format(message.timestamp)}</time><p>{message.text}</p></>;
  return <div className={"winner-chat-layout" + (controls ? " has-controls" : "")}>
    {controls && <div className="winner-chat-toolbar">{controls}</div>}
    <ol ref={list} className="winner-chat-messages" role="log" aria-label={label} aria-live="polite" aria-relevant="additions" onScroll={() => { const e = list.current; if (e) { follow.current = e.scrollHeight - e.scrollTop - e.clientHeight < 32; setFollowing(follow.current); } }}>
      {lastMessage && <li className="winner-chat-before" key="before">{render(lastMessage)}</li>}
      {messages.map((message, index) => <li className="winner-chat-current" key={"live:" + (message.id || message.receivedAt + ":" + index)}>{render(message)}</li>)}
      {!lastMessage && !messages.length && <li className="viewer-chat-empty"><Icon name="message" size={28} /><p>새 채팅을 기다리고 있어요</p></li>}
    </ol>
    {!following && <button className="text-button winner-chat-follow" onClick={() => { follow.current = true; setFollowing(true); if (list.current) list.current.scrollTop = list.current.scrollHeight; }}>최신 채팅으로 <Icon name="arrow" size={14} /></button>}
  </div>;
}

export function ViewerChatDialog({ chat, onClose }: { chat: ViewerChatState; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => { const e = dialog.current; if (!e) return; cancelScreenTransition(); e.showModal(); return () => { if (e.open) e.close(); }; }, []);
  return <dialog ref={dialog} className="viewer-chat-dialog" aria-label={chat.participant.name + " 시청자 채팅"} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="viewer-chat-heading"><div className="viewer-chat-identity"><ParticipantName participant={chat.participant} /></div>
      <div className="viewer-chat-actions"><ChatSpeechButton channel={"viewer:" + chat.id} active messages={chat.messages} messageCount={chat.messageCount} />
      <button autoFocus className="icon-button" aria-label="시청자 채팅 닫기" title="닫기" onClick={onClose}><Icon name="close" size={22} /></button></div></header>
    <ChatMessages {...chat} active label="시청자 채팅" />
  </dialog>;
}
