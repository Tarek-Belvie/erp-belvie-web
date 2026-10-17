import { ReactNode } from "react";

export default function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="detail-field">
      <span className="detail-field-label">{label}</span>
      <span className="detail-field-value">{children}</span>
    </div>
  );
}
