"use client";
import { Building2, Upload, ArrowUpRight } from "lucide-react";
import { Panel } from "../App";
import { accountSummary, type Snapshot } from "./types";

export default function AccountSummary({
  state,
  open,
}: {
  state: Snapshot;
  open?: () => void;
}) {
  const counts = accountSummary(state.me!, state.documents);
  return (
    <Panel
      title="My accounts & uploads"
      className="spaced member-account-summary"
      action={
        open && (
          <button className="btn primary small" onClick={open}>
            Add accounts & upload <ArrowUpRight size={15} />
          </button>
        )
      }
    >
      <div className="account-count-grid">
        {[
          [
            "Current accounts saved",
            `${counts.current} / 5`,
            `${5 - counts.current} remaining`,
          ],
          [
            "Savings accounts saved",
            `${counts.savings} / 2`,
            `${2 - counts.savings} remaining`,
          ],
          [
            "Bank proofs uploaded",
            `${counts.proofs} / 7`,
            "One document per saved account",
          ],
          [
            "KYC documents uploaded",
            `${counts.documents} / 7`,
            "Business, identity & video KYC",
          ],
        ].map(([label, value, note]) => (
          <div key={label} className="account-count" aria-label={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{note}</small>
          </div>
        ))}
      </div>
      <div className="account-summary-footer">
        <span>
          <Building2 size={16} /> {counts.total} accounts saved ·{" "}
          {counts.approved} approved · {counts.total - counts.approved} awaiting
          review
        </span>
        <span>
          <Upload size={16} /> Select bank → save details → upload bank proof →
          submit for review
        </span>
      </div>
    </Panel>
  );
}
