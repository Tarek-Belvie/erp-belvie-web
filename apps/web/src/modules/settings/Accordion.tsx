import { useState } from "react";

interface Props {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export default function Accordion({ title, count, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="accordion">
      <button type="button" className="accordion-header" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="accordion-chevron">{open ? "▼" : "▶"}</span>
        <span className="accordion-title">{title}</span>
        <span className="accordion-count">({count})</span>
      </button>
      {open && <div className="accordion-body">{children}</div>}
    </div>
  );
}
