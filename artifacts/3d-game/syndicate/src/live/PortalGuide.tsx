"use client";
import { useEffect, useState } from "react";
import { BookOpen, Play, Square, ArrowUpRight } from "lucide-react";
import { Panel } from "../App";
const steps = [
  {
    title: "Create your own login",
    page: "settings",
    text: "Apna email aur password use karke login banayein. Recovery code safe rakhein. Naya signup sirf member ka hota hai. Sponsor ki referral ID se join karein; admin signup aur alag agent signup nahi hai.",
  },
  {
    title: "Save banks and account proofs",
    page: "accounts",
    text: "My bank accounts mein 5 current aur 2 savings accounts ke bank, holder, last four digits aur registered contact chunein. Ek-ek account save kar sakte hain. Save ke baad usi account ka bank proof upload karein.",
  },
  {
    title: "Complete KYC and review",
    page: "onboarding",
    text: "Firm aur GST details, do registered contact references, shop, rent, electricity, identity, GST aur video KYC documents upload karein. Checklist poori hone par Submit complete profile dabayein. Admin ki approval ka status dashboard par dikhega.",
  },
  {
    title: "Your binary team and tasks",
    page: "eligibility",
    text: "Agent eligibility page par poori mandatory checklist aur teen verification seals dekhein. Har sponsor ki sirf left aur right do direct positions hain. Apni aur dono direct members ki onboarding approved hone par usi member ID par agent panel aur task assignment unlock hota hai. Members apna kaam submit karte hain aur assigner completion approve karta hai.",
  },
  {
    title: "Expenses, receipts and allowances",
    page: "expenses",
    text: "Record transaction se expense submit karein. Expenses and allowances mein receipt upload karein. Admin review ke baad hi amount ledger mein count hoga. Allowance admin selected member ke liye record karta hai; bank transfer alag process hai.",
  },
  {
    title: "Commission, rewards and reports",
    page: "rewards",
    text: "Approved business turnover par admin verified successful transaction count aur earned company fee se commission post karta hai. Current plan Commissions and rewards mein dikhega. Reports se day ya month chunein aur Excel ya PDF download karein.",
  },
];
export default function PortalGuide({
  visit,
}: {
  visit: (page: string) => void;
}) {
  const [step, setStep] = useState(0),
    [speaking, setSpeaking] = useState(false);
  useEffect(
    () => () => {
      window.speechSynthesis?.cancel();
    },
    [],
  );
  const current = steps[step];
  function stop() {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }
  return (
    <>
      <div className="info-banner">
        <BookOpen />
        <div>
          <strong>Follow the working portal, one step at a time.</strong>
          <p>
            This guide describes the forms and approval flows in your account.
            Narration uses your browser when available.
          </p>
        </div>
      </div>
      <div className="guide-layout">
        <Panel title="Your portal guide">
          <div className="live-form-pad form">
            {steps.map((s, i) => (
              <button
                key={s.title}
                className={`btn ${step === i ? "primary" : "secondary"}`}
                onClick={() => {
                  stop();
                  setStep(i);
                }}
              >
                {i + 1}. {s.title}
              </button>
            ))}
          </div>
        </Panel>
        <Panel
          title={current.title}
          eyebrow={`STEP ${step + 1} OF ${steps.length}`}
        >
          <div className="live-form-pad form">
            <p className="guide-copy">{current.text}</p>
            <div className="page-actions">
              <button
                className="btn secondary"
                onClick={() => {
                  if (speaking) {
                    stop();
                    return;
                  }
                  if (!window.speechSynthesis) return;
                  const narration = new SpeechSynthesisUtterance(current.text);
                  narration.lang = "hi-IN";
                  narration.rate = 0.9;
                  narration.onend = narration.onerror = () =>
                    setSpeaking(false);
                  window.speechSynthesis.speak(narration);
                  setSpeaking(true);
                }}
              >
                {speaking ? <Square size={15} /> : <Play size={15} />}
                {speaking ? "Stop narration" : "Listen to this step"}
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  stop();
                  visit(current.page);
                }}
              >
                Open this section <ArrowUpRight size={15} />
              </button>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
