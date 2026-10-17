import {
  ArrowUpRight,
  Check,
  LockKeyhole,
  Network,
  ShieldCheck,
} from "lucide-react";
import { Emblem } from "../App";
import { accountSummary, progress, type Snapshot } from "./types";

export default function AgentJourney({
  state,
  visit,
  compact = false,
}: {
  state: Snapshot;
  visit: (page: string) => void;
  compact?: boolean;
}) {
  const me = state.me!;
  const preparation = progress(me, state.documents);
  const accounts = accountSummary(me, state.documents);
  const left = state.members.find(
    (m) => m.parent === me.id && m.position === "left",
  );
  const right = state.members.find(
    (m) => m.parent === me.id && m.position === "right",
  );
  const seals = [me, left, right];
  const approved = seals.filter((m) => m?.status === "Approved").length;
  const eligible = approved === 3;
  const percent = eligible
    ? 100
    : Math.min(
        99,
        Math.floor(
          seals.reduce(
            (sum, m, i) =>
              sum +
              (m?.status === "Approved"
                ? 100
                : (i === 0 ? preparation.percent : m?.onboardingPercent || 0) *
                  0.8),
            0,
          ) / 3,
        ),
      );
  const next =
    me.status !== "Approved"
      ? "onboarding"
      : !left || !right
        ? "invite"
        : "network";
  const nextLabel =
    me.status === "In review"
      ? "Check my review status"
      : me.status !== "Approved"
        ? "Complete my verification"
        : !left || !right
          ? "Invite a direct member"
          : "Check team approval";
  return (
    <section
      className={`syndicate-journey ${eligible ? "journey-unlocked" : ""} ${compact ? "journey-compact" : ""}`}
      aria-label="Syndicate agent journey"
    >
      <div className="journey-hero">
        <div className="journey-seal" aria-hidden="true">
          <Emblem />
          <span>{eligible ? "SEAL VERIFIED" : "THE INNER CIRCLE"}</span>
        </div>
        <div className="journey-intro">
          <div className="eyebrow">ILLUMINATI SYNDICATE / THE PATH</div>
          <h2>
            {eligible
              ? "Your agent access is unlocked."
              : "Your path to Syndicate Agent."}
          </h2>
          <p>
            Ek member ID. Teen approvals. Apni verification aur left/right ke
            dono members ki approval poori karo. Isi account par agent access
            unlock hoga.
          </p>
          <span className="journey-rank">
            {eligible ? <ShieldCheck size={14} /> : <LockKeyhole size={14} />}
            {eligible ? "SYNDICATE AGENT" : "MEMBER · INITIATE"}
          </span>
        </div>
        <div className="journey-progress">
          <strong>
            {percent}
            <small>%</small>
          </strong>
          <span>{approved} / 3 verification seals approved</span>
          <div
            role="progressbar"
            aria-label="Agent eligibility progress"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <i style={{ width: `${percent}%` }} />
          </div>
          <small>100% requires all three approvals.</small>
        </div>
      </div>
      <ol className="journey-stages" aria-label="Membership process">
        {[
          { label: "Member ID", note: me.ref, done: true },
          {
            label: "Own verification",
            note: me.status,
            done: me.status === "Approved",
          },
          {
            label: "Two direct members",
            note: `${[left, right].filter((m) => m?.status === "Approved").length}/2 approved`,
            done: left?.status === "Approved" && right?.status === "Approved",
          },
          {
            label: "Agent access",
            note: eligible ? "Same ID · unlocked" : "Locked until eligible",
            done: eligible,
          },
        ].map((step, i) => (
          <li key={step.label} className={step.done ? "done" : ""}>
            <span>{step.done ? <Check size={14} /> : `0${i + 1}`}</span>
            <div>
              <strong>{step.label}</strong>
              <small>{step.note}</small>
            </div>
          </li>
        ))}
      </ol>
      {compact ? (
        <div className="journey-compact-footer">
          <span>
            {accounts.current}/5 current · {accounts.savings}/2 savings ·{" "}
            {accounts.proofs}/7 bank proofs · {accounts.documents}/7 KYC files
          </span>
          <button className="link-button" onClick={() => visit("eligibility")}>
            View mandatory agent tasks <ArrowUpRight size={15} />
          </button>
        </div>
      ) : (
        <>
          <div className="journey-section-title">
            <div>
              <span className="eyebrow">FIRST SEAL / YOUR VERIFICATION</span>
              <h3>Mandatory member tasks</h3>
              <p>
                Saved details aur uploaded proofs ki checklist. Final
                verification administrator approve karega.
              </p>
            </div>
            <span>
              {preparation.checks.filter((c) => c.done).length}/
              {preparation.checks.length} prepared
            </span>
          </div>
          <div className="journey-task-list">
            {preparation.checks.map((task, i) => {
              const accountTask = /account|Bank proof/.test(task.label);
              const label =
                task.label === "Two registered contact references"
                  ? "Two registered SIM / contact references"
                  : task.label;
              return (
                <div
                  className={`journey-task ${task.done ? "done" : ""}`}
                  key={task.label}
                >
                  <span className="journey-task-number">
                    {task.done ? (
                      <Check size={15} />
                    ) : (
                      String(i + 1).padStart(2, "0")
                    )}
                  </span>
                  <div>
                    <strong>{label}</strong>
                    <small>
                      {task.done
                        ? "Saved / uploaded"
                        : "Pending — complete this requirement"}
                    </small>
                  </div>
                  <button
                    className="link-button"
                    onClick={() =>
                      visit(accountTask ? "accounts" : "onboarding")
                    }
                  >
                    {task.done
                      ? "View"
                      : accountTask
                        ? "Add / upload"
                        : "Complete"}
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              );
            })}
          </div>
          <div
            className={`journey-review ${me.status === "Approved" ? "done" : ""}`}
          >
            <ShieldCheck size={24} />
            <div>
              <strong>Administrator verification: {me.status}</strong>
              <p>
                {me.profile.reviewNote ||
                  (me.status === "Approved"
                    ? "Your own verification seal is approved."
                    : me.status === "In review"
                      ? "Profile submitted. Administrator ki review ka intezaar hai."
                      : "Checklist complete karke My onboarding se profile review ke liye submit karein.")}
              </p>
            </div>
            <button
              className="btn secondary"
              onClick={() => visit("onboarding")}
            >
              Open my onboarding
            </button>
          </div>
          <div className="journey-section-title">
            <div>
              <span className="eyebrow">
                SECOND & THIRD SEALS / YOUR BINARY TEAM
              </span>
              <h3>One left. One right.</h3>
              <p>
                Dono direct members ko bhi wahi onboarding aur admin
                verification complete karni hai. Sirf joining se eligibility
                nahi milegi.
              </p>
            </div>
            <Network size={26} />
          </div>
          <div className="journey-branches">
            {[left, right].map((member, i) => (
              <article
                className={member?.status === "Approved" ? "done" : ""}
                key={i}
              >
                <span className="eyebrow">
                  {i === 0 ? "LEFT" : "RIGHT"} POSITION
                </span>
                <h4>{member?.name || "Position open"}</h4>
                <span>{member?.ref || "Invite through your referral ID"}</span>
                <strong className="journey-branch-status">
                  {member?.status === "Approved" ? (
                    <Check size={16} />
                  ) : (
                    <LockKeyhole size={16} />
                  )}
                  {member?.status || "Member not joined"}
                </strong>
                {member && (
                  <p>
                    Preparation: {member.onboardingPercent || 0}% ·
                    Verification: {member.status}
                  </p>
                )}
                <button
                  className="btn secondary"
                  onClick={() => visit(member ? "network" : "invite")}
                >
                  {member ? "View binary position" : "Invite member"}
                  <ArrowUpRight size={15} />
                </button>
              </article>
            ))}
          </div>
          <div className="journey-unlock-note">
            <div>
              <strong>
                {eligible
                  ? "Agent permissions are active on your existing ID."
                  : "Agent permissions stay locked until all three seals are approved."}
              </strong>
              <p>
                Eligible agent approved team members ko work assign kar sakta
                hai. Approved transaction commissions, ranks aur incentives ka
                current rule Commissions & rewards mein dikhega.
              </p>
            </div>
            {eligible ? (
              <a className="btn primary" href="/agent/dashboard">
                Open agent panel <ArrowUpRight size={16} />
              </a>
            ) : (
              <button className="btn primary" onClick={() => visit(next)}>
                {nextLabel}
                <ArrowUpRight size={16} />
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
