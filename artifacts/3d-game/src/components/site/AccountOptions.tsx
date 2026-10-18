import {
  Activity,
  ArrowUpRight,
  CircleDollarSign,
  ClipboardList,
  Dices,
  KeyRound,
  ListChecks,
  ShieldCheck,
  SlidersHorizontal,
  Trophy,
} from "lucide-react";
import { Link } from "wouter";
import "./account.css";

export const ACCOUNT_OPTIONS = [
  {
    href: "/report/accountstatement",
    label: "Account Statement",
    icon: CircleDollarSign,
    description: "Credits, debits and wallet balance",
  },
  {
    href: "/report/currentbets",
    label: "Current Bets",
    icon: ListChecks,
    description: "Your bets awaiting settlement",
  },
  {
    href: "/report/activity",
    label: "Activity Log",
    icon: Activity,
    description: "Sign-ins and account activity",
  },
  {
    href: "/report/casinoresult",
    label: "Casino Results",
    icon: Dices,
    description: "Your settled casino rounds",
  },
  {
    href: "/report/livecasinoresult",
    label: "Live Casino Bets",
    icon: ClipboardList,
    description: "Your live table bets and results",
  },
  {
    href: "/report/sportbookresult",
    label: "SportBook Bets",
    icon: Trophy,
    description: "Your virtual sports and racing bets",
  },
  {
    href: "/settings/buttonvalue",
    label: "Set Button Value",
    icon: SlidersHorizontal,
    description: "Personalise your quick-bet amounts",
  },
  {
    href: "/settings/changepassword",
    label: "Change Password",
    icon: KeyRound,
    description: "Update your account password",
  },
  {
    href: "/settings/secureauth",
    label: "Security Auth Verification",
    icon: ShieldCheck,
    description: "Verify your password and manage devices",
  },
] as const;

export function AccountOptions() {
  return (
    <nav className="account-options" aria-label="Profile options">
      {ACCOUNT_OPTIONS.map(({ href, label, icon: Icon, description }) => (
        <Link key={href} href={href} className="account-option">
          <span className="account-option-icon">
            <Icon size={21} />
          </span>
          <span>
            <strong>{label}</strong>
            <small>{description}</small>
          </span>
          <ArrowUpRight size={16} />
        </Link>
      ))}
    </nav>
  );
}
