import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  CreditCard,
  Fuel,
  Gem,
  Gift,
  History,
  Plane,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Ticket,
  Utensils,
  Wallet,
} from "lucide-react";
import {
  customFetch,
  getGetWalletBalanceQueryKey,
  getGetWalletBalancesQueryKey,
  useRealtimeTopic,
} from "@workspace/api-client-react";
import {
  REWARDS,
  prizeBucketResult,
  prizeCommitmentMessage,
  type PrizeState,
  type PrizeDraw,
  type PrizeTicket,
  type RewardId,
} from "@workspace/api-zod/prize-lotto";
import { useAuth } from "@/lib/auth";
import {
  TableCoinRack,
  useCoinPreferences,
} from "@/components/table/CoinSettings";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import "@/components/prize-lotto/prize-lotto.css";

const icons = {
  cashback: Wallet,
  shopping: ShoppingBag,
  giftcard: Gift,
  travel: Plane,
  gadgets: Smartphone,
  dining: Utensils,
  fuel: Fuel,
  gold: Gem,
};
const money = (value: number) =>
  `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const date = (value: number) =>
  new Date(value).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const rewardName = (id: string | null) =>
  REWARDS.find((r) => r.id === id)?.name ?? "No prize";
const tabs = [
  { id: "play", label: "Play", icon: Sparkles },
  { id: "tickets", label: "My tickets", icon: Ticket },
  { id: "rewards", label: "My rewards", icon: Gift },
  { id: "results", label: "Results", icon: History },
  { id: "rules", label: "How to play", icon: CircleHelp },
] as const;

async function verifyDraw(draw: PrizeDraw) {
  if (!draw.seed) return false;
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(prizeCommitmentMessage(draw.seed, draw.id, draw.config)),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== draw.commitment) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(draw.seed),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  let sample = 0,
    attempt = 0;
  do {
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(`prize-lotto:v1:${draw.id}:${attempt++}`),
    );
    sample = new DataView(signature).getUint32(0);
  } while (sample >= Math.floor(4294967296 / 10000) * 10000);
  return prizeBucketResult(sample % 10000, draw.config.rtp) === draw.result;
}

export default function PrizeLotto() {
  const { user } = useAuth();
  return <PrizeGame key={user!.id} userId={user!.id} />;
}
function PrizeGame({ userId }: { userId: string }) {
  const [, go] = useLocation(),
    qc = useQueryClient();
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("play"),
    [page, setPage] = useState(1);
  const [reward, setReward] = useState<RewardId>("cashback"),
    [amount, setAmount] = useState(1000);
  const [clock, setClock] = useState(Date.now()),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [detail, setDetail] = useState<PrizeTicket | null>(null),
    [verification, setVerification] = useState<Record<string, string>>({});
  const operation = useRef(false),
    pending = useRef<{ signature: string; key: string } | null>(null);
  const key = ["prize-lotto", userId, page];
  const state = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      customFetch<PrizeState>(`/api/prize-lotto/state?page=${page}`, {
        signal,
      }),
    refetchInterval: 3000,
    retry: 1,
  });
  const max = Math.min(
    state.data?.maxTicket ?? 10000,
    state.data?.draws
      .filter((d) => d.status === "open")
      .sort((a, b) => a.ends - b.ends)[0]?.config.maxTicket ?? 10000,
  );
  const coins = useCoinPreferences("prize-lotto", userId, max);
  useRealtimeTopic(`wallet:${userId}`, () => {
    if (!operation.current)
      void qc.invalidateQueries({ queryKey: ["prize-lotto", userId] });
  });
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [notice]);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["prize-lotto", userId] }),
      qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetWalletBalancesQueryKey() }),
      qc.invalidateQueries({ queryKey: ["/api/bets"] }),
    ]);
  async function run(
    path: string,
    message: string,
    body?: unknown,
    request?: string,
  ) {
    if (operation.current) return false;
    operation.current = true;
    setBusy(true);
    try {
      await customFetch(`/api/prize-lotto${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(request ? { "Idempotency-Key": request } : {}),
        },
        body: JSON.stringify(body ?? {}),
      });
      await refresh();
      setNotice({ text: message });
      return true;
    } catch (error) {
      setNotice({
        text:
          error instanceof Error
            ? error.message
            : "Connection failed. Please retry.",
        error: true,
      });
      return false;
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  if (!state.data)
    return (
      <div className="prize-game pl-loading">
        <Gift size={44} />
        <h1>Prize Lotto</h1>
        <p role="status">
          {state.isError
            ? "Unable to connect to your game."
            : "Getting your tickets ready…"}
        </p>
        <button onClick={() => void state.refetch()}>Retry</button>
        <button onClick={() => go("/")}>Back to lobby</button>
      </div>
    );
  const data = state.data,
    now = clock + data.serverTime - state.dataUpdatedAt;
  const draw = data.draws
    .filter((d) => d.status === "open")
    .sort((a, b) => a.ends - b.ends)[0];
  const recent = data.draws
    .filter((d) => d.status === "settled")
    .sort((a, b) => b.ends - a.ends);
  const selected = REWARDS.find((r) => r.id === reward)!,
    Icon = icons[reward];
  const seconds = Math.max(0, Math.ceil(((draw?.closes ?? now) - now) / 1000));
  const isOpen =
    !!draw && now < draw.closes && data.salesEnabled && !state.isError;
  const validAmount =
    Number.isInteger(amount) && amount >= 100 && amount <= max;
  const canBuy = isOpen && validAmount && amount <= data.balance && !busy;
  const rtp = draw?.config.rtp ?? 85;
  const navigate = (next: typeof tab) => {
    setTab(next);
    setPage(1);
  };
  async function purchase() {
    if (!canBuy || !draw) return;
    const body = { drawId: draw.id, reward, amount },
      signature = JSON.stringify(body);
    if (pending.current?.signature !== signature)
      pending.current = { signature, key: crypto.randomUUID() };
    // Retain this key on network uncertainty; retries cannot buy a second ticket.
    if (
      await run(
        "/tickets",
        "Ticket booked. Find it in My tickets.",
        body,
        pending.current.key,
      )
    ) {
      pending.current = null;
      setConfirm(false);
    }
  }
  const tickets =
    tab === "rewards"
      ? data.tickets.filter((t) => t.status === "won")
      : data.tickets;
  return (
    <div className="prize-game">
      <aside className="pl-rail">
        <button
          className="pl-logo"
          onClick={() => navigate("play")}
          aria-label="Prize Lotto home"
        >
          <Gift />
        </button>
        <span className="pl-rail-line" />
        {tabs.map((item) => (
          <button
            key={item.id}
            onClick={() => navigate(item.id)}
            className={tab === item.id ? "active" : ""}
            aria-label={item.label}
            title={item.label}
          >
            <item.icon size={21} />
          </button>
        ))}
        <button
          className="pl-back"
          onClick={() => go("/")}
          aria-label="Back to lobby"
          title="Back to lobby"
        >
          <ArrowLeft />
        </button>
      </aside>
      <div className="pl-workspace">
        <header className="pl-header">
          <div className="pl-brand">
            <Gift size={27} />
            <div>
              prize<span>lotto</span>
              <small>A LITTLE LUCK. A LOT TO LOVE.</small>
            </div>
          </div>
          <div className="pl-header-right">
            <span className="pl-shared">
              <ShieldCheck size={15} /> Shared wallet
            </span>
            <button
              className="pl-wallet"
              aria-label="Wallet balance"
              onClick={() => go("/wallet")}
            >
              <Wallet size={18} />
              <span>
                <small>AVAILABLE BALANCE</small>
                <strong data-testid="prize-balance">
                  {money(data.balance)}
                </strong>
              </span>
              <span className="pl-plus">+</span>
            </button>
          </div>
        </header>
        <nav className="pl-tabs" aria-label="Prize Lotto navigation">
          {tabs.map((item) => (
            <button
              key={item.id}
              aria-current={tab === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={16} />
              {item.label}
            </button>
          ))}
          <button className="pl-lobby" onClick={() => go("/")}>
            <ArrowLeft size={15} />
            Lobby
          </button>
        </nav>
        <main className="pl-main">
          {notice && (
            <div
              role={notice.error ? "alert" : "status"}
              className={`pl-notice ${notice.error ? "error" : ""}`}
            >
              {notice.text}
              <button
                onClick={() => setNotice(null)}
                aria-label="Dismiss notification"
              >
                ×
              </button>
            </div>
          )}
          {state.isError && (
            <div role="alert" className="pl-notice error">
              Connection lost. Ticket sales are unavailable until we reconnect.
              <button onClick={() => void state.refetch()}>Retry</button>
            </div>
          )}
          {tab === "play" ? (
            <>
              <section className="pl-hero">
                <div className="pl-hero-copy">
                  <span className="pl-eyebrow">
                    <Sparkles size={14} /> EVERY TICKET, A NEW POSSIBILITY
                  </span>
                  <h1>
                    Little ticket.
                    <br />
                    Big <em>possibilities.</em>
                  </h1>
                  <p>
                    Cashback, dream trips & everyday treats.
                    <br />
                    Pick your reward. Let the draw surprise you.
                  </p>
                  <div className="pl-example">
                    <span>{money(1000)} ticket</span>
                    <span>→</span>
                    <strong>{money(10000)} on a win</strong>
                  </div>
                </div>
                <div className="pl-hero-art" aria-hidden="true">
                  <div className="pl-orbit one" />
                  <div className="pl-orbit two" />
                  <span className="pl-star s1">✦</span>
                  <span className="pl-star s2">✧</span>
                  <div className="pl-art-ticket">
                    <span>YOUR NEXT ADVENTURE</span>
                    <Plane size={55} strokeWidth={1.2} />
                    <strong>
                      Travel a<br />
                      little further.
                    </strong>
                    <div className="pl-art-stub">
                      <span>PRIZE LOTTO</span>
                      <b>10×</b>
                    </div>
                  </div>
                  <div className="pl-gift-tag">
                    <Gift size={26} />
                    <div>
                      Good things
                      <br />
                      <strong>could be yours.</strong>
                    </div>
                  </div>
                </div>
              </section>
              <div className="pl-draw-bar">
                <div>
                  <span className={`pl-live-dot ${isOpen ? "" : "closed"}`} />
                  <strong>
                    {!data.salesEnabled
                      ? "Sales paused"
                      : isOpen
                        ? "Draw is open"
                        : "Drawing now"}
                  </strong>
                  <span className="pl-draw-id">
                    #{draw?.id.replace("PRIZE-", "")}
                  </span>
                </div>
                <div>
                  <Clock3 size={17} />
                  <span>
                    {seconds ? "Ticket sales close in" : "Waiting for result"}
                  </span>
                  <b className="pl-countdown">
                    {String(Math.floor(seconds / 60)).padStart(2, "0")}:
                    {String(seconds % 60).padStart(2, "0")}
                  </b>
                </div>
              </div>
              <div className="pl-play-layout">
                <section className="pl-selection">
                  <div className="pl-section-heading">
                    <div>
                      <span className="pl-step">01</span>
                      <h2>What would make your day?</h2>
                    </div>
                    <span>Choose one reward</span>
                  </div>
                  <div className="pl-reward-grid">
                    {REWARDS.map((r, index) => {
                      const RIcon = icons[r.id];
                      return (
                        <button
                          key={r.id}
                          className={`pl-reward ${reward === r.id ? "selected" : ""}`}
                          style={{ "--reward": r.color } as CSSProperties}
                          aria-pressed={reward === r.id}
                          aria-label={`Select ${r.name}`}
                          onClick={() => setReward(r.id)}
                        >
                          <div className="pl-reward-top">
                            <span>
                              NO. {String(index + 1).padStart(2, "0")}
                            </span>
                            <span className="pl-reward-check">
                              {reward === r.id ? <Check size={13} /> : "10×"}
                            </span>
                          </div>
                          <div className="pl-reward-illustration">
                            <span className="pl-mini-spark">✦</span>
                            <RIcon size={40} strokeWidth={1.35} />
                          </div>
                          <h3>{r.name}</h3>
                          <p>{r.subtitle}</p>
                          <div className="pl-reward-bottom">
                            <span>
                              {r.kind === "cash"
                                ? "WALLET REWARD"
                                : "VALUE VOUCHER"}
                            </span>
                            <b>{money(validAmount ? amount * 10 : 0)}</b>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="pl-transparency">
                    <ShieldCheck size={20} />
                    <p>
                      <strong>Know your chances.</strong> Each selection has a{" "}
                      {rtp / 10}% win chance. One reward or “No prize” is drawn.
                      Reward value is 10× your ticket, including the stake.
                    </p>
                    <button onClick={() => navigate("rules")}>
                      The details
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                </section>
                <aside className="pl-slip">
                  <div className="pl-section-heading">
                    <div>
                      <span className="pl-step">02</span>
                      <h2>Your lucky ticket</h2>
                    </div>
                    <Ticket size={19} />
                  </div>
                  <div
                    className="pl-slip-reward"
                    style={{ "--reward": selected.color } as CSSProperties}
                  >
                    <span>
                      <Icon size={28} />
                    </span>
                    <div>
                      <small>YOU'RE PLAYING FOR</small>
                      <h3>{selected.name}</h3>
                    </div>
                  </div>
                  <label className="pl-input-label" htmlFor="prize-amount">
                    Ticket amount <span>INR</span>
                  </label>
                  <div className="pl-amount">
                    <span>₹</span>
                    <input
                      id="prize-amount"
                      aria-label="Ticket amount"
                      type="number"
                      min={100}
                      max={max}
                      step={1}
                      value={amount || ""}
                      onChange={(e) => setAmount(Number(e.target.value))}
                    />
                  </div>
                  <div className="pl-coins">
                    <TableCoinRack
                      preferences={coins}
                      chip={amount}
                      onSelect={(value) => {
                        coins.selectChip(value);
                        setAmount(value);
                      }}
                      minValue={100}
                      maxValue={max}
                      step={1}
                      layout="grid"
                      disabled={busy}
                    />
                  </div>
                  <small className="pl-limit">
                    Ticket range {money(100)} – {money(max)}
                  </small>
                  <div className="pl-perforation" />
                  <div className="pl-slip-total">
                    <span>Reward on a win</span>
                    <strong data-testid="prize-return">
                      {money(validAmount ? amount * 10 : 0)}
                    </strong>
                    <small>
                      {reward === "cashback"
                        ? "Automatically credited to your wallet"
                        : "Voucher value · claim after winning"}
                    </small>
                  </div>
                  <button
                    className="pl-primary"
                    disabled={!canBuy}
                    onClick={() => setConfirm(true)}
                  >
                    {busy ? "Booking…" : "Get my ticket"}
                    <ChevronRight size={19} />
                  </button>
                  <p className="pl-under-button">
                    {!validAmount
                      ? `Enter a whole-rupee amount from ${money(100)} to ${money(max)}.`
                      : amount > data.balance
                        ? "Insufficient balance. Add funds from your wallet."
                        : !data.salesEnabled
                          ? "Ticket sales are paused."
                          : !isOpen
                            ? "Sales closed. The next draw opens shortly."
                            : `${money(amount)} will be deducted from your wallet.`}
                  </p>
                  <div className="pl-slip-bottom">
                    <ShieldCheck size={13} /> Published odds · Secure wallet
                  </div>
                </aside>
              </div>
              <section className="pl-recent">
                <div className="pl-section-heading">
                  <div>
                    <History size={18} />
                    <h2>Fresh from the draw</h2>
                  </div>
                  <button onClick={() => navigate("results")}>
                    All results <ArrowUpRight size={14} />
                  </button>
                </div>
                <div className="pl-recent-row">
                  {recent.length ? (
                    recent.slice(0, 6).map((d) => (
                      <div key={d.id}>
                        <span
                          className="pl-result-dot"
                          style={{
                            background:
                              REWARDS.find((r) => r.id === d.result)?.color ??
                              "#8a918d",
                          }}
                        />
                        <strong>{rewardName(d.result)}</strong>
                        <small>{date(d.ends)}</small>
                      </div>
                    ))
                  ) : (
                    <p>The first result will appear here after the draw.</p>
                  )}
                </div>
              </section>
            </>
          ) : tab === "rules" ? (
            <section className="pl-content pl-rules">
              <span className="pl-eyebrow">A FEW THINGS TO KNOW</span>
              <h1>Good luck starts with clear rules.</h1>
              <div className="pl-rule-grid">
                {[
                  [
                    "01",
                    "Pick a reward",
                    "Choose cashback or one of seven voucher categories, then choose your ticket amount.",
                  ],
                  [
                    "02",
                    "Book your ticket",
                    "The amount comes from your existing wallet. Cancel for a full refund until sales close, five seconds before the draw.",
                  ],
                  [
                    "03",
                    "Meet your result",
                    "If your selected reward is drawn, you win 10× the ticket amount, including your stake. Otherwise the ticket loses.",
                  ],
                  [
                    "04",
                    "Enjoy your reward",
                    "Cashback credits automatically. For vouchers, open My rewards and request fulfilment. The operator supplies the merchant, code, expiry and redemption instructions.",
                  ],
                ].map(([n, title, text]) => (
                  <article key={n}>
                    <span className="pl-step">{n}</span>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </article>
                ))}
              </div>
              <h2>Odds & reward values</h2>
              <p>
                This draw: {rtp / 10}% chance per selected reward,{" "}
                {100 - rtp * 0.8}% chance of no prize. Theoretical reward-value
                RTP: {rtp}%. The {100 - rtp}% theoretical margin is a long-run
                average; any individual ticket can lose and any draw can cost
                more than its sales.
              </p>
              <p>
                A ₹1,000 winning ticket returns ₹10,000 in cashback or voucher
                face value. Vouchers are not wallet cash. Travel, gadgets and
                gold rewards are value vouchers, not a guaranteed trip, device
                or gold item. No additional purchase is required by this game's
                reward terms; any voucher supplied must honour its full face
                value. Provider stock and manual fulfilment are managed by the
                operator; no instant external issuance is connected.
              </p>
              <h2>Draw verification</h2>
              <p>
                Each draw publishes a commitment before sales. Its seed and
                rules reproduce the result after settlement. Open Results to
                verify. Ticket amounts and popularity never change the outcome.
                If a reward's liability limit is full, new tickets are rejected
                before payment. Rule changes affect newly scheduled draws.
              </p>
            </section>
          ) : tab === "results" ? (
            <section className="pl-content">
              <span className="pl-eyebrow">THE LATEST REVEALS</span>
              <h1>Draw results</h1>
              <p>
                All times IST. Verify the published seed, rules and result for
                each draw.
              </p>
              <div className="pl-history">
                {recent.map((d) => (
                  <article key={d.id}>
                    <div>
                      <span className="pl-status">{rewardName(d.result)}</span>
                      <h3>{date(d.ends)}</h3>
                      <small>
                        {d.id} · RTP {d.config.rtp}%
                      </small>
                    </div>
                    <details>
                      <summary>Draw proof</summary>
                      <p className="pl-proof">
                        Commitment: {d.commitment}
                        <br />
                        Seed: {d.seed}
                      </p>
                      <button
                        className="pl-secondary"
                        onClick={() => {
                          void verifyDraw(d)
                            .then((ok) =>
                              setVerification((v) => ({
                                ...v,
                                [d.id]: ok
                                  ? "Verified: commitment and result match."
                                  : "Verification failed.",
                              })),
                            )
                            .catch(() =>
                              setVerification((v) => ({
                                ...v,
                                [d.id]:
                                  "Verification needs a secure browser connection.",
                              })),
                            );
                        }}
                      >
                        Verify draw
                      </button>
                      <p role="status">{verification[d.id]}</p>
                    </details>
                  </article>
                ))}
                {!recent.length && (
                  <div className="pl-empty">
                    <History />
                    <h3>No results yet</h3>
                    <p>Your first draw is on its way.</p>
                  </div>
                )}
              </div>
            </section>
          ) : (
            <section className="pl-content">
              <span className="pl-eyebrow">YOUR PRIZE LOTTO</span>
              <h1>
                {tab === "rewards"
                  ? "Something to look forward to."
                  : "Every ticket, right here."}
              </h1>
              <p>
                {tab === "rewards"
                  ? "Winning rewards from your ticket history. Cashback is automatic; vouchers are fulfilled by the operator."
                  : "Track your entries, view results and cancel before the sales cutoff."}
              </p>
              <div className="pl-history">
                {tickets.map((t) => {
                  const TIcon = icons[t.reward];
                  const d = data.draws.find((item) => item.id === t.drawId);
                  return (
                    <article key={t.id} data-testid="prize-ticket">
                      <div
                        className="pl-ticket-symbol"
                        style={{
                          color: REWARDS.find((r) => r.id === t.reward)?.color,
                        }}
                      >
                        <TIcon size={27} />
                      </div>
                      <div className="pl-ticket-info">
                        <h3>
                          {rewardName(t.reward)}{" "}
                          <span className={`pl-status ${t.status}`}>
                            {t.status}
                          </span>
                        </h3>
                        <small>
                          {t.id} · {date(t.created)}
                        </small>
                        <p>
                          Ticket {money(t.amount)} ·{" "}
                          {t.status === "won"
                            ? `Reward ${money(t.prize)}`
                            : `Potential reward ${money(t.amount * 10)}`}
                        </p>
                        <small>
                          {t.claimStatus === "credited"
                            ? "Cashback credited to shared wallet"
                            : t.claimStatus === "requested"
                              ? "Claim requested · awaiting operator fulfilment"
                              : t.claimStatus === "available"
                                ? "Your voucher is ready to claim"
                                : t.claimStatus === "fulfilled"
                                  ? "Voucher delivered"
                                  : d
                                    ? `Draw ${date(d.ends)}`
                                    : t.drawId}
                        </small>
                      </div>
                      <div className="pl-ticket-actions">
                        {t.status === "pending" && d && now < d.closes && (
                          <button
                            className="pl-secondary"
                            disabled={busy || state.isError}
                            onClick={() =>
                              void run(
                                `/tickets/${t.id}/cancel`,
                                "Ticket cancelled. Your wallet has been refunded.",
                              )
                            }
                          >
                            Cancel ticket
                          </button>
                        )}
                        {t.claimStatus === "available" && (
                          <button
                            className="pl-primary"
                            disabled={busy || state.isError}
                            onClick={() =>
                              void run(
                                `/tickets/${t.id}/claim`,
                                "Claim requested. Your voucher will appear here after fulfilment.",
                              )
                            }
                          >
                            Claim voucher
                          </button>
                        )}
                        {t.delivery && (
                          <button
                            className="pl-secondary"
                            onClick={() => setDetail(t)}
                          >
                            View voucher
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
                {!tickets.length && (
                  <div className="pl-empty">
                    <Gift size={38} />
                    <h3>
                      {tab === "rewards"
                        ? "Your next possibility awaits."
                        : "No tickets on this page."}
                    </h3>
                    <p>
                      {tab === "rewards"
                        ? "Winning tickets appear here. Check other pages if you have older tickets."
                        : "Pick a reward to book your first ticket."}
                    </p>
                    <button
                      className="pl-primary"
                      onClick={() => navigate("play")}
                    >
                      Explore rewards <ArrowUpRight size={16} />
                    </button>
                  </div>
                )}
              </div>
              <div className="pl-pagination">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </button>
                <span>
                  Ticket page {data.page} / {data.pages}
                </span>
                <button
                  disabled={page >= data.pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </section>
          )}
          <footer className="pl-footer">
            <span>
              prizelotto <i>Little moments. Bigger smiles.</i>
            </span>
            <span>10× reward value · Shared INR wallet · 18+</span>
          </footer>
        </main>
      </div>
      <Dialog
        open={confirm}
        onOpenChange={(open) => {
          if (!busy) setConfirm(open);
        }}
      >
        <DialogContent className="pl-dialog">
          <DialogTitle>
            Confirm your {selected.name.toLowerCase()} ticket
          </DialogTitle>
          <DialogDescription>
            {draw?.id} · Reward chance {rtp / 10}%
          </DialogDescription>
          <div className="pl-confirm-amount">
            <span>Pay {money(amount)}</span>
            <strong>Win {money(amount * 10)}</strong>
          </div>
          <p>
            {reward === "cashback"
              ? "A win credits your shared wallet automatically."
              : "A win awards voucher face value. Request it in My rewards; the operator supplies the redemption code."}{" "}
            The ticket amount is lost if your selection is not drawn.
          </p>
          <button
            className="pl-primary"
            disabled={!canBuy}
            onClick={() => void purchase()}
          >
            {busy ? "Booking…" : `Confirm & pay ${money(amount)}`}
          </button>
          {!isOpen && (
            <p role="status">
              This draw is closed. Close this dialog and wait for the next draw.
            </p>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="pl-dialog">
          <DialogTitle>
            {detail ? rewardName(detail.reward) : "Your"} voucher
          </DialogTitle>
          <DialogDescription>
            Reward value {money(detail?.prize ?? 0)} ·{" "}
            {detail?.delivery?.merchant}
          </DialogDescription>
          <p className="pl-voucher-code">{detail?.delivery?.code}</p>
          <p>{detail?.delivery?.instructions}</p>
          <p>
            Expires{" "}
            {detail?.delivery && date(Date.parse(detail.delivery.expiresAt))}{" "}
            IST
          </p>
          <small>Ticket {detail?.id}</small>
        </DialogContent>
      </Dialog>
    </div>
  );
}
