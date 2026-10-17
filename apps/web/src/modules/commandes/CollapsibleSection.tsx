import { useState } from "react";

interface Props {
  title: string;
  summary: React.ReactNode;
  defaultOpen?: boolean;
  compact?: boolean;
  children: React.ReactNode;
}

export default function CollapsibleSection({ title, summary, defaultOpen = false, compact = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`detail-block ${compact ? "detail-block-compact" : ""}`}>
      <button type="button" className={`collapsible-header ${compact ? "compact" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {compact ? (
          <span className="collapsible-title-col">
            <h4 style={{ margin: 0 }}>{title}</h4>
            {!open && <span className="collapsible-summary">{summary}</span>}
          </span>
        ) : (
          <span className="collapsible-title-row">
            <h4 style={{ margin: 0 }}>{title}</h4>
            {!open && <span className="collapsible-summary">{summary}</span>}
          </span>
        )}
        <span className={`collapsible-chevron ${open ? "open" : ""}`}>▶</span>
      </button>
      <div className={`collapsible-body-wrap ${open ? "open" : ""}`}>
        <div className="collapsible-body-inner">{children}</div>
      </div>
    </div>
  );
}
