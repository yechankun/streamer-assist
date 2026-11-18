import { useLayoutEffect, useRef } from "react";
import { useTextScale } from "./text-size";
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
  const textScale = useTextScale();
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (active && !element.open) { cancelScreenTransition(); element.showModal(); }
    else if (!active && element.open) element.close();
    return () => { if (element.open) element.close(); };
  }, [active]);
  const identity = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const group = identity.current;
    const label = group?.querySelector<HTMLElement>(".participant-display-name");
    if (!group || !label || !active) return;
    // Measure the rendered name, including the current font, badges and character layout.
    const fit = () => {
      if (!group.clientWidth) return;
      const preferred = parseFloat(getComputedStyle(group).fontSize);
      const fits = (size: number) => {
        label.style.fontSize = size + "px";
        return label.offsetHeight <= Math.ceil(size * 1.3 * 3);
      };
      if (fits(preferred)) return;
      let low = Math.min(16, preferred), high = Math.floor(preferred);
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (fits(mid)) low = mid; else high = mid - 1;
      }
      label.style.fontSize = low + "px";
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(group);
    return () => observer.disconnect();
  }, [active, characterEnabled, draw.winner.name, textScale]);
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
    <div className="winner-identity" ref={identity}><ParticipantName participant={draw.winner} /></div>
    <ChatMessages {...chat} active={active} label="당첨자 채팅" controls={<ChatSpeechButton channel={"winner:" + draw.id} active={active} messages={chat.messages} messageCount={chat.messageCount} />} />
    </div></div>
    </div>
  </dialog>;
}
