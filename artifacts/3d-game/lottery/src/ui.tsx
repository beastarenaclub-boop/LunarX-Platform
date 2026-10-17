import { useEffect, useRef, type ReactNode } from "react";
import {
  X,
  CircleHelp,
  ArrowUpRight,
  Ticket,
  LoaderCircle,
  CheckCircle2,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { seriesName, money, date, time } from "./api";
import type { Receipt } from "./types";

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? "small" : ""}`}>
      <span className="brand-mark">
        I<span />
      </span>
      <span>
        Irland <span className="brand-light">Lotto</span>
        <small>EVERY NUMBER. CONNECTED.</small>
      </span>
    </div>
  );
}
export function Badge({
  children,
  kind = "neutral",
}: {
  children: ReactNode;
  kind?: string;
}) {
  return (
    <span className={`badge ${kind}`}>
      <i />
      {children}
    </span>
  );
}
export function Empty({
  title,
  description,
  icon = <Ticket size={25} />,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
export function Stat({
  label,
  value,
  detail,
  icon,
  accent = "mint",
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  accent?: string;
}) {
  return (
    <article className="stat" data-accent={accent}>
      <div>
        <span>{label}</span>
        <span className={`stat-icon ${accent}`}>{icon}</span>
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}
export function Heading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function Busy({
  children,
  busy,
}: {
  children: ReactNode;
  busy: boolean;
}) {
  return (
    <>
      {busy ? <LoaderCircle size={16} className="spin" /> : null}
      {children}
    </>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const old = document.activeElement as HTMLElement,
      before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current
      ?.querySelector<HTMLElement>("input, button, select, textarea")
      ?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const elements = ref.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input,select,textarea,a[href]",
        );
        if (!elements?.length) return;
        const first = elements[0],
          last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = before;
      document.removeEventListener("keydown", handler);
      old?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        className={`modal ${wide ? "wide" : ""}`}
      >
        <div className="modal-head">
          <h2 id="dialog-title">{title}</h2>
          <button
            className="icon-btn"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function ReceiptView({ receipt }: { receipt: Receipt | null }) {
  if (!receipt) return null;
  return (
    <article id="print-receipt">
      <h2>{receipt.brand}</h2>
      <p>{receipt.shop}</p>
      <p>{receipt.seller_id}</p>
      <h3>{receipt.print_count > 1 ? "DUPLICATE COPY" : "IRLAND LOTTO TICKET"}</h3>
      {receipt.demo && <b>DEMO · NO CASH VALUE</b>}
      <hr />
      <p>{receipt.id}</p>
      <p>
        {date(receipt.created)} · {time(receipt.created)}
      </p>
      <p>
        Draw: {time(receipt.draw.ends)} · {date(receipt.draw.ends)}
      </p>
      <p>
        {receipt.game} · {receipt.customer}
      </p>
      <hr />
      <table>
        <thead>
          <tr>
            <th>Series</th>
            <th>Number</th>
            <th>Qty</th>
            <th>Rate</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map((l) => (
            <tr key={l.series + l.number}>
              <td>{seriesName(l.series)}</td>
              <td>{l.number}</td>
              <td>{l.quantity}</td>
              <td className="receipt-amount">{money(l.unitPrice)}</td>
              <td className="receipt-amount">
                {money(l.quantity * l.unitPrice)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr />
      <h3>TOTAL: {money(receipt.total)}</h3>
      <QRCodeSVG value={receipt.id} size={104} level="M" />
      <p>Scan this ticket ID at the issuing shop.</p>
      <p>
        Keep your ticket for verification and claims.
        <br />A reprint does not create another entry.
      </p>
      <hr />
      <small>
        Print #{receipt.print_count} · {receipt.draw.id}
      </small>
    </article>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice">
      <CircleHelp size={17} />
      <p>{children}</p>
    </div>
  );
}
export function Success({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="success-panel">
      <CheckCircle2 size={32} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function TextLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  );
}
