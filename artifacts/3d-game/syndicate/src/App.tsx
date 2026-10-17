import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRight,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Copy,
  Download,
  Eye,
  FileCheck2,
  FileText,
  GitFork,
  Globe2,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  MoreHorizontal,
  Play,
  Plus,
  Receipt,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Timer,
  TrendingUp,
  Upload,
  Users,
  Wallet,
  X,
  MapPin,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  CircleAlert,
  Building2,
  Video,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import {
  STORAGE,
  readData,
  cloneSeed,
  money,
  initials,
  direct,
  descendants,
  isAgent,
  log,
  dateLabel,
  requiredDocs,
  onboardingComplete,
  type Data,
  type Member,
  type Role,
  type Task,
} from "./model";

type Page =
  | "overview"
  | "network"
  | "onboarding"
  | "tasks"
  | "wallet"
  | "expenses"
  | "approvals"
  | "activity"
  | "guide"
  | "settings";
type Modal =
  | "invite"
  | "task"
  | "expense"
  | "allowance"
  | "notifications"
  | "member"
  | "reset"
  | null;
const pageTitles: Record<Page, string> = {
  overview: "Overview",
  network: "My network",
  onboarding: "Onboarding & KYC",
  tasks: "Task workspace",
  wallet: "Accounts & ledger",
  expenses: "Expense requests",
  approvals: "Approval center",
  activity: "Activity & access",
  guide: "Getting started",
  settings: "Workspace settings",
};
const nav: {
  id: Page;
  label: string;
  icon: LucideIcon;
  group: string;
  admin?: boolean;
}[] = [
  {
    id: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    group: "WORKSPACE",
  },
  { id: "network", label: "My network", icon: GitFork, group: "WORKSPACE" },
  {
    id: "onboarding",
    label: "Onboarding & KYC",
    icon: ShieldCheck,
    group: "WORKSPACE",
  },
  {
    id: "tasks",
    label: "Task workspace",
    icon: ClipboardList,
    group: "WORKSPACE",
  },
  {
    id: "wallet",
    label: "Accounts & ledger",
    icon: Wallet,
    group: "MANAGEMENT",
  },
  { id: "expenses", label: "Expenses", icon: Receipt, group: "MANAGEMENT" },
  {
    id: "approvals",
    label: "Approval center",
    icon: FileCheck2,
    group: "MANAGEMENT",
    admin: true,
  },
  {
    id: "activity",
    label: "Activity & access",
    icon: Globe2,
    group: "MANAGEMENT",
  },
];

