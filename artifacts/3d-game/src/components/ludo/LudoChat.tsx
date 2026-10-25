import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Smile } from "lucide-react";
import {
  ApiError,
  customFetch,
  useRealtimeResync,
  useRealtimeTopic,
  getGetWalletBalanceQueryKey,
  getListWalletTransactionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  LUDO,
  LUDO_EMOJIS,
  type LudoChat as ChatData,
  type LudoChatInput,
  type LudoMatch,
} from "@workspace/api-zod/ludo";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export function LudoChat({
  match,
  userId,
  onWalletChange,
  openRequest = 0,
}: {
  match: LudoMatch;
  userId: string;
  onWalletChange: () => void;
  openRequest?: number;
}) {
  const [open, setOpen] = useState(false),
    [tray, setTray] = useState(false),
    [draft, setDraft] = useState("");
  const handledOpenRequest = useRef(openRequest);
  useEffect(() => {
    if (openRequest !== handledOpenRequest.current) {
      handledOpenRequest.current = openRequest;
      setOpen(true);
      setTray(true);
    }
  }, [openRequest]);
  const [data, setData] = useState<ChatData | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<LudoChatInput | null>(null),
    [seen, setSeen] = useState(0);
  const sending = useRef(false),
    syncing = useRef(false),
    alive = useRef(true),
    end = useRef<HTMLDivElement>(null);
  const qc = useQueryClient(),
    walletChanged = useRef(onWalletChange);
  walletChanged.current = onWalletChange;
  const key = `ludo-chat-pending:${userId}:${match.id}`;
  const remember = useCallback(
    (value: LudoChatInput | null) => {
      setPending(value);
      try {
        value
          ? sessionStorage.setItem(key, JSON.stringify(value))
          : sessionStorage.removeItem(key);
      } catch {}
    },
    [key],
  );
  const accept = useCallback((next: ChatData) => {
    if (!alive.current) return;
    setData((current) =>
      (current?.messages.at(-1)?.at ?? 0) > (next.messages.at(-1)?.at ?? 0)
        ? current
        : next,
    );
  }, []);
  const sync = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      accept(
        await customFetch<ChatData>(`/api/ludo/${match.id}/chat`, {
          signal: AbortSignal.timeout(8000),
        }),
      );
    } catch {
      /* Retain saved messages; failed sends have an explicit retry control. */
    } finally {
      syncing.current = false;
    }
  }, [match.id, accept]);
  const submit = useCallback(
    async (input: LudoChatInput) => {
      if (sending.current) return;
      sending.current = true;
      setBusy(true);
      setError("");
      remember(input);
      try {
        const next = await customFetch<ChatData>(`/api/ludo/${match.id}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(10000),
        });
        if (!alive.current) return;
        accept(next);
        remember(null);
        setDraft("");
        void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
        void qc.invalidateQueries({
          queryKey: getListWalletTransactionsQueryKey(),
        });
        walletChanged.current();
      } catch (e) {
        if (!alive.current) return;
        setError(
          e instanceof Error ? e.message : "Message could not be confirmed",
        );
        if (
          e instanceof ApiError &&
          e.status >= 400 &&
          e.status < 500 &&
          ![408, 429].includes(e.status)
        )
          remember(null);
      } finally {
        sending.current = false;
        if (alive.current) {
          setBusy(false);
          void sync();
        }
      }
    },
    [match.id, remember, accept, qc, sync],
  );
  useEffect(() => {
    alive.current = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || "null");
      if (saved?.requestId && ["text", "emoji"].includes(saved.kind)) {
        remember(saved);
        setError(
          "A message is awaiting confirmation. Retry to confirm it without another charge.",
        );
      }
    } catch {}
    void sync();
    const timer = setInterval(() => void sync(), 3000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [key, sync, remember]);
  useRealtimeTopic(`ludo-chat:${userId}`, () => void sync());
  useRealtimeResync(() => void sync());
  useEffect(() => {
    if (match.status !== "playing" || match.state.players[match.you]?.forfeited)
      setOpen(false);
  }, [match.status, match.state.players[match.you]?.forfeited]);
  const last = data?.messages.at(-1)?.at ?? 0;
  useEffect(() => {
    if (open) {
      setSeen(last);
      end.current?.scrollIntoView({ block: "nearest" });
    }
  }, [last, open]);
  const canSend =
    !!data?.canSend &&
    match.status === "playing" &&
    !match.state.players[match.you]?.forfeited;
  const cost = data?.emojiPaise ?? LUDO.emojiPaise;
  const blocked = busy || !!pending || !canSend;
  return (
    <>
      <button
        className="ld-chat-toggle"
        aria-label="Match chat"
        onClick={() => setOpen(true)}
      >
        <MessageCircle size={20} />
        {last > seen && <i aria-label="Unread messages" />}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="ld-modal ld-chat-modal">
          <DialogTitle>Match chat</DialogTitle>
          <DialogDescription>
            Only players at this table. Text is free · each emoji ₹{cost / 100}.
          </DialogDescription>
          <div
            className="ld-chat-log"
            role="log"
            aria-label="Match messages"
            aria-live="polite"
          >
            {!data?.messages.length && (
              <p className="ld-chat-empty">Say hello to your table 👋</p>
            )}
            {data?.messages.map((message) => (
              <div
                key={message.id}
                className={`ld-chat-message${message.seat === match.you ? " ld-chat-own" : ""}`}
              >
                <small>
                  {message.name}
                  {message.seat === match.you ? " · YOU" : ""}
                </small>
                <span
                  className={message.kind === "emoji" ? "ld-chat-emoji" : ""}
                >
                  {message.text}
                </span>
                {message.kind === "emoji" && (
                  <em>₹{Number(message.costPaise) / 100} emoji</em>
                )}
              </div>
            ))}
            <div ref={end} />
          </div>
          {error && (
            <div className="ld-chat-error" role="alert">
              {error}
            </div>
          )}
          {pending && (
            <button
              className="ld-secondary"
              disabled={busy}
              onClick={() => void submit(pending)}
            >
              Retry message · no duplicate charge
            </button>
          )}
          {canSend ? (
            <>
              <div className="ld-chat-compose">
                <button
                  aria-label="Paid emojis"
                  aria-expanded={tray}
                  onClick={() => setTray((v) => !v)}
                >
                  <Smile />
                </button>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!blocked && draft.trim())
                      void submit({
                        kind: "text",
                        text: draft.trim(),
                        requestId: crypto.randomUUID(),
                      });
                  }}
                >
                  <input
                    aria-label="Chat message"
                    placeholder="Type a free message…"
                    value={draft}
                    maxLength={200}
                    onChange={(e) => setDraft(e.target.value)}
                    disabled={busy || !!pending}
                  />
                  <button
                    aria-label="Send message"
                    disabled={blocked || !draft.trim()}
                  >
                    <Send size={20} />
                  </button>
                </form>
              </div>
              {tray && (
                <div className="ld-emoji-tray" aria-label="Paid emoji shop">
                  <p>Tap to send · ₹{cost / 100} each from your wallet</p>
                  <div>
                    {LUDO_EMOJIS.map((emoji) => (
                      <button
                        key={emoji.id}
                        aria-label={`Send ${emoji.name} for ₹${cost / 100}`}
                        disabled={
                          blocked || Number(data?.balancePaise ?? 0) < cost
                        }
                        onClick={() =>
                          void submit({
                            kind: "emoji",
                            emojiId: emoji.id,
                            requestId: crypto.randomUUID(),
                          })
                        }
                      >
                        <span>{emoji.glyph}</span>
                        <small>₹{cost / 100}</small>
                      </button>
                    ))}
                  </div>
                  {Number(data?.balancePaise ?? 0) < cost && (
                    <p>Not enough wallet balance for an emoji.</p>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="ld-chat-empty">
              {data
                ? "Chat is read-only after leaving or finishing this match."
                : "Connecting to your table…"}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
