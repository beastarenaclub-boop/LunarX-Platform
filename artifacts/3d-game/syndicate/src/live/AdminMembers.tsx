"use client";
import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  Eye,
  FileText,
  Search,
  UserPlus,
  X,
} from "lucide-react";
import { Avatar, Badge, Empty, Panel } from "../App";
import {
  DOCUMENT_KINDS,
  accountProofKind,
  accountSummary,
  documentLabel,
  inr,
  progress,
  type DocumentRecord,
  type LiveMember,
  type Snapshot,
} from "./types";
import { totals } from "./reporting";
import ReferralPlacement, { binaryPosition } from "./ReferralPlacement";

const date = (value: string) =>
  new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
function signupLink(ref: string) {
  return `${location.origin}/member/signup?ref=${encodeURIComponent(ref)}`;
}
export function InviteMember({
  state,
  notify,
}: {
  state: Snapshot;
  notify: (text: string) => void;
}) {
  const available = state.members.filter(
    (m) => state.members.filter((c) => c.parent === m.id).length < 2,
  );
  const [choice, setChoice] = useState(state.me!.id);
  const sponsor = available.find((m) => m.id === choice) || available[0];
  return (
    <Panel
      title="New member signup"
      eyebrow="INVITE A MEMBER"
      className="spaced"
    >
      <div className="live-form-pad form">
        <p>
          Select a sponsor with an open left or right position. The new member
          creates their own email/password login, then completes their profile
          and uploads.
        </p>
        <label>
          Sponsor / referral ID
          <select
            aria-label="Signup sponsor"
            value={sponsor?.id || ""}
            onChange={(e) => setChoice(e.target.value)}
          >
            {available.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.ref} ·{" "}
                {2 - state.members.filter((c) => c.parent === m.id).length} open
              </option>
            ))}
          </select>
        </label>
        {sponsor ? (
          <>
            <div className="referral-card">
              <span>REFERRAL ID</span>
              <strong>{sponsor.ref}</strong>
            </div>
            <div className="page-actions">
              <button
                className="btn primary"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(signupLink(sponsor.ref))
                    .then(() =>
                      notify(
                        "Signup link copied. Share it with the new member.",
                      ),
                    )
                    .catch(() => notify(signupLink(sponsor.ref)));
                }}
              >
                <Copy size={16} /> Copy signup link
              </button>
              <a
                className="btn secondary"
                href={`/member/signup?ref=${encodeURIComponent(sponsor.ref)}`}
              >
                <UserPlus size={16} /> Open new signup
              </a>
            </div>
            <p className="small muted">
              A member signing up on this browser can switch accounts on the
              signup page. Your administrator session stays active until you
              choose to sign out.
            </p>
          </>
        ) : (
          <p>No sponsor position is available.</p>
        )}
      </div>
    </Panel>
  );
}

