import { useEffect, useId, useRef, useState } from "react";
import appearance from "../resources/appearance.json";
import { Icon } from "./icons";

export function TextSizeControl({ value, disabled, onCommit }: { value: number; disabled: boolean; onCommit: (scale: number) => void }) {
  const id = useId(), dragging = useRef(false), committed = useRef(value);
  const [preview, setPreview] = useState(value);
  useEffect(() => { if (!disabled && !dragging.current) { committed.current = value; setPreview(value); } }, [value, disabled]);
  const commit = (scale: number) => { setPreview(scale); if (scale !== committed.current) { committed.current = scale; onCommit(scale); } };
  return <div className="text-size-field"><label htmlFor={id}>글자 크기</label><div className="text-size-slider">
    <input id={id} type="range" aria-label="글자 크기" aria-valuetext={preview + "%"} min={appearance.minTextScale} max={appearance.maxTextScale} step={appearance.textScaleStep}
      value={preview} disabled={disabled} onInput={event => setPreview(Number(event.currentTarget.value))} onChange={event => setPreview(Number(event.currentTarget.value))}
      onPointerDown={event => { dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerUp={event => { dragging.current = false; commit(Number(event.currentTarget.value)); }}
      onPointerCancel={() => { dragging.current = false; setPreview(value); }}
      onKeyUp={event => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) commit(Number(event.currentTarget.value)); }}
      onBlur={event => { dragging.current = false; commit(Number(event.currentTarget.value)); }} />
    <output htmlFor={id} aria-live="polite">{preview}%</output>
    <button type="button" className="icon-button" aria-label="기본 글자 크기로 복원" title="기본 글자 크기" disabled={disabled || preview === appearance.defaultTextScale}
      onClick={() => commit(appearance.defaultTextScale)}><Icon name="restore" size={16} /></button>
  </div></div>;
}
