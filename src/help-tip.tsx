import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { textScaleEvent } from "./text-size";

export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId(), button = useRef<HTMLButtonElement>(null), content = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const position = () => {
    if (!button.current || !content.current) return;
    const anchor = button.current.getBoundingClientRect(), box = content.current.getBoundingClientRect();
    content.current.style.left = Math.max(12, Math.min(anchor.right - box.width, innerWidth - box.width - 12)) + "px";
    content.current.style.top = (anchor.bottom + box.height + 8 <= innerHeight - 12
      ? anchor.bottom + 8 : Math.max(12, anchor.top - box.height - 8)) + "px";
  };
  useEffect(() => {
    if (!open) return;
    const close = () => { if (content.current?.matches(":popover-open")) content.current.hidePopover(); };
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !content.current?.contains(event.target)) close(); };
    window.addEventListener("resize", close);
    window.addEventListener(textScaleEvent, close);
    window.addEventListener("scroll", scroll, true);
    return () => { window.removeEventListener("resize", close); window.removeEventListener(textScaleEvent, close); window.removeEventListener("scroll", scroll, true); };
  }, [open]);
  return <>
    <button ref={button} type="button" className="help-tip" popoverTarget={id} aria-label={label} title={label} aria-expanded={open} aria-controls={id}><Icon name="info" size={14} /></button>
    <span ref={content} id={id} className="help-tip-content" popover="auto" role="note" aria-label={label}
      onToggle={event => { const shown = event.newState === "open"; setOpen(shown); if (shown) position(); }}>{children}</span>
  </>;
}