export function MemberDirectory({
  state,
  select,
  notify,
  compact = false,
}: {
  state: Snapshot;
  select: (id: string) => void;
  notify: (text: string) => void;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All statuses");
  const members = state.members.filter((m) => m.role !== "admin");
  const visible = state.members.filter(
    (m) =>
      (status === "All statuses" || m.status === status) &&
      [
        m.name,
        m.email,
        m.ref,
        m.sponsor?.name,
        m.sponsor?.ref,
        m.profile.firm,
        m.profile.gst,
      ].some((v) => v?.toLowerCase().includes(query.toLowerCase())),
  );
  const rows = compact
    ? visible.filter((m) => m.role !== "admin").slice(0, 6)
    : visible;
  return (
    <>
      {!compact && (
        <div className="stats-grid admin-member-stats">
          {[
            ["Registered members", members.length, UserPlus],
            [
              "Incomplete onboarding",
              members.filter(
                (m) => m.status !== "Approved" && m.status !== "In review",
              ).length,
              ClipboardList,
            ],
            [
              "Awaiting review",
              members.filter((m) => m.status === "In review").length,
              Eye,
            ],
            ["Uploaded files", state.documents.length, FileText],
          ].map(([label, value, Icon]) => {
            const Symbol = Icon as typeof UserPlus;
            return (
              <div className="stat-card" key={String(label)}>
                <div className="stat-top">
                  <span>{String(label)}</span>
                  <Symbol size={18} />
                </div>
                <div className="stat-main">
                  <strong>{String(value)}</strong>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Panel
        title={
          compact
            ? "Member onboarding at a glance"
            : "All members & uploaded documents"
        }
        action={<Badge>{members.length} members</Badge>}
        className="spaced"
      >
        {!compact && (
          <div className="member-filters">
            <label>
              <Search size={16} />{" "}
              <input
                aria-label="Search members"
                placeholder="Search member, sponsor, referral ID, firm or GSTIN"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <select
              aria-label="Member status filter"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {[
                "All statuses",
                "Draft",
                "In review",
                "Changes requested",
                "Approved",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Member / referral ID</th>
                <th>Under / Sponsor</th>
                <th>Referral used / position</th>
                <th>Status</th>
                <th>Current / savings</th>
                <th>Bank proofs / KYC</th>
                <th>Completion</th>
                <th>Check details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const summary = accountSummary(m, state.documents),
                  completion = progress(m, state.documents);
                return (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.name}</strong>
                      <small className="table-sub">{m.email || "—"}</small>
                      <small className="table-sub">{m.ref}</small>
                    </td>
                    <td>
                      {m.sponsor ? (
                        <button
                          className="link-button"
                          onClick={() => select(m.sponsor!.id)}
                        >
                          {m.sponsor.name}
                        </button>
                      ) : m.parent ? (
                        "Sponsor unavailable"
                      ) : (
                        "Workspace owner"
                      )}
                    </td>
                    <td>
                      {m.sponsor?.ref || "No referral"}
                      <small className="table-sub">
                        {binaryPosition(m)} position
                      </small>
                    </td>
                    <td>
                      <Badge tone={m.status === "Approved" ? "green" : "gold"}>
                        {m.status}
                      </Badge>
                      <small className="table-sub">
                        {m.role === "user" ? "Member" : m.role}
                      </small>
                    </td>
                    <td>
                      {m.role === "admin"
                        ? "Workspace owner"
                        : `${summary.current}/5 current · ${summary.savings}/2 savings`}
                    </td>
                    <td>
                      {m.role === "admin"
                        ? `${state.documents.filter((d) => d.member_id === m.id).length} files`
                        : `${summary.proofs}/7 proofs · ${summary.documents}/7 KYC`}
                    </td>
                    <td>
                      {m.role === "admin" ? (
                        "Admin account"
                      ) : (
                        <>
                          <progress
                            aria-label={`${m.name} onboarding completion`}
                            value={completion.percent}
                            max={100}
                          />
                          <small className="table-sub">
                            {completion.percent}% ·{" "}
                            {completion.checks.filter((c) => !c.done).length}{" "}
                            pending checks
                          </small>
                        </>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn secondary small"
                        aria-label={`View complete profile for ${m.name}`}
                        onClick={() => select(m.id)}
                      >
                        View complete profile <ArrowUpRight size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && (
            <Empty
              title={
                query ? "No matching members" : "No members have signed up yet"
              }
              detail="New profiles appear here immediately, including drafts with incomplete uploads."
            />
          )}
        </div>
      </Panel>
      {!compact && (
        <>
          {!!state.registrations?.length && (
            <Panel
              title="Signup started — profile not completed"
              className="spaced"
            >
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Account created (IST)</th>
                      <th>Next step</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.registrations.map((r) => (
                      <tr key={r.id}>
                        <td>{r.name}</td>
                        <td>{r.email}</td>
                        <td>{date(r.created_at)}</td>
                        <td>Sign in and complete referral signup</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
          <InviteMember state={state} notify={notify} />
        </>
      )}
    </>
  );
}

function FileCard({
  doc,
  title,
  preview,
}: {
  doc?: DocumentRecord;
  title: string;
  preview: (d: DocumentRecord) => void;
}) {
  return (
    <article className={"admin-file-card " + (doc ? "uploaded" : "missing")}>
      <div className="admin-file-title">
        <FileText size={18} />
        <strong>{title}</strong>
        <Badge tone={doc ? "green" : "gold"}>
          {doc ? "Uploaded" : "Missing"}
        </Badge>
      </div>
      {doc ? (
        <>
          <p>{doc.name}</p>
          <small>
            {(doc.size / 1024).toFixed(1)} KB · {date(doc.created_at)} IST
          </small>
          <div className="page-actions">
            <button
              className="btn secondary small"
              onClick={() => preview(doc)}
              aria-label={`Preview ${title}`}
            >
              <Eye size={14} /> Preview
            </button>
            <a
              className="btn secondary small"
              href={`/api/documents/${doc.id}`}
            >
              <Download size={14} /> Download
            </a>
          </div>
        </>
      ) : (
        <p>This document has not been uploaded.</p>
      )}
    </article>
  );
}

export function MemberDossier({
  state,
  member: m,
  back,
  children,
}: {
  state: Snapshot;
  member: LiveMember;
  back: () => void;
  children: ReactNode;
}) {
  const [preview, setPreview] = useState<DocumentRecord | null>(null);
  const docs = state.documents.filter((d) => d.member_id === m.id),
    summary = accountSummary(m, docs),
    completion = progress(m, docs);
  const direct = state.members.filter((c) => c.parent === m.id);
  const accounts = m.profile.accounts || [],
    tasks = state.tasks.filter((t) => t.assignee === m.id),
    entries = state.entries.filter((e) => e.member_id === m.id),
    financial = totals(entries);
  const activity = state.audit.filter(
    (a) => a.actor === m.id || a.subject === m.id,
  );
  const extraDocs = docs.filter(
    (d) =>
      !(DOCUMENT_KINDS as readonly string[]).includes(d.kind) &&
      !accounts.some((a) => accountProofKind(a) === d.kind),
  );
  return (
    <div className="admin-dossier">
      <button className="btn secondary" onClick={back}>
        <ArrowLeft size={16} /> Back to all members
      </button>
      <div className="member-dossier-heading">
        <Avatar name={m.name} />
        <div>
          <h2>{m.name}</h2>
          <p>
            {m.email} · {m.ref}
          </p>
        </div>
        <Badge tone={m.status === "Approved" ? "green" : "gold"}>
          {m.status}
        </Badge>
      </div>
      <div className="summary-pills">
        <span>
          Current <strong>{summary.current}/5</strong>
        </span>
        <span>
          Savings <strong>{summary.savings}/2</strong>
        </span>
        <span>
          Bank proofs <strong>{summary.proofs}/7</strong>
        </span>
        <span>
          KYC files <strong>{summary.documents}/7</strong>
        </span>
        <span>
          Total uploads <strong>{docs.length}</strong>
        </span>
      </div>
      <ReferralPlacement member={m} />
      <div className="dossier-jump">
        <a href="#member-business">Profile</a>
        <a href="#member-banks">Bank accounts</a>
        <a href="#member-documents">Documents</a>
        <a href="#member-review">Review decision</a>
        <a href="#member-operations">Tasks & accounts</a>
        <a href="#member-activity">Activity</a>
      </div>
      <div className="live-two-col">
        <div id="member-business">
          <Panel title="Member & business details">
            <dl className="dossier-facts">
              {[
                ["Member ID", m.id],
                ["Email", m.email],
                ["City", m.city],
                ["Joined (IST)", date(m.created_at)],
                ["Access role", m.role === "user" ? "Member" : m.role],
                ["Firm", m.profile.firm],
                ["GSTIN", m.profile.gst],
                ["Plan", m.profile.plan],
                [
                  "Account ownership confirmed",
                  m.profile.ownership ? "Yes" : "Pending",
                ],
                [
                  "Document review consent",
                  m.profile.consent ? "Yes" : "Pending",
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value || "Not submitted"}</dd>
                </div>
              ))}
            </dl>
            <div className="live-form-pad">
              <h3>Bank preferences at signup</h3>
              <p>
                {m.profile.bankPreferences?.join(" · ") ||
                  "No bank preferences submitted."}
              </p>
              <h3>Registered contacts / SIM references</h3>
              {m.profile.contacts?.length ? (
                m.profile.contacts.map((c, i) => (
                  <p key={i}>
                    Contact {i + 1} · {c.label} · •••• {c.last4}
                  </p>
                ))
              ) : (
                <p>No contact references submitted.</p>
              )}
            </div>
          </Panel>
        </div>
        <Panel
          title="Completion & agent eligibility"
          action={
            <Badge>
              {m.role === "admin" ? "Admin" : `${completion.percent}% complete`}
            </Badge>
          }
        >
          <div className="live-form-pad form">
            {m.role === "admin" ? (
              <p>
                This is the administrator account. Merchant onboarding
                requirements apply to member accounts.
              </p>
            ) : (
              <>
                <progress
                  aria-label="Member onboarding completion"
                  value={completion.percent}
                  max={100}
                />
                <ul className="dossier-checklist">
                  {completion.checks.map((c) => (
                    <li key={c.label} className={c.done ? "done" : ""}>
                      <CheckCircle2 size={16} />
                      <span>{c.label}</span>
                      <strong>{c.done ? "Complete" : "Pending"}</strong>
                    </li>
                  ))}
                </ul>
                <p>
                  {m.status === "Approved"
                    ? "Own profile approved"
                    : "Own profile approval pending"}{" "}
                  · {direct.filter((c) => c.status === "Approved").length}/2
                  direct members approved.
                </p>
              </>
            )}
            <h3>Direct members</h3>
            {["left", "right"].map((side) => {
              const child = direct.find((c) => c.position === side);
              return (
                <p key={side}>
                  {side}:{" "}
                  {child ? `${child.name} · ${child.status}` : "Open position"}
                </p>
              );
            })}
          </div>
        </Panel>
      </div>
      <div id="member-banks">
        <Panel
          title="All submitted bank accounts"
          action={<Badge>{accounts.length}/7 saved</Badge>}
        >
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Bank / type</th>
                  <th>Holder / reference</th>
                  <th>Linked contact</th>
                  <th>Requested / approved daily limit</th>
                  <th>Status</th>
                  <th>Bank evidence</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const doc = docs.find((d) => d.kind === accountProofKind(a)),
                    contact = m.profile.contacts?.[a.contact];
                  return (
                    <tr key={a.id}>
                      <td>
                        <strong>{a.bank}</strong>
                        <small className="table-sub">{a.type}</small>
                      </td>
                      <td>
                        {a.holder}
                        <small className="table-sub">•••• {a.last4}</small>
                      </td>
                      <td>
                        Contact {a.contact + 1}
                        <small className="table-sub">
                          {contact
                            ? `${contact.label} · •••• ${contact.last4}`
                            : "Not submitted"}
                        </small>
                      </td>
                      <td>
                        {a.type === "Savings" ? (
                          "Not applicable"
                        ) : (
                          <>
                            {inr(a.requestedLimit * 100)} requested
                            <small className="table-sub">
                              {a.approvedLimit
                                ? inr(a.approvedLimit * 100) + " approved"
                                : "Approval pending"}
                            </small>
                          </>
                        )}
                      </td>
                      <td>
                        <Badge
                          tone={a.status === "Approved" ? "green" : "gold"}
                        >
                          {a.status}
                        </Badge>
                      </td>
                      <td>
                        {doc ? (
                          <div className="page-actions">
                            <button
                              className="btn secondary small"
                              aria-label={`Preview bank proof ${a.last4}`}
                              onClick={() => setPreview(doc)}
                            >
                              Preview proof
                            </button>
                            <a href={`/api/documents/${doc.id}`}>Download</a>
                          </div>
                        ) : (
                          <Badge tone="gold">Proof missing</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!accounts.length && (
              <Empty
                title="No bank accounts submitted"
                detail="Saved current and savings accounts will appear here, even before the member submits their profile for review."
              />
            )}
          </div>
          <p className="subtle-note">
            Account and contact references contain the last four digits
            collected by the portal. Uploaded evidence can be inspected
            separately.
          </p>
        </Panel>
      </div>
      <div id="member-documents">
        <Panel
          title="Required documents & video KYC"
          action={<Badge>{summary.documents}/7 uploaded</Badge>}
        >
          <div className="admin-document-grid">
            {DOCUMENT_KINDS.map((kind) => (
              <FileCard
                key={kind}
                title={kind}
                doc={docs.find((d) => d.kind === kind)}
                preview={setPreview}
              />
            ))}
          </div>
        </Panel>
      </div>
      {!!extraDocs.length && (
        <Panel title="Expense receipts & previous evidence">
          <div className="admin-document-grid">
            {extraDocs.map((d) => (
              <FileCard
                key={d.id}
                title={documentLabel(d, m.profile)}
                doc={d}
                preview={setPreview}
              />
            ))}
          </div>
        </Panel>
      )}
      <div id="member-review">
        <Panel title="Administrator review decision">
          <div className="live-form-pad">
            {m.profile.reviewNote && (
              <p className="review-note">Last review: {m.profile.reviewNote}</p>
            )}
            {m.status === "Draft" && (
              <p className="muted">
                Member is still completing their profile. You can inspect every
                saved item now; approval becomes available after the member
                submits all required evidence.
              </p>
            )}
            {children}
          </div>
        </Panel>
      </div>
      <div id="member-operations">
        <Panel title="Member tasks & financial records">
          <div className="summary-pills live-form-pad">
            <span>
              Approved turnover <strong>{inr(financial.turnover)}</strong>
            </span>
            <span>
              Income <strong>{inr(financial.income)}</strong>
            </span>
            <span>
              Expense <strong>{inr(financial.expense)}</strong>
            </span>
            <span>
              Ledger balance <strong>{inr(financial.net)}</strong>
            </span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Assigned by</th>
                  <th>Due</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.title}
                      <small className="table-sub">{t.description}</small>
                    </td>
                    <td>
                      {state.members.find((a) => a.id === t.assigned_by)
                        ?.name || "—"}
                    </td>
                    <td>{t.due}</td>
                    <td>{t.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!tasks.length && (
              <p className="live-form-pad muted">No tasks assigned.</p>
            )}
            <table>
              <thead>
                <tr>
                  <th>Date / reference</th>
                  <th>Kind / source</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td>
                      {e.date}
                      <small className="table-sub">{e.reference}</small>
                    </td>
                    <td>
                      {e.kind} · {e.source}
                    </td>
                    <td>{e.description}</td>
                    <td>{inr(e.amount_paise)}</td>
                    <td>{e.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!entries.length && (
              <p className="live-form-pad muted">
                No financial records submitted.
              </p>
            )}
          </div>
        </Panel>
      </div>
      <div id="member-activity">
        <Panel title="Recent member activity & access">
          <div className="live-activity">
            {activity.map((a) => (
              <article key={a.id}>
                <span className="activity-dot" />
                <div>
                  <strong>{a.action}</strong>
                  <p>
                    {a.detail.startsWith("Account proof:")
                      ? "Bank evidence uploaded or accessed"
                      : a.detail}
                  </p>
                  <small>{date(a.created_at)} IST</small>
                  <div className="log-facts">
                    <code>IP {a.ip}</code>
                    <span>
                      {[a.city, a.country].filter(Boolean).join(", ") ||
                        "Network location unavailable"}
                    </span>
                  </div>
                  {a.location && (
                    <p className="small">Shared location: {a.location}</p>
                  )}
                  <small className="device-info">
                    {a.user_agent || "Device details unavailable"}
                  </small>
                </div>
              </article>
            ))}
            {!activity.length && (
              <p className="live-form-pad muted">
                No events in the recent audit window.
              </p>
            )}
          </div>
          <p className="subtle-note">
            Shows this member's events within the latest 250 workspace audit
            events. Local connections show a loopback IP.
          </p>
        </Panel>
      </div>
      {preview && (
        <div
          className="admin-preview"
          role="dialog"
          aria-modal="true"
          aria-label="Document preview"
          onKeyDown={(e) => {
            if (e.key === "Escape") setPreview(null);
          }}
        >
          <div className="admin-preview-panel">
            <header>
              <div>
                <strong>{documentLabel(preview, m.profile)}</strong>
                <small>{preview.name}</small>
              </div>
              <a
                className="btn secondary small"
                href={`/api/documents/${preview.id}`}
              >
                <Download size={16} /> Download
              </a>
              <button
                autoFocus
                className="icon-btn"
                aria-label="Close document preview"
                onClick={() => setPreview(null)}
              >
                <X />
              </button>
            </header>
            {preview.mime.startsWith("image/") ? (
              <img
                src={`/api/documents/${preview.id}?view=1`}
                alt={documentLabel(preview, m.profile)}
              />
            ) : preview.mime.startsWith("video/") ? (
              <video controls src={`/api/documents/${preview.id}?view=1`} />
            ) : (
              <iframe
                title={preview.name}
                src={`/api/documents/${preview.id}?view=1`}
              />
            )}
            <a
              href={`/api/documents/${preview.id}?view=1`}
              target="_blank"
              rel="noreferrer"
            >
              Open document in a new tab
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
