import { useEffect, useRef, useState } from "react";
import { useStore, store } from "@/game/store";
import { sendChat } from "@/game/engine";
import { claimActiveRain } from "@/game/freeBets";
import { t } from "@/game/i18n";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Send, CloudRain, Heart, ChevronDown } from "lucide-react";
import { EMOJIS } from "@/game/names";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function RainCard() {
  const rain = useStore((s) => s.activeRain);
  const [claiming, setClaiming] = useState(false);
  const [, forceTick] = useState(0);

  // Re-render every second so the countdown stays live and the card
  // disappears on expiry without needing a server push.
  useEffect(() => {
    if (!rain) return;
    const iv = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [rain]);

  if (!rain) return null;
  const msLeft = new Date(rain.expiresAt).getTime() - Date.now();
  if (msLeft <= 0) {
    // Expired — drop the card on the next tick.
    if (store.getState().activeRain?.id === rain.id) {
      queueMicrotask(() => {
        if (store.getState().activeRain?.id === rain.id) {
          store.setState({ activeRain: null });
        }
      });
    }
    return null;
  }
  const secsLeft = Math.max(0, Math.floor(msLeft / 1000));
  const amount = (Math.round(Number(rain.amountPaise) || 0) / 100).toFixed(2);
  const soldOut = rain.claimedCount >= rain.maxClaims;

  const claim = async () => {
    setClaiming(true);
    const err = await claimActiveRain(rain.id);
    setClaiming(false);
    if (err) {
      toast.error(err);
    } else {
      toast.success(`Free bet ₹${amount} claimed!`);
    }
  };

  return (
    <div
      className="mx-2 mt-2 rounded-lg border border-sky-500/40 bg-sky-500/10 p-2.5 space-y-1.5"
      data-testid="card-rain"
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-300">
        <CloudRain className="w-3.5 h-3.5" />
        Rain! Free bet ₹{amount}
      </div>
      {rain.message && (
        <div className="text-[11px] text-muted-foreground break-words">
          {rain.message}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground font-mono">
          {rain.claimedCount}/{rain.maxClaims} claimed • {secsLeft}s
        </span>
        <Button
          size="sm"
          className="h-7 text-xs font-bold bg-sky-500 hover:bg-sky-400 text-white"
          disabled={claiming || rain.claimedByMe || soldOut}
          onClick={claim}
          data-testid="btn-claim-rain"
        >
          {rain.claimedByMe ? "Claimed ✓" : soldOut ? "All gone" : "Claim"}
        </Button>
      </div>
    </div>
  );
}

export default function ChatPanel() {
  const lang = useStore((s) => s.settings.language);
  const chat = useStore((s) => s.chat);
  const onlinePlayers = useStore((s) => s.onlinePlayers);
  const [text, setText] = useState("");
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [atBottom, setAtBottom] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll only when the user is already at the bottom; otherwise show
  // the Aviator-style green "New messages" pill.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (atBottom) {
      el.scrollTo({ top: el.scrollHeight });
      setHasNew(false);
    } else {
      setHasNew(true);
    }
  }, [chat.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAtBottom(nearBottom);
    if (nearBottom) setHasNew(false);
  };

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setAtBottom(true);
    setHasNew(false);
  };

  const submit = () => {
    if (!text.trim()) return;
    sendChat(text);
    setText("");
  };

  return (
    <div className="relative flex flex-col h-full rounded-xl border border-card-border bg-[#101010] overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {lang === "hi" ? "ऑनलाइन" : "Online"}:{" "}
          <span className="font-bold text-accent" data-testid="text-online-count">
            {onlinePlayers.toLocaleString("en-IN")}
          </span>
        </span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {t(lang, "chat")}
        </span>
      </div>
      <RainCard />
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 scrollbar-thin"
      >
        {chat.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-6">
            {t(lang, "saySomething")}
          </div>
        )}
        {chat.map((m) => (
          <div key={m.id} className={cn("flex gap-2 items-start text-xs", m.isMe && "justify-end")}>
            {!m.isMe && (
              <Avatar className="w-5 h-5 text-[10px] shrink-0">
                <AvatarFallback className="bg-secondary text-muted-foreground">
                  {m.name[0]}
                </AvatarFallback>
              </Avatar>
            )}
            <div
              className={cn(
                "max-w-[80%] px-2.5 py-1.5 rounded-xl",
                m.isMe ? "bg-primary/25 text-foreground" : "bg-[#1c1c1c]",
              )}
            >
              {!m.isMe && (
                <div className="text-[10px] text-muted-foreground font-semibold mb-0.5">
                  {m.name}
                </div>
              )}
              <div className="break-words">{m.text}</div>
            </div>
            {!m.isMe && (
              <button
                className="shrink-0 self-center p-1 text-muted-foreground/60 hover:text-primary"
                onClick={() => setLiked((l) => ({ ...l, [m.id]: !l[m.id] }))}
                aria-label="Like message"
              >
                <Heart
                  className={cn("w-3 h-3", liked[m.id] && "fill-primary text-primary")}
                />
              </button>
            )}
          </div>
        ))}
      </div>
      {hasNew && (
        <button
          onClick={jumpToLatest}
          className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#28a909] text-white text-xs font-bold shadow-lg"
          data-testid="btn-new-messages"
        >
          {lang === "hi" ? "नए संदेश" : "New messages"}
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      )}
      <div className="px-2 py-1.5 border-t border-border flex gap-1">
        {EMOJIS.slice(0, 6).map((e) => (
          <button
            key={e}
            className="text-base hover-elevate rounded px-1"
            onClick={() => sendChat(e)}
          >
            {e}
          </button>
        ))}
      </div>
      <div className="p-2 border-t border-border flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={t(lang, "typeMessage")}
          className="h-8 text-xs"
          maxLength={140}
        />
        <Button size="icon" className="h-8 w-8" onClick={submit}>
          <Send className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
