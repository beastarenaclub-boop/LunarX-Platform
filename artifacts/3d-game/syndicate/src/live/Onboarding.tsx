"use client";
import { useState, type FormEvent } from "react";
import {
  Building2,
  Check,
  CheckCircle2,
  Download,
  FileText,
  ShieldCheck,
  Upload,
  Video,
} from "lucide-react";
import { Badge, Panel } from "../App";
import AccountSummary from "./AccountSummary";
import {
  BANKS,
  BANK_SOURCE,
  BANK_SOURCE_SECONDARY,
  QUICK_BANKS,
} from "./banks";
import {
  DOCUMENT_KINDS,
  progress,
  accountProofKind,
  type Snapshot,
  type Profile,
  type BankAccount,
  type DocumentRecord,
} from "./types";
type Props = {
  state: Snapshot;
  busy: boolean;
  act: (path: string, payload: unknown) => Promise<any>;
  upload: (kind: string, file: File, accountId?: string) => Promise<void>;
  notify: (message: string) => void;
};
export default function Onboarding({
  state,
  busy,
  act,
  upload,
  notify,
}: Props) {
  const me = state.me!;
  const locked = ["Approved", "In review"].includes(me.status);
  const p = me.profile;
  const [accounts, setAccounts] = useState<BankAccount[]>(() =>
    Array.from(
      { length: 7 },
      (_, i) =>
        p.accounts?.filter((a) => a.type === (i < 5 ? "Current" : "Savings"))[
          i < 5 ? i : i - 5
        ] || {
          id: crypto.randomUUID(),
          bank: p.bankPreferences?.[i] || QUICK_BANKS[i % 5],
          type: i < 5 ? "Current" : "Savings",
          last4: "",
          holder: p.firm || me.name,
          contact: i % 2,
          requestedLimit: i < 5 ? 5000000 : 0,
          approvedLimit: 0,
          status: "Pending",
          owned: false,
        },
    ),
  );
  const completion = progress(me, state.documents);
  const edit = (index: number, patch: Partial<BankAccount>) =>
    setAccounts((prev) =>
      prev.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("ownership") !== "on" || f.get("consent") !== "on") {
      notify(
        "Confirm account ownership and document review consent before saving.",
      );
      document
        .getElementById("onboarding-consent")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const profile: Profile = {
      firm: String(f.get("firm")),
      gst: String(f.get("gst")).trim().toUpperCase(),
      contacts: [0, 1].map((i) => ({
        label: String(f.get("contactLabel" + i)),
        last4: String(f.get("contact" + i)),
      })),
      accounts: accounts.filter((a) => a.last4 !== ""),
      ownership: f.get("ownership") === "on",
      consent: f.get("consent") === "on",
    };
    await act("profile", { profile, revision: me.revision, draft: true });
  }
  if (me.role === "admin")
    return (
      <Panel title="Administrator workspace">
        <div className="section-intro">
          Your administrator profile manages reviews. Merchant onboarding
          requirements apply to invited members. Use your referral ID{" "}
          <strong>{me.ref}</strong> to create the first two direct positions.
          Use Members &amp; documents to inspect saved profiles and uploads.
        </div>
      </Panel>
    );
  return (
    <>
      <AccountSummary state={state} />
      <div className="onboarding-shortcuts">
        <a className="btn secondary small" href="#onboarding-business">
          1. Business & contacts
        </a>
        <a className="btn secondary small" href="#onboarding-accounts">
          2. Select banks & add accounts
        </a>
        <a className="btn secondary small" href="#onboarding-documents">
          3. Upload KYC documents
        </a>
      </div>
      <div className="info-banner">
        <ShieldCheck size={24} />
        <div>
          <strong>
            {me.status === "Approved"
              ? "Merchant review approved"
              : me.status === "In review"
                ? "Your profile is awaiting administrator review"
                : "Complete your merchant onboarding"}
          </strong>
          <p>
            Plan: Merchant onboarding · {completion.percent}% checklist ready ·
            save accounts one at a time, then attach each bank proof.
          </p>
        </div>
        <Badge tone={me.status === "Approved" ? "green" : "gold"}>
          {me.status}
        </Badge>
      </div>
      {p.reviewNote && (
        <div className="review-note">
          <strong>Reviewer note</strong>
          <p>{p.reviewNote}</p>
        </div>
      )}
      <div className="live-progress">
        <i style={{ width: completion.percent + "%" }} />
      </div>
      <form className="form live-onboarding" onSubmit={submit}>
        {!locked && (
          <div className="panel live-form-pad form" id="onboarding-consent">
            <strong>Save your progress as you go</strong>
            <p className="small muted">
              Choose a bank, enter the last four account digits, holder and
              contact, then confirm ownership. Empty account slots are not
              counted. All seven accounts and documents are required for final
              review.
            </p>
            <label className="checkbox-label inline-check">
              <input
                name="ownership"
                type="checkbox"
                required
                defaultChecked={p.ownership}
              />
              I am the owner or authorized business signatory. Account and SIM
              access stays with the registered owner.
            </label>
            <label className="checkbox-label inline-check">
              <input
                name="consent"
                type="checkbox"
                required
                defaultChecked={p.consent}
              />
              I consent to storing masked references and uploading my documents
              for administrator review.
            </label>
            <button
              className="btn primary"
              disabled={busy}
              type="submit"
              formNoValidate
            >
              Save progress <Check size={16} />
            </button>
          </div>
        )}
        <div id="onboarding-business" />
        <Panel title="Business identity" eyebrow="YOUR REGISTERED BUSINESS">
          <div className="live-form-pad form-columns">
            <label>
              Registered firm name
              <input
                name="firm"
                required
                maxLength={120}
                defaultValue={p.firm}
                disabled={locked}
              />
            </label>
            <label>
              GSTIN
              <input
                name="gst"
                required
                maxLength={15}
                pattern="[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z][Zz][0-9A-Za-z]"
                placeholder="15-character GSTIN"
                defaultValue={p.gst}
                disabled={locked}
              />
            </label>
          </div>
          <p className="subtle-note">
            GSTIN format checking is not government verification. An
            administrator must review supporting records.
          </p>
        </Panel>
        <Panel
          title="Two registered contact references"
          eyebrow="STEP 01 / BEFORE ACCOUNT MAPPING"
        >
          <div className="live-form-pad form-columns">
            {[0, 1].map((i) => (
              <div className="form" key={i}>
                <label>
                  Contact {i + 1} label
                  <input
                    name={"contactLabel" + i}
                    maxLength={50}
                    required
                    defaultValue={
                      p.contacts?.[i]?.label || `Registered mobile ${i + 1}`
                    }
                    disabled={locked}
                  />
                </label>
                <label>
                  Contact {i + 1} last four digits
                  <input
                    name={"contact" + i}
                    maxLength={4}
                    pattern="[0-9]{4}"
                    inputMode="numeric"
                    required
                    defaultValue={p.contacts?.[i]?.last4}
                    placeholder="Only last 4 digits"
                    disabled={locked}
                  />
                </label>
              </div>
            ))}
          </div>
          <p className="subtle-note">
            The SIMs and bank access stay with the registered owner. Contact
            labels map the owner’s references; the portal never requests OTPs,
            PINs or banking passwords.
          </p>
        </Panel>
        <div id="onboarding-accounts" />
        <Panel
          title="Five business current accounts"
          eyebrow="STEP 02 / MASKED REFERENCES"
        >
          <div className="account-records">
            {accounts
              .filter((a) => a.type === "Current")
              .map((a, i) => (
                <AccountRow
                  key={a.id}
                  account={a}
                  index={i}
                  locked={locked}
                  busy={busy}
                  saved={
                    !!p.accounts?.some(
                      (saved) =>
                        accountProofKind(saved) === accountProofKind(a),
                    )
                  }
                  proof={state.documents.find(
                    (d) =>
                      d.member_id === me.id && d.kind === accountProofKind(a),
                  )}
                  upload={upload}
                  onChange={(v) => edit(i, v)}
                />
              ))}
          </div>
          <p className="subtle-note">
            ₹50 lakh and ₹1 crore are requested daily limits for this plan.
            Approval requires independent bank evidence. This portal cannot
            grant or increase a bank limit.{" "}
            <a
              href="https://www.axisbank.com/docs/default-source/default-document-library/corporate-internet-banking-faqs.pdf?sfvrsn=2"
              target="_blank"
              rel="noreferrer"
            >
              Bank limit guidance ↗
            </a>
          </p>
        </Panel>
        <Panel
          title="Two owner-authorized savings references"
          eyebrow="STEP 03 / REGISTERED CONTACT MAPPING"
        >
          <div className="account-records">
            {accounts
              .filter((a) => a.type === "Savings")
              .map((a, i) => (
                <AccountRow
                  key={a.id}
                  account={a}
                  index={i + 5}
                  locked={locked}
                  busy={busy}
                  saved={
                    !!p.accounts?.some(
                      (saved) =>
                        accountProofKind(saved) === accountProofKind(a),
                    )
                  }
                  proof={state.documents.find(
                    (d) =>
                      d.member_id === me.id && d.kind === accountProofKind(a),
                  )}
                  upload={upload}
                  onChange={(v) => edit(i + 5, v)}
                />
              ))}
          </div>
          <p className="subtle-note">
            A savings reference is for ownership review only. Its inclusion does
            not authorize commercial use or company control of the account.
          </p>
        </Panel>
        {!locked && (
          <button
            className="btn primary"
            disabled={busy}
            type="submit"
            formNoValidate
          >
            Save business & account references <Check size={16} />
          </button>
        )}
      </form>
      <div id="onboarding-documents" />
      <Panel
        title="Supporting documents & video KYC"
        eyebrow="STEP 04 / PRIVATE REVIEW"
        className="spaced"
      >
        <div className="document-list">
          {DOCUMENT_KINDS.map((kind) => {
            const doc = state.documents.find(
              (d) => d.member_id === me.id && d.kind === kind,
            );
            return (
              <div className="document-row" key={kind}>
                <span className={"doc-number " + (doc ? "done" : "")}>
                  {doc ? (
                    <Check size={16} />
                  ) : kind === "Video KYC" ? (
                    <Video size={16} />
                  ) : (
                    <FileText size={16} />
                  )}
                </span>
                <div>
                  <strong>{kind}</strong>
                  <small>
                    {doc
                      ? `${doc.name} · ${(doc.size / 1024).toFixed(0)} KB`
                      : "Awaiting upload"}
                  </small>
                </div>
                {doc && (
                  <a
                    href={"/api/documents/" + doc.id}
                    className="icon-btn"
                    aria-label={"Download " + kind}
                  >
                    <Download size={16} />
                  </a>
                )}
                {!locked && (
                  <label className="upload-button">
                    <Upload size={15} />
                    <span>{doc ? "Replace" : "Upload"}</span>
                    <input
                      type="file"
                      aria-label={"Upload " + kind}
                      disabled={busy}
                      accept={
                        kind === "Video KYC"
                          ? ".mp4,.webm"
                          : ".pdf,.jpg,.jpeg,.png"
                      }
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void upload(kind, file);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
            );
          })}
        </div>
        <p className="subtle-note">
          Documents: PDF, JPG or PNG. Video: MP4 or WebM. Maximum 15 MB each.
          Files are stored privately and served only to their owner or an
          administrator. Video review is manual; an automated KYC provider is
          not connected.
        </p>
      </Panel>
      <div className="submit-checklist">
        <div>
          <strong>{completion.percent}% checklist complete</strong>
          <p className="small muted">
            {completion.checks.filter((c) => !c.done).length} requirements
            remaining
          </p>
          {!locked && (
            <ul className="remaining-checks">
              {completion.checks
                .filter((c) => !c.done)
                .map((c) => (
                  <li key={c.label}>{c.label}</li>
                ))}
            </ul>
          )}
        </div>
        <button
          className="btn primary"
          disabled={busy || locked || !completion.complete}
          onClick={() => void act("submit-profile", { revision: me.revision })}
        >
          Submit complete profile <ShieldCheck size={17} />
        </button>
      </div>
      <Panel title="Agent eligibility">
        <div className="live-form-pad eligibility-steps">
          <p>
            <CheckCircle2 size={18} /> Your own onboarding must be approved.
          </p>
          <p>
            <CheckCircle2 size={18} /> Exactly two direct referrals must
            complete this same plan and receive approval.
          </p>
          <p>
            <CheckCircle2 size={18} /> Once all three profiles are approved,
            agent task assignment unlocks automatically.
          </p>
          <p className="muted">
            Commission follows the versioned policy in Commissions &amp;
            rewards. Only verified business activity can earn a share.
          </p>
        </div>
      </Panel>
    </>
  );
}
function AccountRow({
  account: a,
  index,
  locked,
  busy,
  saved,
  proof,
  upload,
  onChange,
}: {
  account: BankAccount;
  index: number;
  locked: boolean;
  busy: boolean;
  saved: boolean;
  proof?: DocumentRecord;
  upload: Props["upload"];
  onChange: (value: Partial<BankAccount>) => void;
}) {
  return (
    <section
      className="account-record"
      aria-label={`${a.type} account ${a.type === "Current" ? index + 1 : index - 4}`}
    >
      <div className="account-record-head">
        <span className="approval-icon">
          <Building2 size={19} />
        </span>
        <strong>
          {a.type} account {a.type === "Current" ? index + 1 : index - 4}
        </strong>
        <Badge tone={a.status === "Approved" ? "green" : "gold"}>
          {saved
            ? a.status === "Approved"
              ? "Approved"
              : "Saved · awaiting review"
            : "Not saved"}
        </Badge>
      </div>
      <div className="account-fields">
        <label>
          Bank
          <select
            aria-label={`Bank for account ${index + 1}`}
            value={a.bank}
            disabled={locked}
            onChange={(e) => onChange({ bank: e.target.value })}
          >
            <optgroup label="Quick choices">
              {QUICK_BANKS.map((bank) => (
                <option key={bank}>{bank}</option>
              ))}
            </optgroup>
            <optgroup label="More Indian banks">
              {BANKS.filter((b) => !QUICK_BANKS.includes(b)).map((bank) => (
                <option key={bank}>{bank}</option>
              ))}
            </optgroup>
          </select>
        </label>
        <label>
          Account holder / firm
          <input
            value={a.holder}
            required
            maxLength={120}
            disabled={locked}
            onChange={(e) => onChange({ holder: e.target.value })}
          />
        </label>
        <label>
          Last four account digits
          <input
            value={a.last4}
            required
            inputMode="numeric"
            maxLength={4}
            pattern="[0-9]{4}"
            placeholder="0000"
            disabled={locked}
            onChange={(e) =>
              onChange({ last4: e.target.value.replace(/\D/g, "").slice(0, 4) })
            }
          />
        </label>
        <label>
          Registered contact
          <select
            value={a.contact}
            disabled={locked}
            onChange={(e) => onChange({ contact: Number(e.target.value) })}
          >
            <option value={0}>Contact 1</option>
            <option value={1}>Contact 2</option>
          </select>
        </label>
        {a.type === "Current" && (
          <label>
            Requested daily limit
            <select
              value={a.requestedLimit}
              disabled={locked}
              onChange={(e) =>
                onChange({ requestedLimit: Number(e.target.value) })
              }
            >
              <option value={5000000}>₹50,00,000</option>
              <option value={10000000}>₹1,00,00,000</option>
            </select>
          </label>
        )}
      </div>
      <label className="checkbox-label inline-check">
        <input
          type="checkbox"
          checked={a.owned}
          required
          disabled={locked}
          onChange={(e) => onChange({ owned: e.target.checked })}
        />{" "}
        Owner / authorized signatory confirmed
      </label>
      <div className="account-proof">
        <div>
          <strong>Bank account proof</strong>
          <small>
            {proof
              ? proof.name
              : saved
                ? "Upload a redacted statement, cancelled cheque or bank letter matching this account."
                : "Save this account first to enable its bank proof upload."}
          </small>
          <small>
            {a.bank} · {a.type} ·{" "}
            {a.last4 ? `•••• ${a.last4}` : "Account digits pending"}
          </small>
        </div>
        <div className="page-actions">
          {!locked && (
            <button
              type="submit"
              formNoValidate
              disabled={busy}
              className="btn secondary small"
            >
              Save account details
            </button>
          )}
          {proof && (
            <a
              className="btn secondary small"
              href={"/api/documents/" + proof.id}
            >
              <Download size={14} /> Download proof
            </a>
          )}
          {!locked && (
            <label
              className={`upload-button ${!saved || busy ? "disabled" : ""}`}
            >
              <Upload size={15} />
              <span>{proof ? "Replace bank proof" : "Upload bank proof"}</span>
              <input
                type="file"
                aria-label={`Upload bank proof for account ${index + 1}`}
                accept=".pdf,.jpg,.jpeg,.png"
                disabled={busy || !saved}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload("Bank account proof", file, a.id);
                  e.currentTarget.value = "";
                }}
              />
            </label>
          )}
        </div>
      </div>
      <p className="small muted">
        PDF, JPG or PNG · up to 15 MB · visible only to you and administrators.
        Hide unrelated transactions and full account numbers.
      </p>
      {locked && !proof && (
        <p className="small muted">
          No bank proof attached. Ask the administrator to reopen your profile
          to add or correct documents.
        </p>
      )}
      {a.status === "Approved" && a.type === "Current" && (
        <small className="green-text">
          Recorded bank-approved limit: ₹
          {a.approvedLimit.toLocaleString("en-IN")}
        </small>
      )}
    </section>
  );
}
