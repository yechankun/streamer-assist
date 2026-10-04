export function shortcutFromKey(event: KeyboardEvent): string | null {
  if (event.repeat || ["Control", "Alt", "Shift", "Meta"].includes(event.key))
    return null;
  const names: Record<string, string> = {
    Space: "Space",
    Tab: "Tab",
    Enter: "Enter",
    Backspace: "Backspace",
    Delete: "Delete",
    Insert: "Insert",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Semicolon: ";",
    Quote: "'",
    Backquote: String.fromCharCode(96),
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: String.fromCharCode(92),
    Minus: "-",
    Equal: "=",
    NumpadAdd: "numadd",
    NumpadSubtract: "numsub",
    NumpadMultiply: "nummult",
    NumpadDivide: "numdiv",
    NumpadDecimal: "numdec",
    NumpadEnter: "Enter",
  };
  let key = names[event.code];
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
  else if (/^Numpad[0-9]$/.test(event.code)) key = "num" + event.code.slice(6);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)) key = event.code;
  if (!key) throw new Error("지원하지 않는 키입니다. 다른 키를 눌러 주세요.");
  if (!(
    event.ctrlKey ||
    event.altKey ||
    event.shiftKey ||
    event.metaKey ||
    /^F[0-9]+$/.test(key)
  ))
    throw new Error("Ctrl, Alt, Shift 또는 Windows 키를 함께 누르세요.");
  return [
    event.ctrlKey && "CommandOrControl",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    event.metaKey && "Super",
    key,
  ]
    .filter(Boolean)
    .join("+");
}
export function formatShortcut(value: string) {
  return value.replace("CommandOrControl", "Ctrl").replace("Super", "Win");
}