export function Emblem({
  className = "",
  viewBox = "0 0 160 148",
}: {
  className?: string;
  viewBox?: string;
}) {
  return (
    <svg className={className} viewBox={viewBox} fill="none" aria-hidden="true">
      <path d="M80 8 153 135H7L80 8Z" stroke="currentColor" strokeWidth="2" />
      <path
        d="m80 28 56 97H24L80 28Z"
        stroke="currentColor"
        strokeWidth=".7"
        opacity=".42"
      />
      <path
        d="m80 8 0 127M7 135l107-59M153 135 46 76"
        stroke="currentColor"
        strokeWidth=".5"
        opacity=".16"
      />
      <path
        d="M45 89s14-19 35-19 35 19 35 19-14 19-35 19-35-19-35-19Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx="80" cy="89" r="13" stroke="currentColor" strokeWidth="2" />
      <circle cx="80" cy="89" r="5" fill="currentColor" />
      <path
        d="M80 54v7M53 63l5 6M107 63l-5 6M80 116v7"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}
function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className="icon-btn"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className={`badge ${tone}`}>
      <i />
      {children}
    </span>
  );
}
export function Avatar({
  name,
  size = "normal",
  gold = false,
}: {
  name: string;
  size?: string;
  gold?: boolean;
}) {
  return (
    <span className={`avatar ${size} ${gold ? "gold" : ""}`}>
      {initials(name)}
    </span>
  );
}
export function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty">
      <ClipboardList size={28} />
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}
export function Panel({
  title,
  eyebrow,
  action,
  children,
  className = "",
}: {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const el = ref.current!;
    const focusables = () =>
      Array.from(
        el.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, [tabindex="0"]',
        ),
      ).filter((x) => !x.hasAttribute("disabled"));
    focusables()[0]?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const f = focusables();
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === f.at(-1)) {
          e.preventDefault();
          f[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    return () => {
      document.removeEventListener("keydown", listener);
      previous?.focus();
    };
  }, [close]);
  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <h2>{title}</h2>
          <IconButton label="Close dialog" onClick={close}>
            <X size={20} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Tree({
  data,
  root,
  onMember,
  invite,
  compact = false,
  nodeDetails,
  roleLabel,
}: {
  data: Data;
  root: string;
  onMember: (m: Member) => void;
  invite: () => void;
  compact?: boolean;
  nodeDetails?: (m: Member) => ReactNode;
  roleLabel?: (m: Member) => string;
}) {
  const [zoom, setZoom] = useState(1);
  const treeScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = treeScroll.current;
    if (!element) return;
    const center = () => {
      element.scrollLeft = Math.max(
        0,
        (element.scrollWidth - element.clientWidth) / 2,
      );
    };
    center();
    const observer = new ResizeObserver(center);
    observer.observe(element);
    return () => observer.disconnect();
  }, [root, zoom, compact]);
  const m = data.members.find((m) => m.id === root)!;
  function node(
    member: Member | undefined,
    level: number,
    key: string,
  ): ReactNode {
    return (
      <div className={`tree-branch level-${level}`} key={key}>
        <div className="node-wrap">
          {member ? (
            <button
              className={`tree-node ${level === 0 ? "root-node" : ""}`}
              onClick={() => onMember(member)}
            >
              <Avatar
                name={member.name}
                size={compact ? "small" : "normal"}
                gold={level === 0}
              />
              <strong>{member.name}</strong>
              <span>
                {roleLabel
                  ? roleLabel(member)
                  : isAgent(data, member.id)
                    ? "Agent"
                    : "Member"}{" "}
                <i
                  className={
                    member.kyc === "Verified" ? "verified-dot" : "pending-dot"
                  }
                />
              </span>
              <small>Own ID: {member.ref}</small>
              {nodeDetails?.(member)}
            </button>
          ) : (
            <button className="tree-node vacant" onClick={invite}>
              <span className="vacant-plus">
                <Plus size={20} />
              </span>
              <strong>Open position</strong>
              <span>Invite a member</span>
            </button>
          )}
        </div>
        {member && level < 2 && (
          <div className="tree-children">
            {(["left", "right"] as const).map((side) =>
              node(
                data.members.find(
                  (c) => c.parent === member.id && c.side === side,
                ),
                level + 1,
                `${key}-${side}`,
              ),
            )}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={`tree ${compact ? "compact" : ""}`}>
      <div className="tree-tools">
        <span>
          <i className="verified-dot" />
          Verified <i className="pending-dot" />
          In review
        </span>
        {!compact && (
          <div className="zoom">
            <button
              onClick={() => setZoom(Math.max(0.65, zoom - 0.1))}
              aria-label="Zoom out"
            >
              −
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom(Math.min(1.3, zoom + 0.1))}
              aria-label="Zoom in"
            >
              +
            </button>
          </div>
        )}
      </div>
      <div className="tree-scroll" ref={treeScroll}>
        <div className="tree-canvas" style={{ zoom }}>
          {node(m, 0, "root")}
        </div>
      </div>
      <div className="branch-labels">
        <span>
          LEFT TEAM{" "}
          <strong>
            {descendants(
              data,
              data.members.find((x) => x.parent === root && x.side === "left")
                ?.id || "none",
            ).length +
              (data.members.some((x) => x.parent === root && x.side === "left")
                ? 1
                : 0)}{" "}
            members
          </strong>
        </span>
        <span>
          RIGHT TEAM{" "}
          <strong>
            {descendants(
              data,
              data.members.find((x) => x.parent === root && x.side === "right")
                ?.id || "none",
            ).length +
              (data.members.some((x) => x.parent === root && x.side === "right")
                ? 1
                : 0)}{" "}
            members
          </strong>
        </span>
      </div>
    </div>
  );
}

const guideSteps = [
  {
    title: "Your journey starts here.",
    label: "WELCOME TO SYNDICATE",
    text: "Apne upline ki referral ID se demo profile banayein. Dashboard par aapka sponsor, joining status aur agla step dikhega.",
    icon: Emblem,
  },
  {
    title: "Build your business profile.",
    label: "01 / BUSINESS SETUP",
    text: "Pehle shop dhoondhein aur firm ki details tayyar karein. Rent agreement, electricity bill aur identity proof ki checklist complete karein.",
    icon: Building2,
  },
  {
    title: "Complete your verification.",
    label: "02 / KYC CHECKLIST",
    text: "Paanch business current accounts ke demo records aur video KYC sample add karein. Admin approval ke baad hi upline work tasks assign kar sakta hai.",
    icon: ShieldCheck,
  },
  {
    title: "Two positions. One team.",
    label: "03 / YOUR NETWORK",
    text: "Har member ke neeche left aur right, maximum do direct positions hain. Apni referral ID se jude do verified members aur apni approved KYC se agent eligibility complete hoti hai.",
    icon: GitFork,
  },
  {
    title: "Make every task count.",
    label: "04 / TEAM WORKSPACE",
    text: "User apne assigned tasks complete karta hai. Eligible agent apni verified downline ko tasks assign kar sakta hai. Kaam submit karein aur review status dekhein.",
    icon: ClipboardList,
  },
  {
    title: "One clear view of your accounts.",
    label: "05 / EXPENSES & APPROVALS",
    text: "Agent expense receipt submit karega. Admin har kharch aur allowance ko review karega. Pay in aur pay out demo ledger mein dikhenge. Commission ka rule abhi tay nahi hai.",
    icon: Wallet,
  },
];
function Guide() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [voice, setVoice] = useState(false);
  const s = guideSteps[step];
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(
      () =>
        setStep((v) => {
          if (v >= guideSteps.length - 1) {
            setPlaying(false);
            return v;
          }
          return v + 1;
        }),
      15000,
    );
    return () => clearInterval(id);
  }, [playing, step]);
  useEffect(() => {
    if (playing && voice && "speechSynthesis" in window) {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(s.text);
      utterance.lang = "hi-IN";
      utterance.rate = 0.86;
      speechSynthesis.speak(utterance);
    }
    return () => {
      if ("speechSynthesis" in window) speechSynthesis.cancel();
    };
  }, [step, playing, voice, s.text]);
  return (
    <div className="guide-layout">
      <section className="guide-player">
        <div className="guide-screen" key={step}>
          <div className="guide-orbit" />
          <div className="eyebrow">{s.label}</div>
          <s.icon className="guide-icon" />
          <h2>{s.title}</h2>
          <p>{s.text}</p>
          <span className="guide-watermark">
            SYNDICATE / MEMBER ORIENTATION
          </span>
        </div>
        <div className="guide-progress">
          {guideSteps.map((_, i) => (
            <button
              key={i}
              aria-label={`Go to chapter ${i + 1}`}
              className={i <= step ? "active" : ""}
              onClick={() => setStep(i)}
            />
          ))}
        </div>
        <div className="guide-controls">
          <IconButton
            label={playing ? "Pause guide" : "Play guide"}
            onClick={() => {
              if (step === 5 && !playing) setStep(0);
              setPlaying(!playing);
            }}
          >
            {playing ? <Pause size={19} /> : <Play size={19} />}
          </IconButton>
          <span>
            Chapter {step + 1} / 6 <small>Interactive Hindi guide</small>
          </span>
          <div className="spacer" />
          <IconButton
            label={voice ? "Mute narration" : "Enable browser narration"}
            onClick={() => setVoice(!voice)}
          >
            {voice ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </IconButton>
          <IconButton
            label="Previous chapter"
            onClick={() => setStep(Math.max(0, step - 1))}
          >
            <ChevronLeft size={19} />
          </IconButton>
          <IconButton
            label="Next chapter"
            onClick={() => setStep(Math.min(5, step + 1))}
          >
            <ChevronRight size={19} />
          </IconButton>
        </div>
      </section>
      <Panel title="A clear path forward" eyebrow="MEMBER HANDBOOK">
        <div className="guide-chapters">
          {guideSteps.map((g, i) => (
            <button
              onClick={() => setStep(i)}
              className={i === step ? "active" : ""}
              key={g.title}
            >
              <span>0{i + 1}</span>
              <div>
                <strong>{g.title}</strong>
                <small>{i === step ? "Now viewing" : "View chapter"}</small>
              </div>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
        <div className="subtle-note">
          Browser narration is optional and depends on installed Hindi voices.
          This walkthrough uses demo workflows.
        </div>
      </Panel>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<Data>(readData);
  const [screen, setScreen] = useState<"gate" | "login" | "signup" | "portal">(
    "gate",
  );
  const [taps, setTaps] = useState(0);
  const [role, setRole] = useState<Role>("agent");
  const [userId, setUserId] = useState("m3");
  const [agentId, setAgentId] = useState("m1");
  const [page, setPage] = useState<Page>("overview");
  const [modal, setModal] = useState<Modal>(null);
  const [selected, setSelected] = useState<Member | null>(null);
  const [toast, setToast] = useState("");
  const [mobile, setMobile] = useState(false);
  const [query, setQuery] = useState("");
  const [taskFilter, setTaskFilter] = useState("All tasks");
  const [financeFilter, setFinanceFilter] = useState("All transactions");
  const [treeRoot, setTreeRoot] = useState("m1");
  const [locationStatus, setLocationStatus] = useState("Not shared");
  const [signupError, setSignupError] = useState("");
  const [fileError, setFileError] = useState("");
  const actor =
    role === "user"
      ? data.members.find((x) => x.id === userId) || data.members[2]
      : data.members.find(
          (x) => x.id === (role === "agent" ? agentId : "m1"),
        ) || data.members[0];
  const actorName = role === "admin" ? "Admin" : actor.name;
  const scope =
    role === "admin"
      ? data.members
      : role === "agent"
        ? [actor, ...descendants(data, actor.id)]
        : [actor];
  const scopeIds = scope.map((m) => m.id);
  const myNetwork = descendants(data, actor.id);
  const scopedTasks = data.tasks.filter(
    (t) =>
      role === "admin" ||
      (role === "agent" && scopeIds.includes(t.assignee)) ||
      t.assignee === actor.id,
  );
  const scopedExpenses = data.expenses.filter(
    (e) => role === "admin" || e.member === actor.id,
  );
  const pendingKyc = data.members.filter((m) => m.kyc === "In review");
  const pendingExpenses = data.expenses.filter((e) => e.status === "Pending");
  const eligible = isAgent(data, actor.id);
  const verifiedDirect = direct(data, actor.id).filter(
    (m) => m.kyc === "Verified",
  ).length;
  const notify = (s: string) => setToast(s);
  const go = (p: Page) => {
    setPage(p);
    setMobile(false);
    setQuery("");
  };
  function update(fn: (d: Data) => void) {
    setData((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  }
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(data));
    } catch {
      setToast(
        "Browser storage is full. Changes will last only for this session.",
      );
    }
  }, [data]);
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key === STORAGE) setData(readData());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify("Referral copied to clipboard");
    } catch {
      notify(`Your referral ID: ${actor.ref}`);
    }
  };
  function kycReview(id: string, approved: boolean) {
    if (role !== "admin") return;
    update((d) => {
      const m = d.members.find((x) => x.id === id)!;
      m.kyc = approved ? "Verified" : "Changes requested";
      log(
        d,
        approved ? "KYC approved" : "KYC changes requested",
        `${m.name} · ${approved ? "Verification complete." : "Please review and resubmit your checklist."}`,
        id,
        "kyc",
      );
    });
    notify(
      approved
        ? "KYC approved. Team eligibility updated."
        : "Changes requested. Member can resubmit.",
    );
    setSelected(null);
    setModal(null);
  }
  function expenseReview(id: string, approved: boolean) {
    if (role !== "admin") return;
    update((d) => {
      const e = d.expenses.find((e) => e.id === id);
      if (!e || e.status !== "Pending") return;
      e.status = approved ? "Approved" : "Rejected";
      e.note = approved
        ? "Approved by administrator."
        : "Please check the receipt and submit a new request.";
      log(
        d,
        `Expense ${e.status.toLowerCase()}`,
        `${e.title} · ${money(e.amount)}`,
        e.member,
        "expense",
      );
      if (approved)
        d.ledger.unshift({
          id: crypto.randomUUID(),
          member: e.member,
          title: e.title,
          amount: e.amount,
          type: "Pay out",
          status: "Approved",
          date: new Date().toISOString(),
        });
    });
    notify(
      approved
        ? "Expense approved and added to the demo ledger."
        : "Expense rejected.",
    );
  }
  function transitionTask(t: Task, status: Task["status"]) {
    const canReview =
      role === "admin" || (role === "agent" && t.by === actor.id);
    const canWork = role !== "admin" && t.assignee === actor.id;
    if (
      (status === "Complete" && !canReview) ||
      (status !== "Complete" && !canWork)
    )
      return;
    update((d) => {
      const task = d.tasks.find((x) => x.id === t.id)!;
      task.status = status;
      log(d, `Task ${status.toLowerCase()}`, task.title, task.assignee, "task");
    });
    notify(`Task moved to ${status.toLowerCase()}.`);
  }
  function addTask(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const assignee = String(f.get("assignee"));
    const target = data.members.find((m) => m.id === assignee);
    if (
      !target ||
      target.kyc !== "Verified" ||
      !(
        role === "admin" ||
        (role === "agent" &&
          eligible &&
          myNetwork.some((m) => m.id === assignee))
      )
    )
      return notify("Choose a verified member in your downline.");
    update((d) => {
      d.tasks.unshift({
        id: crypto.randomUUID(),
        title: String(f.get("title")).trim(),
        description: String(f.get("description")),
        assignee,
        by: role === "admin" ? "admin" : actor.id,
        due: String(f.get("due")),
        priority: String(f.get("priority")),
        status: "To do",
      });
      log(
        d,
        "New task assigned",
        `${f.get("title")} → ${target.name}`,
        assignee,
        "task",
      );
    });
    setModal(null);
    notify("Task assigned to the selected member.");
  }
  function addExpense(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const amount = Number(f.get("amount"));
    const file = f.get("receipt") as File;
    if (
      role === "user" ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > 10000000
    )
      return notify("Enter a valid amount.");
    if (
      !file?.name ||
      file.size > 10 * 1024 * 1024 ||
      !/\.(pdf|png|jpe?g)$/i.test(file.name)
    )
      return notify("Choose a sample receipt under 10 MB.");
    update((d) => {
      d.expenses.unshift({
        id: crypto.randomUUID(),
        member: actor.id,
        title: String(f.get("title")).trim(),
        category: String(f.get("category")),
        amount,
        receipt: file.name,
        status: "Pending",
        date: new Date().toISOString(),
        note: "",
      });
      log(
        d,
        "Expense submitted",
        `${f.get("title")} · ${money(amount)}`,
        actor.id,
        "expense",
      );
    });
    setModal(null);
    notify("Expense sent to the admin approval queue.");
  }
  function addAllowance(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (role !== "admin") return;
    const f = new FormData(e.currentTarget);
    const amount = Number(f.get("amount"));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000)
      return notify("Enter a valid amount.");
    update((d) => {
      const member = String(f.get("member"));
      d.ledger.unshift({
        id: crypto.randomUUID(),
        member,
        title: String(f.get("title")),
        amount,
        type: "Pay in",
        status: "Approved",
        date: new Date().toISOString(),
      });
      log(
        d,
        "Allowance approved",
        `${f.get("title")} · ${money(amount)}`,
        member,
        "allowance",
      );
    });
    setModal(null);
    notify("Demo allowance recorded. No money was transferred.");
  }
  function signup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const sponsor = data.members.find(
      (m) => m.ref === String(f.get("ref")).trim().toUpperCase(),
    );
    if (!sponsor)
      return setSignupError(
        "Referral ID not found. Try SYN-KABIR for the demo.",
      );
    const children = direct(data, sponsor.id);
    if (children.length >= 2)
      return setSignupError(
        "This sponsor has both positions filled. Try SYN-KABIR for an open position.",
      );
    const name = String(f.get("name")).trim();
    if (name.length < 2) return setSignupError("Please enter a demo name.");
    const id = crypto.randomUUID();
    update((d) => {
      d.members.push({
        id,
        name,
        city: String(f.get("city")).trim(),
        ref: `SYN-${id.slice(0, 6).toUpperCase()}`,
        parent: sponsor.id,
        side: children.some((m) => m.side === "left") ? "right" : "left",
        kyc: "Not started",
        joined: new Date().toISOString(),
        documents: {},
        accounts: [],
        video: false,
        consent: false,
      });
      log(
        d,
        "New demo profile created",
        `${name} joined through ${sponsor.ref}`,
        id,
        "member",
      );
    });
    setUserId(id);
    setRole("user");
    setPage("onboarding");
    setScreen("portal");
    notify("Demo profile created. Complete your onboarding checklist.");
  }
  function exportLedger() {
    const rows = data.ledger.filter(
      (l) => role === "admin" || l.member === actor.id,
    );
    const csv = [
      ["Reference", "Description", "Type", "Amount INR", "Status", "Date"],
      ...rows.map((l) => [l.id, l.title, l.type, l.amount, l.status, l.date]),
    ]
      .map((row) =>
        row
          .map(
            (v) =>
              `"${String(v)
                .replace(/^[=+@-]/, "'$&")
                .replaceAll('"', '""')}"`,
          )
          .join(","),
      )
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "syndicate-demo-ledger.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Demo ledger exported.");
  }
  function pickDoc(key: string, file: File | undefined) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024 || !/\.(pdf|png|jpe?g)$/i.test(file.name))
      return setFileError("Use a sample PDF, PNG or JPG under 10 MB.");
    setFileError("");
    update((d) => {
      const m = d.members.find((m) => m.id === actor.id)!;
      m.documents[key] = file.name;
    });
  }
  const leftMember = direct(data, actor.id).find((m) => m.side === "left");
  const rightMember = direct(data, actor.id).find((m) => m.side === "right");
  const allowedRoot =
    role === "admin" || scopeIds.includes(treeRoot) ? treeRoot : actor.id;
  const selectedNow = selected
    ? data.members.find((m) => m.id === selected.id)
    : null;
  const searchable = (s: string) =>
    s.toLowerCase().includes(query.toLowerCase());
  const canAssign = role === "admin" || (role === "agent" && eligible);
  const viewMember = (m: Member) => {
    setSelected(m);
    setModal("member");
  };

  if (screen !== "portal")
    return (
      <div className="entry-shell">
        <header className="entry-header">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setScreen("gate");
              setTaps(0);
            }}
            className="brand"
          >
            <Emblem />
            <span>
              SYNDICATE<small>MEMBER OPERATIONS</small>
            </span>
          </a>
          <span className="entry-private">
            <LockKeyhole size={13} /> PRIVATE NETWORK
          </span>
        </header>
        <main className="entry-main">
          {screen === "gate" ? (
            <>
              <div className="entry-orbit orbit-one" />
              <div className="entry-orbit orbit-two" />
              <span className="eyebrow">CONNECTED BY PURPOSE</span>
              <button
                className="emblem-gate"
                aria-label="Tap the symbol to unlock member access"
                onClick={() => {
                  const next = taps + 1;
                  setTaps(next);
                  if (next === 5) setScreen("login");
                }}
              >
                <Emblem />
                <span className="emblem-glow" />
              </button>
              <h1>
                One vision.
                <br />
                <span>A stronger network.</span>
              </h1>
              <p>
                A private workspace for your people, progress
                <br className="desktop-only" /> and everything you build
                together.
              </p>
              <div className="tap-dots" aria-live="polite">
                {Array.from({ length: 5 }, (_, i) => (
                  <i key={i} className={i < taps ? "filled" : ""} />
                ))}
                <span>
                  {taps === 0
                    ? "Tap the symbol 5 times to enter"
                    : `${taps} of 5 · Keep going`}
                </span>
              </div>
              <div className="entry-features">
                <span>
                  <ShieldCheck size={15} /> Verified members
                </span>
                <span>
                  <GitFork size={15} /> Connected teams
                </span>
                <span>
                  <Eye size={15} /> Clear oversight
                </span>
              </div>
            </>
          ) : screen === "login" ? (
            <div className="login-card">
              <div className="small-emblem">
                <Emblem />
              </div>
              <span className="eyebrow">MEMBER ACCESS</span>
              <h1>Welcome to the circle.</h1>
              <p>Choose a role to explore your workspace.</p>
              <div className="demo-label">
                <Sparkles size={15} /> Frontend preview · sample data only
              </div>
              <div className="role-options">
                {(
                  [
                    {
                      r: "admin",
                      title: "Admin",
                      text: "Oversee, review & approve",
                      icon: ShieldCheck,
                    },
                    {
                      r: "agent",
                      title: "Agent",
                      text: "Manage your team & work",
                      icon: GitFork,
                    },
                    {
                      r: "user",
                      title: "Member",
                      text: "Onboard & track your progress",
                      icon: Users,
                    },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.r}
                    className={role === o.r ? "selected" : ""}
                    onClick={() => setRole(o.r)}
                  >
                    <o.icon size={21} />
                    <strong>{o.title}</strong>
                    <small>{o.text}</small>
                    {role === o.r && (
                      <CheckCircle2 className="role-check" size={15} />
                    )}
                  </button>
                ))}
              </div>
              <div className="login-profile">
                <Avatar
                  name={
                    role === "admin"
                      ? "Workspace Admin"
                      : role === "agent"
                        ? "Aarav Sharma"
                        : "Kabir Verma"
                  }
                  gold
                />
                <div>
                  <strong>
                    {role === "admin"
                      ? "Workspace Administrator"
                      : role === "agent"
                        ? "Aarav Sharma"
                        : "Kabir Verma"}
                  </strong>
                  <span>
                    {role === "admin"
                      ? "ADMIN-001"
                      : role === "agent"
                        ? "SYN-AARAV"
                        : "SYN-KABIR"}{" "}
                    · Demo profile
                  </span>
                </div>
                <LockKeyhole size={17} />
              </div>
              <button
                className="btn primary full"
                onClick={() => {
                  setScreen("portal");
                  setPage("overview");
                  setUserId("m3");
                  setAgentId("m1");
                }}
              >
                Open {role === "user" ? "member" : role} dashboard{" "}
                <ArrowRight size={17} />
              </button>
              <p className="login-bottom">
                New to the network?{" "}
                <button
                  className="text-button"
                  onClick={() => {
                    setScreen("signup");
                    setSignupError("");
                  }}
                >
                  Create a demo profile
                </button>
              </p>
              <small className="muted">
                The symbol reveals this preview. Production authentication is
                not connected.
              </small>
            </div>
          ) : (
            <div className="login-card signup-card">
              <span className="eyebrow">YOUR FIRST STEP</span>
              <h1>Join the network.</h1>
              <p>Create a sample profile using your upline’s referral ID.</p>
              <form onSubmit={signup} className="form">
                <label>
                  Demo full name
                  <input
                    name="name"
                    placeholder="e.g. Dev Malhotra"
                    required
                    minLength={2}
                    maxLength={60}
                  />
                </label>
                <label>
                  City
                  <input
                    name="city"
                    placeholder="e.g. New Delhi"
                    required
                    maxLength={60}
                  />
                </label>
                <label>
                  Upline referral ID
                  <input
                    name="ref"
                    defaultValue={
                      new URLSearchParams(location.search).get("ref") ||
                      "SYN-KABIR"
                    }
                    required
                    maxLength={30}
                  />
                </label>
                <div className="info-note">
                  <ShieldCheck size={18} />
                  <p>
                    Use sample details. This creates a provisional profile; KYC
                    approval unlocks assigned work.
                  </p>
                </div>
                {signupError && (
                  <p className="error" role="alert">
                    {signupError}
                  </p>
                )}
                <button className="btn primary full" type="submit">
                  Create demo profile <ArrowRight size={16} />
                </button>
              </form>
              <button
                className="text-button back-link"
                onClick={() => setScreen("login")}
              >
                <ChevronLeft size={15} />
                Back to member access
              </button>
            </div>
          )}
        </main>
        <footer className="entry-footer">
          <span>© 2026 SYNDICATE</span>
          <span>TRUST. STRUCTURE. PROGRESS.</span>
          <span>Frontend demo</span>
        </footer>
      </div>
    );

  return (
    <div className="app-shell">
      {mobile && (
        <div className="sidebar-scrim" onClick={() => setMobile(false)} />
      )}
      <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
        <button className="brand" onClick={() => go("overview")}>
          <Emblem />
          <span>
            SYNDICATE<small>MEMBER OPERATIONS</small>
          </span>
        </button>
        <div className="workspace-switch">
          <span className="workspace-icon">
            <Emblem />
          </span>
          <div>
            <strong>Core workspace</strong>
            <small>
              <i /> Private network
            </small>
          </div>
          <ChevronDown size={15} />
        </div>
        <nav>
          {["WORKSPACE", "MANAGEMENT"].map((group) => (
            <div className="nav-group" key={group}>
              <div className="nav-label">{group}</div>
              {nav
                .filter(
                  (n) => n.group === group && (!n.admin || role === "admin"),
                )
                .map((n) => (
                  <button
                    key={n.id}
                    className={`nav-item ${page === n.id ? "active" : ""}`}
                    onClick={() => go(n.id)}
                  >
                    <n.icon size={18} />
                    <span>{n.label}</span>
                    {n.id === "tasks" && (
                      <small>
                        {
                          scopedTasks.filter((t) => t.status !== "Complete")
                            .length
                        }
                      </small>
                    )}
                    {n.id === "approvals" && (
                      <small>
                        {pendingKyc.length + pendingExpenses.length}
                      </small>
                    )}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="orientation-card">
            <span className="orientation-icon">
              <Play size={15} fill="currentColor" />
            </span>
            <strong>New to the network?</strong>
            <p>Your next step, made simple.</p>
            <button onClick={() => go("guide")}>
              Watch the walkthrough <ArrowUpRight size={15} />
            </button>
          </div>
          <button
            className={`nav-item ${page === "settings" ? "active" : ""}`}
            onClick={() => go("settings")}
          >
            <Settings2 size={18} />
            <span>Workspace settings</span>
          </button>
          <div className="sidebar-profile">
            <Avatar
              name={role === "admin" ? "Workspace Admin" : actor.name}
              gold
            />
            <div>
              <strong>
                {role === "admin" ? "Workspace Admin" : actor.name}
              </strong>
              <span>
                {role === "admin"
                  ? "Administrator"
                  : role === "agent"
                    ? "Verified agent"
                    : "Member"}{" "}
                <i />
              </span>
            </div>
            <IconButton
              label="Sign out of demo"
              onClick={() => {
                setScreen("gate");
                setTaps(0);
              }}
            >
              <LogOut size={16} />
            </IconButton>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-btn"
              onClick={() => setMobile(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{pageTitles[page]}</strong>
          </div>
          <div className="topbar-actions">
            <span className="local-status">
              <i /> Local demo
            </span>
            <div className="role-switch">
              <span>Preview as</span>
              <select
                aria-label="Preview role"
                value={role}
                onChange={(e) => {
                  setRole(e.target.value as Role);
                  setPage("overview");
                  setQuery("");
                }}
              >
                <option value="agent">Agent</option>
                <option value="admin">Admin</option>
                <option value="user">Member</option>
              </select>
            </div>
            <IconButton
              label="Notifications"
              onClick={() => setModal("notifications")}
            >
              <Bell size={18} />
              <i className="notification-dot" />
            </IconButton>
            <Avatar
              name={role === "admin" ? "Workspace Admin" : actor.name}
              size="small"
              gold
            />
          </div>
        </header>
        <main className="content">
          <div className="page-header">
            <div>
              <div className="eyebrow">
                {role === "admin"
                  ? "ADMINISTRATOR CONSOLE"
                  : role === "agent"
                    ? "AGENT WORKSPACE"
                    : "MEMBER WORKSPACE"}{" "}
                <span>/</span>{" "}
                {page === "overview" ? "YOUR NETWORK AT A GLANCE" : "SYNDICATE"}
              </div>
              <h1>
                {page === "overview"
                  ? `Welcome back, ${actorName.split(" ")[0]}.`
                  : pageTitles[page]}
                {page === "overview" && <span className="greeting-dot" />}
              </h1>
              <p>
                {page === "overview"
                  ? "A clear view of your team, your progress and what’s next."
                  : (
                      {
                        network:
                          "Every connection has a place. Explore your left and right teams.",
                        onboarding:
                          "Build a verified profile, one step at a time.",
                        tasks:
                          "Keep the work moving, from assignment to approval.",
                        wallet:
                          "A transparent record of allowances, pay in and pay out.",
                        expenses:
                          "Document every expense. Keep every approval in one place.",
                        approvals:
                          "Review the details. Make every decision count.",
                        activity:
                          "Your workspace history and permission controls.",
                        guide:
                          "Everything you need to understand your next step.",
                        settings:
                          "A few simple controls for your demo workspace.",
                      } as Record<string, string>
                    )[page]}
              </p>
            </div>
            <div className="page-actions">
              {page === "overview" ? (
                <>
                  <button className="btn secondary" onClick={() => go("guide")}>
                    <Play size={15} /> How it works
                  </button>
                  <button
                    className="btn primary"
                    onClick={() => setModal("invite")}
                  >
                    <Plus size={16} /> Invite member
                  </button>
                </>
              ) : page === "tasks" && canAssign ? (
                <button
                  className="btn primary"
                  onClick={() => setModal("task")}
                >
                  <Plus size={16} /> Assign task
                </button>
              ) : page === "expenses" && role !== "user" ? (
                <button
                  className="btn primary"
                  onClick={() => setModal("expense")}
                >
                  <Plus size={16} /> Submit expense
                </button>
              ) : page === "wallet" ? (
                <button className="btn secondary" onClick={exportLedger}>
                  <Download size={16} /> Export ledger
                </button>
              ) : page === "network" ? (
                <button
                  className="btn primary"
                  onClick={() => setModal("invite")}
                >
                  <Plus size={16} /> Invite member
                </button>
              ) : null}
            </div>
          </div>

          {page === "overview" && (
            <>
              <section className="welcome-banner">
                <div className="banner-seal">
                  <Emblem />
                </div>
                <div>
                  <span className="eyebrow">
                    {role === "admin"
                      ? "EVERY DETAIL, CONNECTED"
                      : eligible
                        ? "YOUR FOUNDATION IS STRONG"
                        : "YOUR NEXT CHAPTER STARTS HERE"}
                  </span>
                  <h2>
                    {role === "admin"
                      ? "One workspace. Complete oversight."
                      : eligible
                        ? "Your team is complete. Keep moving forward."
                        : "Build your profile. Grow your team."}
                  </h2>
                  <p>
                    {role === "admin"
                      ? `${pendingKyc.length} KYC review and ${pendingExpenses.length} expense requests are waiting for your decision.`
                      : eligible
                        ? "Both direct positions are verified. Your agent workspace is ready."
                        : `${verifiedDirect} of 2 verified direct members · Complete KYC and both positions to become eligible.`}
                  </p>
                </div>
                <button
                  className="banner-link"
                  onClick={() => go(role === "admin" ? "approvals" : "network")}
                >
                  {role === "admin" ? "Review requests" : "View my network"}{" "}
                  <ArrowRight size={17} />
                </button>
                <Emblem className="banner-art" />
              </section>
              <div className="stats-grid">
                {[
                  {
                    label:
                      role === "admin" ? "Total members" : "Network members",
                    value:
                      role === "admin" ? data.members.length : myNetwork.length,
                    sub:
                      role === "admin"
                        ? "Across your workspace"
                        : "In your connected team",
                    icon: Users,
                    foot: `${role === "admin" ? data.members.filter((m) => m.kyc === "Verified").length : myNetwork.filter((m) => m.kyc === "Verified").length} verified members`,
                    tone: "green",
                    bars: [20, 32, 26, 43, 35, 49, 56, 65],
                  },
                  {
                    label: "Direct team",
                    value: `${direct(data, actor.id).length} / 2`,
                    sub: "Left & right positions",
                    icon: GitFork,
                    foot: eligible
                      ? "Team qualification complete"
                      : "Build your direct team",
                    tone: eligible ? "green" : "gold",
                    bars: [18, 18, 32, 32, 48, 48, 64, 64],
                  },
                  {
                    label: "Active tasks",
                    value: scopedTasks.filter((t) => t.status !== "Complete")
                      .length,
                    sub: "Keep your work on track",
                    icon: ClipboardList,
                    foot: `${scopedTasks.filter((t) => t.status === "In review").length} awaiting review`,
                    tone: "gold",
                    bars: [53, 43, 60, 40, 50, 30, 42, 28],
                  },
                  {
                    label: "Expense requests",
                    value: money(
                      scopedExpenses
                        .filter((e) => e.status === "Pending")
                        .reduce((a, e) => a + e.amount, 0),
                    ),
                    sub: "Pending admin approval",
                    icon: Receipt,
                    foot: `${scopedExpenses.filter((e) => e.status === "Pending").length} requests in queue`,
                    tone: "neutral",
                    bars: [18, 23, 23, 38, 38, 45, 45, 57],
                  },
                ].map((s) => (
                  <div className="stat-card" key={s.label}>
                    <div className="stat-top">
                      <span>{s.label}</span>
                      <s.icon size={17} />
                    </div>
                    <div className="stat-main">
                      <div>
                        <strong>{s.value}</strong>
                        <small>{s.sub}</small>
                      </div>
                      <div className={`spark-bars ${s.tone}`}>
                        {s.bars.map((h, i) => (
                          <i key={i} style={{ height: h * 0.52 }} />
                        ))}
                      </div>
                    </div>
                    <div className={`stat-foot ${s.tone}`}>
                      <span>
                        {s.tone === "green" ? (
                          <CheckCircle2 size={12} />
                        ) : (
                          <Timer size={12} />
                        )}{" "}
                        {s.foot}
                      </span>
                      <ArrowUpRight size={14} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="dashboard-middle">
                <Panel
                  title="Your network, connected."
                  eyebrow="BINARY TEAM STRUCTURE"
                  action={
                    <button
                      className="text-button muted"
                      onClick={() => go("network")}
                    >
                      View full tree <ArrowUpRight size={15} />
                    </button>
                  }
                >
                  <Tree
                    data={data}
                    root={actor.id}
                    onMember={viewMember}
                    invite={() => setModal("invite")}
                    compact
                  />
                </Panel>
                <Panel
                  title={
                    role === "admin"
                      ? "Approval overview"
                      : "Your agent eligibility"
                  }
                  eyebrow={
                    role === "admin" ? "ACTION REQUIRED" : "YOUR PROGRESS"
                  }
                  action={<ShieldCheck className="gold-text" size={20} />}
                  className="eligibility-panel"
                >
                  <div
                    className={`eligibility-ring ${eligible ? "complete" : ""}`}
                  >
                    <div>
                      <strong>
                        {role === "admin"
                          ? pendingKyc.length + pendingExpenses.length
                          : eligible
                            ? "100%"
                            : `${Math.round((((actor.kyc === "Verified" ? 1 : 0) + verifiedDirect) / 3) * 100)}%`}
                      </strong>
                      <span>
                        {role === "admin"
                          ? "pending reviews"
                          : eligible
                            ? "You’re qualified"
                            : "towards eligibility"}
                      </span>
                    </div>
                  </div>
                  {role === "admin" ? (
                    <>
                      <div className="check-row">
                        <span>Member KYC reviews</span>
                        <Badge tone="gold">{pendingKyc.length} pending</Badge>
                      </div>
                      <div className="check-row">
                        <span>Expense approvals</span>
                        <Badge tone="gold">
                          {pendingExpenses.length} pending
                        </Badge>
                      </div>
                      <button
                        className="btn secondary full"
                        onClick={() => go("approvals")}
                      >
                        Open approval center <ArrowRight size={15} />
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="check-row">
                        <span>
                          <ShieldCheck size={16} /> Personal KYC
                        </span>
                        {actor.kyc === "Verified" ? (
                          <CheckCircle2 size={16} className="green-text" />
                        ) : (
                          <Badge tone="gold">Pending</Badge>
                        )}
                      </div>
                      <div className="check-row">
                        <span>
                          <Users size={16} /> Two verified direct members
                        </span>
                        <strong>{verifiedDirect} / 2</strong>
                      </div>
                      <div className="check-row">
                        <span>
                          <GitFork size={16} /> Joined with your referral ID
                        </span>
                        <CheckCircle2 size={16} className="green-text" />
                      </div>
                      <div className="eligibility-note">
                        <span className={eligible ? "green-text" : "gold-text"}>
                          <CheckCircle2 size={15} />
                          {eligible
                            ? "Eligible for agent access"
                            : "Continue your journey"}
                        </span>
                        <p>
                          {eligible
                            ? "You can assign tasks to your verified downline."
                            : "Complete verification and both direct positions."}
                        </p>
                      </div>
                    </>
                  )}
                </Panel>
              </div>
              <div className="dashboard-bottom">
                <Panel
                  title="Tasks that need attention"
                  action={
                    <button
                      className="text-button muted"
                      onClick={() => go("tasks")}
                    >
                      View all tasks <ArrowUpRight size={15} />
                    </button>
                  }
                >
                  <div className="mini-tasks">
                    {scopedTasks
                      .filter((t) => t.status !== "Complete")
                      .slice(0, 3)
                      .map((t) => (
                        <button
                          className="mini-task"
                          key={t.id}
                          onClick={() => go("tasks")}
                        >
                          <span
                            className={`task-check ${t.status === "In review" ? "review" : ""}`}
                          >
                            {t.status === "In review" && <Check size={12} />}
                          </span>
                          <div>
                            <strong>{t.title}</strong>
                            <span>
                              {
                                data.members.find((m) => m.id === t.assignee)
                                  ?.name
                              }{" "}
                              <i /> Due {dateLabel(t.due)}
                            </span>
                          </div>
                          <Badge
                            tone={t.priority === "High" ? "gold" : "neutral"}
                          >
                            {t.priority}
                          </Badge>
                          <ChevronRight size={16} />
                        </button>
                      ))}
                    {!scopedTasks.filter((t) => t.status !== "Complete")
                      .length && (
                      <Empty
                        title="You’re all caught up"
                        detail="New tasks will appear here after assignment."
                      />
                    )}
                  </div>
                </Panel>
                <Panel
                  title="Recent activity"
                  action={
                    <button
                      className="text-button muted"
                      onClick={() => go("activity")}
                      aria-label="View all activity"
                    >
                      <MoreHorizontal size={20} />
                    </button>
                  }
                >
                  <div className="activity-list">
                    {data.activity
                      .filter(
                        (a) => role === "admin" || scopeIds.includes(a.member),
                      )
                      .slice(0, 3)
                      .map((a) => (
                        <div className="activity-item" key={a.id}>
                          <span
                            className={`activity-icon ${a.kind === "kyc" ? "green" : ""}`}
                          >
                            {a.kind === "kyc" ? (
                              <ShieldCheck size={15} />
                            ) : a.kind === "expense" ? (
                              <Receipt size={15} />
                            ) : (
                              <ClipboardList size={15} />
                            )}
                          </span>
                          <div>
                            <strong>{a.title}</strong>
                            <p>{a.detail}</p>
                            <small>
                              {dateLabel(a.time)} ·{" "}
                              {new Date(a.time).toLocaleTimeString("en-IN", {
                                hour: "2-digit",
                                minute: "2-digit",
                                timeZone: "Asia/Kolkata",
                              })}
                            </small>
                          </div>
                        </div>
                      ))}
                  </div>
                </Panel>
              </div>
              <div className="referral-strip">
                <span className="referral-icon">
                  <GitFork size={21} />
                </span>
                <div>
                  <strong>Your network starts with a connection.</strong>
                  <p>
                    Share your referral ID so new members join the right upline.
                  </p>
                </div>
                <code>{actor.ref}</code>
                <button
                  className="btn secondary"
                  onClick={() => copy(actor.ref)}
                >
                  <Copy size={15} /> Copy ID
                </button>
              </div>
            </>
          )}

          {page === "network" && (
            <>
              <div className="section-toolbar">
                <div className="segmented">
                  <button
                    className={allowedRoot === actor.id ? "active" : ""}
                    onClick={() => setTreeRoot(actor.id)}
                  >
                    My tree
                  </button>
                  {role !== "user" && leftMember && (
                    <button
                      className={allowedRoot === leftMember.id ? "active" : ""}
                      onClick={() => setTreeRoot(leftMember.id)}
                    >
                      Left branch
                    </button>
                  )}
                  {role !== "user" && rightMember && (
                    <button
                      className={allowedRoot === rightMember.id ? "active" : ""}
                      onClick={() => setTreeRoot(rightMember.id)}
                    >
                      Right branch
                    </button>
                  )}
                </div>
                <span className="muted small">
                  Maximum 2 direct positions per member
                </span>
              </div>
              <Panel
                title="The connections behind your progress"
                action={
                  <Badge tone="green">
                    {role === "user" ? myNetwork.length : scope.length} members
                  </Badge>
                }
              >
                <Tree
                  data={data}
                  root={role === "user" ? actor.id : allowedRoot}
                  onMember={viewMember}
                  invite={() => setModal("invite")}
                />
              </Panel>
              <Panel
                title="Member directory"
                className="spaced"
                action={
                  <label className="search">
                    <Search size={16} />
                    <input
                      aria-label="Search members"
                      placeholder="Search name or referral…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                }
              >
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Referral ID</th>
                        <th>Upline</th>
                        <th>Position</th>
                        <th>KYC</th>
                        <th>Access</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {(role === "user" ? [actor, ...myNetwork] : scope)
                        .filter((m) => searchable(m.name + " " + m.ref))
                        .map((m) => (
                          <tr key={m.id}>
                            <td>
                              <span className="person-cell">
                                <Avatar name={m.name} size="small" />
                                <span>
                                  <strong>{m.name}</strong>
                                  <small>{m.city}</small>
                                </span>
                              </span>
                            </td>
                            <td>
                              <code>{m.ref}</code>
                            </td>
                            <td>
                              {data.members.find((p) => p.id === m.parent)
                                ?.name || "Company"}
                            </td>
                            <td className="capitalize">
                              {m.parent ? m.side : "Root"}
                            </td>
                            <td>
                              <Badge
                                tone={m.kyc === "Verified" ? "green" : "gold"}
                              >
                                {m.kyc}
                              </Badge>
                            </td>
                            <td>{isAgent(data, m.id) ? "Agent" : "Member"}</td>
                            <td>
                              <IconButton
                                label={`View ${m.name}`}
                                onClick={() => viewMember(m)}
                              >
                                <ArrowUpRight size={16} />
                              </IconButton>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {!(role === "user" ? [actor, ...myNetwork] : scope).some(
                    (m) => searchable(m.name + " " + m.ref),
                  ) && (
                    <Empty
                      title="No members found"
                      detail="Try another name or referral ID."
                    />
                  )}
                </div>
              </Panel>
            </>
          )}

          {page === "onboarding" && (
            <>
              <div className="info-banner">
                <ShieldCheck size={22} />
                <div>
                  <strong>
                    {actor.kyc === "Verified"
                      ? "Your profile is verified"
                      : actor.kyc === "In review"
                        ? "Your checklist is with the admin"
                        : "Complete your member profile"}
                  </strong>
                  <p>
                    {actor.kyc === "Verified"
                      ? "Verified members can receive tasks from their upline."
                      : actor.kyc === "Changes requested"
                        ? "The admin requested changes. Update your sample records and resubmit."
                        : "A provisional profile becomes verified after admin review. Use sample files only."}
                  </p>
                </div>
                <Badge tone={actor.kyc === "Verified" ? "green" : "gold"}>
                  {actor.kyc}
                </Badge>
              </div>
              <div className="onboarding-grid">
                <Panel
                  title="Business & identity checklist"
                  eyebrow="STEP 01 / YOUR DOCUMENTS"
                >
                  <div className="document-list">
                    {requiredDocs.map((name, i) => (
                      <div className="document-row" key={name}>
                        <span
                          className={
                            actor.documents[name]
                              ? "doc-number done"
                              : "doc-number"
                          }
                        >
                          {actor.documents[name] ? (
                            <Check size={17} />
                          ) : (
                            String(i + 1).padStart(2, "0")
                          )}
                        </span>
                        <div>
                          <strong>{name}</strong>
                          <small>
                            {actor.documents[name] ||
                              [
                                "Confirm a shop and add a sample location proof",
                                "Add a sample firm registration record",
                                "Shop tenancy proof · sample PDF or image",
                                "Address verification · sample PDF or image",
                                "Personal identification · sample file only",
                              ][i]}
                          </small>
                        </div>
                        <label
                          className={`upload-button ${actor.kyc === "In review" || actor.kyc === "Verified" ? "disabled" : ""}`}
                        >
                          <Upload size={15} />
                          <span>
                            {actor.documents[name] ? "Replace" : "Add file"}
                          </span>
                          <input
                            type="file"
                            aria-label={`Upload ${name}`}
                            accept=".pdf,.png,.jpg,.jpeg"
                            disabled={
                              actor.kyc === "In review" ||
                              actor.kyc === "Verified"
                            }
                            onChange={(e) => pickDoc(name, e.target.files?.[0])}
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                  <div className="subtle-note">
                    Only sample filenames are saved in this frontend. File
                    contents are not uploaded. PDF, JPG or PNG · max 10 MB.
                  </div>
                  {fileError && <p className="error">{fileError}</p>}
                </Panel>
                <Panel
                  title="Your onboarding progress"
                  eyebrow="PROFILE CHECKLIST"
                >
                  <div className="onboarding-progress">
                    <strong>
                      {Object.keys(actor.documents).filter((k) =>
                        requiredDocs.includes(k),
                      ).length +
                        (actor.accounts.length === 5 ? 1 : 0) +
                        (actor.video ? 1 : 0)}
                      <span>/ 7</span>
                    </strong>
                    <p>checklist items ready</p>
                  </div>
                  <div className="progress-track">
                    <i
                      style={{
                        width: `${((Object.keys(actor.documents).length + (actor.accounts.length === 5 ? 1 : 0) + (actor.video ? 1 : 0)) / 7) * 100}%`,
                      }}
                    />
                  </div>
                  <div className="profile-facts">
                    <div>
                      <span>Your referral</span>
                      <code>{actor.ref}</code>
                    </div>
                    <div>
                      <span>Your upline</span>
                      <strong>
                        {data.members.find((m) => m.id === actor.parent)
                          ?.name || "Company"}
                      </strong>
                    </div>
                    <div>
                      <span>Joined</span>
                      <strong>{dateLabel(actor.joined)}</strong>
                    </div>
                  </div>
                  <button
                    className="btn secondary full"
                    onClick={() => go("guide")}
                  >
                    <Play size={14} /> See the onboarding guide
                  </button>
                </Panel>
                <Panel
                  title="Business current accounts"
                  eyebrow="STEP 02 / FIVE ACCOUNT RECORDS"
                >
                  <p className="section-intro">
                    Add five sample account references. Enter only four demo
                    digits for each; never enter full bank details.
                  </p>
                  <div className="account-inputs">
                    {Array.from({ length: 5 }, (_, i) => (
                      <label key={i}>
                        <span>Account 0{i + 1}</span>
                        <div>
                          <Building2 size={17} />
                          <span>••••</span>
                          <input
                            aria-label={`Account ${i + 1} last four demo digits`}
                            placeholder="0000"
                            inputMode="numeric"
                            maxLength={4}
                            pattern="[0-9]{4}"
                            disabled={
                              actor.kyc === "Verified" ||
                              actor.kyc === "In review"
                            }
                            value={actor.accounts[i] || ""}
                            onChange={(e) => {
                              const value = e.target.value
                                .replace(/\D/g, "")
                                .slice(0, 4);
                              update((d) => {
                                const m = d.members.find(
                                  (m) => m.id === actor.id,
                                )!;
                                m.accounts = Array.from(
                                  { length: 5 },
                                  (_, n) =>
                                    n === i ? value : m.accounts[n] || "",
                                );
                              });
                            }}
                          />
                        </div>
                      </label>
                    ))}
                  </div>
                </Panel>
                <Panel
                  title="Video verification"
                  eyebrow="STEP 03 / FINAL REVIEW"
                >
                  <div className="video-kyc">
                    <span>
                      <Video size={27} />
                    </span>
                    <strong>
                      {actor.video
                        ? "Demo video step complete"
                        : "Your identity, verified in person"}
                    </strong>
                    <p>
                      Production video KYC will connect to a verification
                      provider. For this preview, mark the sample step complete.
                    </p>
                    <button
                      className="btn secondary"
                      disabled={
                        actor.video ||
                        actor.kyc === "In review" ||
                        actor.kyc === "Verified"
                      }
                      onClick={() =>
                        update((d) => {
                          d.members.find((m) => m.id === actor.id)!.video =
                            true;
                        })
                      }
                    >
                      {actor.video ? (
                        <CheckCircle2 size={16} />
                      ) : (
                        <Video size={16} />
                      )}{" "}
                      {actor.video
                        ? "Sample step completed"
                        : "Complete demo video step"}
                    </button>
                  </div>
                </Panel>
              </div>
              {actor.kyc !== "Verified" && actor.kyc !== "In review" && (
                <div className="submit-checklist">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={actor.consent}
                      onChange={(e) =>
                        update((d) => {
                          d.members.find((m) => m.id === actor.id)!.consent =
                            e.target.checked;
                        })
                      }
                    />{" "}
                    I confirm these are sample records and agree to this demo
                    review.
                  </label>
                  <button
                    className="btn primary"
                    disabled={!onboardingComplete(actor)}
                    onClick={() => {
                      if (!onboardingComplete(actor)) return;
                      update((d) => {
                        d.members.find((m) => m.id === actor.id)!.kyc =
                          "In review";
                        log(
                          d,
                          "KYC submitted for review",
                          `${actor.name} completed the onboarding checklist.`,
                          actor.id,
                          "kyc",
                        );
                      });
                      notify(
                        "Checklist submitted. Switch to Admin to review it.",
                      );
                    }}
                  >
                    Submit for review <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </>
          )}

          {page === "tasks" && (
            <>
              <div className="section-toolbar">
                <div className="segmented">
                  {["All tasks", "My tasks", "In review", "Complete"].map(
                    (f) => (
                      <button
                        key={f}
                        className={taskFilter === f ? "active" : ""}
                        onClick={() => setTaskFilter(f)}
                      >
                        {f}
                      </button>
                    ),
                  )}
                </div>
                <label className="search">
                  <Search size={16} />
                  <input
                    aria-label="Search tasks"
                    placeholder="Search tasks…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              </div>
              {role === "user" && (
                <div className="info-note bottom-gap">
                  <LockKeyhole size={17} />
                  <p>
                    You can work on tasks assigned to you. Agent eligibility
                    unlocks assigning tasks to your verified downline.
                  </p>
                </div>
              )}
              <div className="task-grid">
                {scopedTasks
                  .filter(
                    (t) =>
                      searchable(t.title) &&
                      (taskFilter === "All tasks" ||
                        (taskFilter === "My tasks" &&
                          t.assignee === actor.id) ||
                        t.status === taskFilter),
                  )
                  .map((t) => (
                    <section className="task-card" key={t.id}>
                      <div className="task-card-top">
                        <Badge
                          tone={
                            t.status === "Complete"
                              ? "green"
                              : t.status === "In review"
                                ? "gold"
                                : "neutral"
                          }
                        >
                          {t.status}
                        </Badge>
                        <span
                          className={
                            t.priority === "High" ? "priority high" : "priority"
                          }
                        >
                          <i />
                          {t.priority}
                        </span>
                      </div>
                      <h2>{t.title}</h2>
                      <p>{t.description}</p>
                      <div className="task-assignee">
                        <Avatar
                          name={
                            data.members.find((m) => m.id === t.assignee)
                              ?.name || "Member"
                          }
                          size="small"
                        />
                        <span>
                          {data.members.find((m) => m.id === t.assignee)?.name}
                          <small>
                            Assigned by{" "}
                            {t.by === "admin"
                              ? "Admin"
                              : data.members.find((m) => m.id === t.by)?.name}
                          </small>
                        </span>
                      </div>
                      <div className="task-card-footer">
                        <span>
                          <Timer size={14} /> {dateLabel(t.due)}
                        </span>
                        {t.assignee === actor.id &&
                          role !== "admin" &&
                          t.status === "To do" && (
                            <button
                              className="text-button"
                              onClick={() => transitionTask(t, "In progress")}
                            >
                              Start task <ArrowRight size={14} />
                            </button>
                          )}
                        {t.assignee === actor.id &&
                          role !== "admin" &&
                          t.status === "In progress" && (
                            <button
                              className="text-button"
                              onClick={() => transitionTask(t, "In review")}
                            >
                              Submit for review <ArrowRight size={14} />
                            </button>
                          )}
                        {t.status === "In review" &&
                          (role === "admin" ||
                            (role === "agent" && t.by === actor.id)) && (
                            <button
                              className="text-button"
                              onClick={() => transitionTask(t, "Complete")}
                            >
                              Approve task <Check size={14} />
                            </button>
                          )}
                        {t.status === "Complete" && (
                          <CheckCircle2 size={17} className="green-text" />
                        )}
                      </div>
                    </section>
                  ))}
              </div>
              {!scopedTasks.some(
                (t) =>
                  searchable(t.title) &&
                  (taskFilter === "All tasks" ||
                    (taskFilter === "My tasks" && t.assignee === actor.id) ||
                    t.status === taskFilter),
              ) && (
                <Empty
                  title="No tasks here yet"
                  detail="Tasks matching your filters will appear here."
                />
              )}
            </>
          )}

          {page === "wallet" && (
            <>
              <div className="ledger-stats">
                {(["Pay in", "Pay out"] as const).map((type) => (
                  <section className="panel ledger-stat" key={type}>
                    <span>
                      {type === "Pay in" ? (
                        <ArrowDownLeft size={20} />
                      ) : (
                        <ArrowUpRight size={20} />
                      )}{" "}
                      Approved {type.toLowerCase()}
                    </span>
                    <strong>
                      {money(
                        data.ledger
                          .filter(
                            (l) =>
                              (role === "admin" || l.member === actor.id) &&
                              l.type === type &&
                              l.status === "Approved",
                          )
                          .reduce((s, l) => s + l.amount, 0),
                      )}
                    </strong>
                    <small>Sample operating ledger</small>
                  </section>
                ))}
                <section className="panel ledger-stat commission-card">
                  <span>
                    <TrendingUp size={20} /> Commission
                  </span>
                  <strong>Not configured</strong>
                  <small>Rate and calculation will be added later.</small>
                </section>
              </div>
              <Panel
                title="Transaction ledger"
                action={
                  role === "admin" ? (
                    <button
                      className="btn secondary"
                      onClick={() => setModal("allowance")}
                    >
                      <Plus size={15} /> Add allowance
                    </button>
                  ) : (
                    <Badge>Demo records</Badge>
                  )
                }
              >
                <div className="table-toolbar">
                  <div className="segmented">
                    {["All transactions", "Pay in", "Pay out"].map((f) => (
                      <button
                        key={f}
                        onClick={() => setFinanceFilter(f)}
                        className={financeFilter === f ? "active" : ""}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Transaction</th>
                        <th>Member</th>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {data.ledger
                        .filter(
                          (l) =>
                            (role === "admin" || l.member === actor.id) &&
                            (financeFilter === "All transactions" ||
                              l.type === financeFilter),
                        )
                        .map((l) => (
                          <tr key={l.id}>
                            <td>
                              <strong>{l.title}</strong>
                              <small className="table-sub">
                                DEMO-{l.id.slice(0, 8).toUpperCase()}
                              </small>
                            </td>
                            <td>
                              {
                                data.members.find((m) => m.id === l.member)
                                  ?.name
                              }
                            </td>
                            <td>{dateLabel(l.date)}</td>
                            <td>
                              <span
                                className={
                                  l.type === "Pay in" ? "green-text" : "muted"
                                }
                              >
                                {l.type}
                              </span>
                            </td>
                            <td className="amount">{money(l.amount)}</td>
                            <td>
                              <Badge
                                tone={
                                  l.status === "Approved" ? "green" : "gold"
                                }
                              >
                                {l.status}
                              </Badge>
                            </td>
                            <td>
                              {role === "admin" && l.status === "Pending" && (
                                <button
                                  className="text-button"
                                  onClick={() => {
                                    update((d) => {
                                      const item = d.ledger.find(
                                        (x) => x.id === l.id,
                                      )!;
                                      item.status = "Approved";
                                      log(
                                        d,
                                        "Allowance approved",
                                        item.title,
                                        item.member,
                                        "allowance",
                                      );
                                    });
                                    notify("Demo allowance approved.");
                                  }}
                                >
                                  Approve
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {!data.ledger.some(
                    (l) =>
                      (role === "admin" || l.member === actor.id) &&
                      (financeFilter === "All transactions" ||
                        l.type === financeFilter),
                  ) && (
                    <Empty
                      title="No transactions yet"
                      detail="Approved allowances and expenses will appear here."
                    />
                  )}
                </div>
              </Panel>
              <div className="info-note spaced">
                <CircleAlert size={18} />
                <p>
                  This ledger is a UI demonstration. No deposits, payouts or
                  commissions are processed.
                </p>
              </div>
            </>
          )}

          {page === "expenses" && (
            <>
              <div className="summary-pills">
                {["Pending", "Approved", "Rejected"].map((status) => (
                  <span key={status}>
                    <i
                      className={
                        status === "Approved"
                          ? "verified-dot"
                          : status === "Pending"
                            ? "pending-dot"
                            : "neutral-dot"
                      }
                    />
                    {status}
                    <strong>
                      {scopedExpenses.filter((e) => e.status === status).length}
                    </strong>
                  </span>
                ))}
              </div>
              {role === "user" && (
                <div className="info-note bottom-gap">
                  <LockKeyhole size={18} />
                  <p>
                    Expense submission is available to agents. Your upline
                    manages expense requests during onboarding.
                  </p>
                </div>
              )}
              <Panel
                title={
                  role === "admin"
                    ? "All expense requests"
                    : "Your expense requests"
                }
                action={<Badge>Receipt required</Badge>}
              >
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Expense</th>
                        <th>Submitted by</th>
                        <th>Receipt</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scopedExpenses.map((e) => (
                        <tr key={e.id}>
                          <td>
                            <strong>{e.title}</strong>
                            <small className="table-sub">
                              {e.category} · {dateLabel(e.date)}
                            </small>
                          </td>
                          <td>
                            {data.members.find((m) => m.id === e.member)?.name}
                          </td>
                          <td>
                            <span
                              className="file-name"
                              title="Sample filename only"
                            >
                              <FileText size={14} />
                              {e.receipt}
                            </span>
                          </td>
                          <td className="amount">{money(e.amount)}</td>
                          <td>
                            <Badge
                              tone={
                                e.status === "Approved"
                                  ? "green"
                                  : e.status === "Pending"
                                    ? "gold"
                                    : "red"
                              }
                            >
                              {e.status}
                            </Badge>
                          </td>
                          <td>
                            {role === "admin" && e.status === "Pending" ? (
                              <div className="inline-actions">
                                <button
                                  className="btn tiny primary"
                                  onClick={() => expenseReview(e.id, true)}
                                >
                                  Approve
                                </button>
                                <button
                                  className="btn tiny secondary"
                                  onClick={() => expenseReview(e.id, false)}
                                >
                                  Reject
                                </button>
                              </div>
                            ) : (
                              <span className="small muted">
                                {e.status === "Pending" ? "With admin" : e.note}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!scopedExpenses.length && (
                    <Empty
                      title="No expenses submitted"
                      detail="Agent expense requests and their review status will appear here."
                    />
                  )}
                </div>
              </Panel>
            </>
          )}

          {page === "approvals" && role === "admin" && (
            <>
              <Panel
                title="Member verification"
                eyebrow={`${pendingKyc.length} REQUESTS WAITING`}
                action={<ShieldCheck size={21} className="gold-text" />}
              >
                <div className="approval-list">
                  {pendingKyc.map((m) => (
                    <div className="approval-row" key={m.id}>
                      <Avatar name={m.name} />
                      <div>
                        <strong>{m.name}</strong>
                        <p>
                          {m.ref} · Upline:{" "}
                          {data.members.find((x) => x.id === m.parent)?.name}
                        </p>
                        <span className="small muted">
                          {Object.keys(m.documents).length} documents ·{" "}
                          {m.accounts.length} account references · Video step{" "}
                          {m.video ? "complete" : "pending"}
                        </span>
                      </div>
                      <Badge tone="gold">In review</Badge>
                      <button
                        className="btn secondary"
                        onClick={() => viewMember(m)}
                      >
                        Review profile <ArrowUpRight size={15} />
                      </button>
                    </div>
                  ))}
                  {!pendingKyc.length && (
                    <Empty
                      title="All caught up"
                      detail="No KYC submissions need your review."
                    />
                  )}
                </div>
              </Panel>
              <Panel
                title="Expenses awaiting approval"
                className="spaced"
                eyebrow={`${pendingExpenses.length} REQUESTS WAITING`}
              >
                <div className="approval-list">
                  {pendingExpenses.map((e) => (
                    <div className="approval-row" key={e.id}>
                      <span className="approval-icon">
                        <Receipt size={22} />
                      </span>
                      <div>
                        <strong>{e.title}</strong>
                        <p>
                          {data.members.find((m) => m.id === e.member)?.name} ·{" "}
                          {e.category}
                        </p>
                        <span className="small muted">
                          Sample receipt: {e.receipt}
                        </span>
                      </div>
                      <strong className="amount">{money(e.amount)}</strong>
                      <div className="inline-actions">
                        <button
                          className="btn secondary"
                          onClick={() => expenseReview(e.id, false)}
                        >
                          Reject
                        </button>
                        <button
                          className="btn primary"
                          onClick={() => expenseReview(e.id, true)}
                        >
                          Approve <Check size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {!pendingExpenses.length && (
                    <Empty
                      title="No pending expenses"
                      detail="New expense submissions will appear here."
                    />
                  )}
                </div>
              </Panel>
            </>
          )}

          {page === "activity" && (
            <>
              <div className="access-cards">
                <Panel title="Location sharing" action={<MapPin size={20} />}>
                  <p className="section-intro">
                    Location is optional and requested only when you choose to
                    share it.
                  </p>
                  <div className="access-value">{locationStatus}</div>
                  <button
                    className="btn secondary"
                    onClick={() => {
                      if (!navigator.geolocation)
                        return notify(
                          "Location is not supported in this browser.",
                        );
                      setLocationStatus("Requesting permission…");
                      navigator.geolocation.getCurrentPosition(
                        () => {
                          setLocationStatus(
                            "Permission granted · position not stored",
                          );
                          notify(
                            "Browser location permission received. Coordinates are not stored in this demo.",
                          );
                        },
                        () => {
                          setLocationStatus(
                            "Not shared · permission unavailable",
                          );
                          notify(
                            "Location was not shared. You can continue using the portal.",
                          );
                        },
                        { timeout: 10000, maximumAge: 60000 },
                      );
                    }}
                  >
                    <MapPin size={15} /> Share location with permission
                  </button>
                </Panel>
                <Panel
                  title="Access records"
                  action={<LockKeyhole size={20} />}
                >
                  <p className="section-intro">
                    Server IP logging and authenticated access records will be
                    connected in the backend phase.
                  </p>
                  <div className="access-value">Not connected</div>
                  <Badge>Frontend preview</Badge>
                </Panel>
              </div>
              <Panel
                title="Workspace activity"
                className="spaced"
                action={<Badge tone="green">Updates within this browser</Badge>}
              >
                <div className="activity-list full-activity">
                  {data.activity
                    .filter(
                      (a) => role === "admin" || scopeIds.includes(a.member),
                    )
                    .map((a) => (
                      <div className="activity-item" key={a.id}>
                        <span className="activity-icon">
                          <FileCheck2 size={17} />
                        </span>
                        <div>
                          <strong>{a.title}</strong>
                          <p>{a.detail}</p>
                        </div>
                        <time>
                          {dateLabel(a.time)} ·{" "}
                          {new Date(a.time).toLocaleTimeString("en-IN", {
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "Asia/Kolkata",
                          })}
                        </time>
                      </div>
                    ))}
                </div>
              </Panel>
            </>
          )}
          {page === "guide" && <Guide />}
          {page === "settings" && (
            <div className="settings-grid">
              <Panel title="Preview preferences">
                <div className="setting-row">
                  <div>
                    <strong>Active role</strong>
                    <p>Explore the three connected workspaces.</p>
                  </div>
                  <select
                    aria-label="Settings role"
                    value={role}
                    onChange={(e) => {
                      setRole(e.target.value as Role);
                      go("overview");
                    }}
                  >
                    <option value="admin">Administrator</option>
                    <option value="agent">Agent</option>
                    <option value="user">Member</option>
                  </select>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>Commission rules</strong>
                    <p>Calculation will be defined in the next phase.</p>
                  </div>
                  <Badge>Not configured</Badge>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>Language</strong>
                    <p>
                      English interface with a Hinglish getting-started guide.
                    </p>
                  </div>
                  <Badge>EN / HI</Badge>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>Demo storage</strong>
                    <p>
                      Sample data stays in this browser. Changes sync across its
                      tabs.
                    </p>
                  </div>
                  <Badge tone="green">Local</Badge>
                </div>
              </Panel>
              <Panel title="Demo controls">
                <p className="section-intro">
                  Reset the workspace to the original sample members, tasks,
                  documents and requests.
                </p>
                <button
                  className="btn secondary"
                  onClick={() => setModal("reset")}
                >
                  <RotateCcw size={16} /> Reset demo data
                </button>
                <div className="subtle-note">
                  Authentication, encrypted uploads, video KYC, server access
                  logs and payments are not connected in this UI preview.
                </div>
              </Panel>
            </div>
          )}
          {role === "user" && eligible && page === "overview" && (
            <div className="promotion-banner">
              <ShieldCheck size={22} />
              <div>
                <strong>Your agent workspace is ready.</strong>
                <p>Your KYC and two direct members are verified.</p>
              </div>
              <button
                className="btn primary"
                onClick={() => {
                  setAgentId(actor.id);
                  setRole("agent");
                  setTreeRoot(actor.id);
                  go("overview");
                }}
              >
                Enter agent workspace <ArrowRight size={16} />
              </button>
            </div>
          )}
          <footer className="dashboard-footer">
            <span>
              <Emblem /> SYNDICATE <i /> Member operations, connected.
            </span>
            <span>
              Frontend preview · All amounts and records are demo data{" "}
              <span className="footer-dot" />
            </span>
          </footer>
        </main>
      </div>

      {modal && (
        <Dialog
          title={
            (
              {
                invite: "Invite to your network",
                task: "Assign a new task",
                expense: "Submit an expense",
                allowance: "Approve a demo allowance",
                notifications: "Workspace notifications",
                member: "Member profile",
                reset: "Reset demo workspace",
              } as Record<string, string>
            )[modal]
          }
          close={() => setModal(null)}
        >
          {modal === "invite" && (
            <>
              <div className="invite-visual">
                <Emblem />
              </div>
              <p className="dialog-description">
                Share your referral ID. New profiles are placed in your first
                available left or right position.
              </p>
              <div className="copy-box">
                <code>{actor.ref}</code>
                <IconButton
                  label="Copy referral ID"
                  onClick={() => copy(actor.ref)}
                >
                  <Copy size={17} />
                </IconButton>
              </div>
              <div className="profile-facts">
                <div>
                  <span>Direct positions</span>
                  <strong>{direct(data, actor.id).length} / 2 filled</strong>
                </div>
                <div>
                  <span>Verified direct members</span>
                  <strong>{verifiedDirect} / 2</strong>
                </div>
              </div>
              {direct(data, actor.id).length >= 2 ? (
                <div className="info-note">
                  <CircleAlert size={18} />
                  <p>
                    Your direct team is full. A new member needs a downline
                    sponsor with an open position. SYN-KABIR has{" "}
                    {2 - direct(data, "m3").length} open position(s).
                  </p>
                </div>
              ) : (
                <button
                  className="btn primary full"
                  onClick={() =>
                    copy(
                      `${location.origin}${location.pathname}?ref=${actor.ref}`,
                    )
                  }
                >
                  <Copy size={16} /> Copy invite link
                </button>
              )}
              <button
                className="text-button back-link"
                onClick={() => {
                  setModal(null);
                  setScreen("signup");
                  setSignupError("");
                }}
              >
                Try the new-member signup <ArrowRight size={15} />
              </button>
            </>
          )}
          {modal === "task" && (
            <form className="form" onSubmit={addTask}>
              <label>
                Task title
                <input
                  name="title"
                  required
                  maxLength={100}
                  placeholder="e.g. Confirm office setup"
                />
              </label>
              <label>
                Assign to verified member
                <select name="assignee" required defaultValue="">
                  <option value="" disabled>
                    Select a member
                  </option>
                  {(role === "admin" ? data.members : myNetwork)
                    .filter((m) => m.kyc === "Verified")
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} · {m.ref}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Instructions
                <textarea
                  name="description"
                  required
                  maxLength={500}
                  placeholder="What needs to be completed?"
                  rows={3}
                />
              </label>
              <div className="form-columns">
                <label>
                  Due date
                  <input
                    type="date"
                    name="due"
                    required
                    min={new Intl.DateTimeFormat("en-CA", {
                      timeZone: "Asia/Kolkata",
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                    }).format(new Date())}
                  />
                </label>
                <label>
                  Priority
                  <select name="priority">
                    <option>Normal</option>
                    <option>High</option>
                  </select>
                </label>
              </div>
              <button className="btn primary full" type="submit">
                Assign task <ArrowRight size={16} />
              </button>
            </form>
          )}
          {modal === "expense" && (
            <form className="form" onSubmit={addExpense}>
              <label>
                Expense title
                <input
                  name="title"
                  required
                  maxLength={100}
                  placeholder="e.g. Office equipment"
                />
              </label>
              <div className="form-columns">
                <label>
                  Amount (₹)
                  <input
                    name="amount"
                    required
                    type="number"
                    min="0.01"
                    max="10000000"
                    step="0.01"
                    placeholder="0.00"
                  />
                </label>
                <label>
                  Category
                  <select name="category">
                    <option>Office setup</option>
                    <option>Rent</option>
                    <option>Travel</option>
                    <option>Utilities</option>
                    <option>Other</option>
                  </select>
                </label>
              </div>
              <label>
                Sample receipt
                <input
                  name="receipt"
                  type="file"
                  required
                  accept=".pdf,.png,.jpg,.jpeg"
                />
              </label>
              <div className="info-note">
                <FileText size={18} />
                <p>
                  Only the sample filename is saved. Submit to send this request
                  to the demo admin queue.
                </p>
              </div>
              <button className="btn primary full" type="submit">
                Submit for approval <ArrowRight size={16} />
              </button>
            </form>
          )}
          {modal === "allowance" && (
            <form className="form" onSubmit={addAllowance}>
              <label>
                Agent
                <select name="member" required>
                  {data.members
                    .filter((m) => isAgent(data, m.id))
                    .map((m) => (
                      <option value={m.id} key={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Purpose
                <input
                  name="title"
                  required
                  maxLength={100}
                  placeholder="e.g. Office operating allowance"
                />
              </label>
              <label>
                Amount (₹)
                <input
                  name="amount"
                  type="number"
                  min="0.01"
                  max="10000000"
                  step="0.01"
                  required
                />
              </label>
              <p className="subtle-note">
                Records an approved sample allowance. No money transfer takes
                place.
              </p>
              <button className="btn primary full" type="submit">
                Approve demo allowance <Check size={16} />
              </button>
            </form>
          )}
          {modal === "notifications" && (
            <div className="activity-list">
              {data.activity
                .filter((a) => role === "admin" || scopeIds.includes(a.member))
                .slice(0, 6)
                .map((a) => (
                  <div className="activity-item" key={a.id}>
                    <span className="activity-icon">
                      <Bell size={15} />
                    </span>
                    <div>
                      <strong>{a.title}</strong>
                      <p>{a.detail}</p>
                      <small>{dateLabel(a.time)}</small>
                    </div>
                  </div>
                ))}
              <button
                className="btn secondary full"
                onClick={() => {
                  setModal(null);
                  go("activity");
                }}
              >
                View workspace activity <ArrowRight size={15} />
              </button>
            </div>
          )}
          {modal === "member" && selectedNow && (
            <>
              <div className="member-dialog-profile">
                <Avatar name={selectedNow.name} size="large" gold />
                <div>
                  <h3>{selectedNow.name}</h3>
                  <code>{selectedNow.ref}</code>
                </div>
                <Badge tone={selectedNow.kyc === "Verified" ? "green" : "gold"}>
                  {selectedNow.kyc}
                </Badge>
              </div>
              <div className="profile-facts">
                <div>
                  <span>Upline</span>
                  <strong>
                    {data.members.find((m) => m.id === selectedNow.parent)
                      ?.name || "Company"}
                  </strong>
                </div>
                <div>
                  <span>City (self reported)</span>
                  <strong>{selectedNow.city}</strong>
                </div>
                <div>
                  <span>Verified direct members</span>
                  <strong>
                    {
                      direct(data, selectedNow.id).filter(
                        (m) => m.kyc === "Verified",
                      ).length
                    }{" "}
                    / 2
                  </strong>
                </div>
                <div>
                  <span>Eligible access</span>
                  <strong>
                    {isAgent(data, selectedNow.id) ? "Agent" : "Member"}
                  </strong>
                </div>
              </div>
              {role === "admin" && (
                <>
                  <h3 className="small-heading">Sample verification records</h3>
                  <div className="review-docs">
                    {requiredDocs.map((key) => (
                      <div key={key}>
                        <FileText size={14} />
                        <span>
                          {key}
                          <small>
                            {selectedNow.documents[key] || "Not supplied"}
                          </small>
                        </span>
                        {selectedNow.documents[key] && (
                          <Check size={15} className="green-text" />
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="account-chips">
                    {selectedNow.accounts.map((a, i) => (
                      <code key={i}>•••• {a}</code>
                    ))}
                  </div>
                  <div className="check-row">
                    <span>Video KYC sample step</span>
                    <Badge tone={selectedNow.video ? "green" : "gold"}>
                      {selectedNow.video ? "Complete" : "Pending"}
                    </Badge>
                  </div>
                  {selectedNow.kyc === "In review" && (
                    <div className="dialog-actions">
                      <button
                        className="btn secondary"
                        onClick={() => kycReview(selectedNow.id, false)}
                      >
                        Request changes
                      </button>
                      <button
                        className="btn primary"
                        disabled={!onboardingComplete(selectedNow)}
                        onClick={() => kycReview(selectedNow.id, true)}
                      >
                        Approve KYC <Check size={16} />
                      </button>
                    </div>
                  )}
                </>
              )}
              <p className="subtle-note">
                Demo profile · no real KYC verification or identity checks have
                been performed.
              </p>
            </>
          )}
          {modal === "reset" && (
            <>
              <p className="dialog-description">
                This removes your demo edits and restores all sample records in
                this browser.
              </p>
              <div className="dialog-actions">
                <button
                  className="btn secondary"
                  onClick={() => setModal(null)}
                >
                  Keep my changes
                </button>
                <button
                  className="btn primary"
                  onClick={() => {
                    setData(cloneSeed());
                    setUserId("m3");
                    setAgentId("m1");
                    setTreeRoot("m1");
                    setModal(null);
                    go("overview");
                    notify("Demo workspace restored.");
                  }}
                >
                  Reset demo
                </button>
              </div>
            </>
          )}
        </Dialog>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
          <button
            onClick={() => setToast("")}
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
