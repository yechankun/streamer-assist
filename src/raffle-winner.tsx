import { useLayoutEffect, useRef } from "react";
import { Icon } from "./icons";
import { ParticipantName } from "./participant-name";
import type { RaffleDraw, WinnerChat } from "./audience-types";
import { WinnerCelebration } from "./winner-celebration";
import { ChatMessages } from "./viewer-chat";
import { ChatSpeechButton } from "./chat-speech";
import { CharacterToggle, WinnerCharacter } from "./winner-character";
import { cancelScreenTransition } from "./presentation";
import "./raffle-winner.css";

export function RaffleWinner({ draw, chat, active, busy, characterEnabled, onCharacterChange, onClose }: {
  draw: RaffleDraw; chat: WinnerChat; active: boolean; busy: boolean; characterEnabled: boolean; onCharacterChange: (enabled: boolean) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (active && !element.open) { cancelScreenTransition(); element.showModal(); }
    else if (!active && element.open) element.close();
    return () => { if (element.open) element.close(); };
  }, [active]);
  return <dialog ref={dialog} className="raffle-winner-dialog" aria-labelledby="raffle-winner-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <WinnerCelebration id={draw.id} enabled={active} />
    <div className={"winner-panel" + (characterEnabled ? " winner-character-mode" : "")}>
    <header className="winner-heading">
      <h2 id="raffle-winner-title">당첨을 축하합니다!</h2>
      <div className="winner-heading-actions"><CharacterToggle enabled={characterEnabled} disabled={busy} onChange={onCharacterChange} />
      <button className="secondary raffle-winner-close" type="button" autoFocus disabled={busy} onClick={onClose}><Icon name="close" size={16} /> 닫기</button></div>
    </header>
    <div className="winner-conversation">
    {characterEnabled && <WinnerCharacter key="character" seed={draw.id} messageCount={chat.messageCount} active={active} />}
    <div className="winner-dialogue" key="dialogue">
    <div className="winner-identity"><ParticipantName participant={draw.winner} /></div>
    <ChatMessages {...chat} active={active} label="당첨자 채팅" controls={<ChatSpeechButton channel={"winner:" + draw.id} active={active} messages={chat.messages} messageCount={chat.messageCount} />} />
    </div></div>
    </div>
  </dialog>;
}
