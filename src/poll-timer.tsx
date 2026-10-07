import { useId } from "react";
import "./poll-timer.css";

export function pollTimerSeconds(enabled: boolean, minutes: string, seconds: string) {
  if (!enabled) return null;
  if (!/^\d+$/.test(minutes) || !/^\d+$/.test(seconds)) return NaN;
  const mins = Number(minutes), secs = Number(seconds), total = mins * 60 + secs;
  return Number.isSafeInteger(mins) && secs <= 59 && total >= 1 && total <= 86400 ? total : NaN;
}

export function PollTimerInput({ enabled, minutes, seconds, onEnabled, onMinutes, onSeconds, disabled = false }: {
  enabled: boolean; minutes: string; seconds: string;
  onEnabled: (enabled: boolean) => void;
  onMinutes: (minutes: string) => void;
  onSeconds: (seconds: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const valid = !Number.isNaN(pollTimerSeconds(enabled, minutes, seconds));
  return (
    <div className="poll-timer-settings">
      <label className="check-label">
        <input type="checkbox" checked={enabled} disabled={disabled} onChange={event => onEnabled(event.target.checked)} />
        자동 종료 타이머
      </label>
      {enabled && <>
        <div className="poll-timer-fields" role="group" aria-label="자동 종료 시간">
          <label className="poll-timer-field">
            <input aria-label="자동 종료 분" type="number" min={0} max={1440} step={1} value={minutes} disabled={disabled}
              aria-invalid={!valid} aria-describedby={!valid ? id : undefined} onChange={event => onMinutes(event.target.value)} />
            <span>분</span>
          </label>
          <label className="poll-timer-field">
            <input aria-label="자동 종료 초" type="number" min={0} max={59} step={1} value={seconds} disabled={disabled}
              aria-invalid={!valid} aria-describedby={!valid ? id : undefined} onChange={event => onSeconds(event.target.value)} />
            <span>초</span>
          </label>
        </div>
        {!valid && <p id={id} className="poll-timer-error" role="status">1초~24시간으로 설정하세요. 초는 0~59입니다.</p>}
      </>}
    </div>
  );
}
