import type { HistoryDay } from "./timeline-types";
export type HistoryZoom = "day" | "week" | "month";
export function groupDays(days: HistoryDay[], zoom: HistoryZoom) {
  const groups = new Map<string, { key: string; label: string; dates: HistoryDay[] }>();
  for (const day of days) {
    let key = day.date, label = day.date;
    if (zoom === "month") { key = day.date.slice(0,7); label = key; }
    if (zoom === "week") {
      const date = new Date(day.date + "T12:00:00Z");
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      key = date.toISOString().slice(0,10);
      const end = new Date(date); end.setUTCDate(end.getUTCDate()+6);
      label = key.slice(5) + " ~ " + end.toISOString().slice(5,10);
    }
    const group = groups.get(key) || { key, label, dates: [] };
    group.dates.push(day); groups.set(key,group);
  }
  return [...groups.values()].sort((a,b)=>b.key.localeCompare(a.key));
}
export function bytesLabel(bytes: number) {
  if (bytes < 1024) return bytes.toLocaleString() + " B";
  if (bytes < 1048576) return (bytes/1024).toFixed(1) + " KiB";
  return (bytes/1048576).toFixed(2) + " MiB";
}
