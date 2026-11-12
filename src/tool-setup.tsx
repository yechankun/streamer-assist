import type { ReactNode } from "react";
import { Icon } from "./icons";
import "./tool-setup.css";

export function ToolSettings({ label, summary, children, className = "" }: {
  label: string; summary: string; children: ReactNode; className?: string;
}) {
  return (
    <details className={"tool-settings " + className}>
      <summary>
        <span>{label}</span>
        <span className="tool-settings-summary">{summary}</span>
        <span className="tool-settings-arrow" aria-hidden="true"><Icon name="arrow" size={15} /></span>
      </summary>
      <div className="tool-settings-body">{children}</div>
    </details>
  );
}
