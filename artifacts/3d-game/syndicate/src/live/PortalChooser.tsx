import { Building2, Network, ShieldCheck, ArrowUpRight } from "lucide-react";
import Link from "./EntryLink";
import { portalLabel, PORTALS, portalPath } from "./portals";
import { playEntrySound } from "./entry-audio";

export default function PortalChooser() {
  const details = {
    admin: {
      icon: ShieldCheck,
      text: "The administrator oversees verification, approvals and company operations. Existing owner access only.",
    },
    agent: {
      icon: Network,
      text: "Earned access: your approved profile and two approved direct members. Use your existing member ID.",
    },
    member: {
      icon: Building2,
      text: "Start here. Join with a referral ID, complete your verification and follow your path to agent eligibility.",
    },
  };
  return (
    <div
      className="portal-choices"
      onClick={(event) => {
        if ((event.target as Element).closest("a")) playEntrySound("click");
      }}
    >
      {PORTALS.map((portal) => {
        const Icon = details[portal].icon;
        return (
          <section className={`portal-choice portal-${portal}`} key={portal}>
            <Icon size={24} />
            <h2>{portalLabel(portal)} panel</h2>
            <p>{details[portal].text}</p>
            <Link className="btn primary" href={portalPath(portal, "login")}>
              {portalLabel(portal)} login <ArrowUpRight size={16} />
            </Link>
            {portal === "member" ? (
              <Link className="link-button" href="/member/signup">
                Member signup
              </Link>
            ) : (
              <small className="portal-access-note">
                {portal === "admin"
                  ? "Owner access · no signup"
                  : "Unlocked through member eligibility · no signup"}
              </small>
            )}
          </section>
        );
      })}
    </div>
  );
}
