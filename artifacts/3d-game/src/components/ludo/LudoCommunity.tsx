import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  ArrowLeft,
  Check,
  Copy,
  Send,
  ShieldBan,
  UserPlus,
  X,
} from "lucide-react";
import type { LudoRoomPreview } from "@workspace/api-zod/ludo";
import { LudoArtwork } from "./LudoArtwork";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
type Friend = {
  id: string;
  name: string;
  code: string;
  status: string;
  incoming: boolean;
  blockedByYou: boolean;
  online: boolean;
};
type Social = { friendCode: string; friends: Friend[] };
type Message = {
  id: string;
  mine: boolean;
  kind: string;
  text: string;
  roomCode: string | null;
  at: number;
};
const money = (v: string) => `₹${(Number(v) / 100).toLocaleString("en-IN")}`;
export function LudoCommunity({
  userId,
  onBack,
  roomCode,
}: {
  userId: string;
  onBack: () => void;
  roomCode?: string;
}) {
  const [code, setCode] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false),
    [preview, setPreview] = useState<LudoRoomPreview | null>(null);
  const pending = useRef<{ payload: string; requestId: string } | null>(null),
    joinRequest = useRef<{ code: string; requestId: string } | null>(null);
  const social = useQuery({
    queryKey: ["ludo-social", userId],
    queryFn: () => customFetch<Social>("/api/ludo/social"),
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
  });
  const friend = social.data?.friends.find((f) => f.id === selected);
  const chat = useQuery({
    queryKey: ["ludo-dm", userId, selected],
    queryFn: () =>
      customFetch<{ messages: Message[] }>(
        `/api/ludo/social/${selected}/messages`,
      ),
    enabled:
      !!selected && friend?.status === "accepted" && !friend.blockedByYou,
    refetchInterval: 4000,
    refetchIntervalInBackground: false,
  });
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again");
    } finally {
      setBusy(false);
    }
  };
  const action = (f: Friend, a: string) =>
    void run(async () => {
      await customFetch(`/api/ludo/social/${f.id}`, {
        method: "POST",
        body: JSON.stringify({ action: a }),
      });
      await social.refetch();
      if (a !== "accept") setSelected(null);
    });
  const send = (invite?: string) =>
    void run(async () => {
      const payload = JSON.stringify({
        friend: selected,
        text: invite ? undefined : text.trim(),
        roomCode: invite,
      });
      if (pending.current?.payload !== payload)
        pending.current = { payload, requestId: crypto.randomUUID() };
      await customFetch(`/api/ludo/social/${selected}/messages`, {
        method: "POST",
        body: JSON.stringify({
          requestId: pending.current.requestId,
          ...(invite ? { roomCode: invite } : { text: text.trim() }),
        }),
      });
      pending.current = null;
      setText("");
      await chat.refetch();
    });
  return (
    <section
      className="ld-community ld-feature-screen"
      aria-label="Friends and chat"
    >
      <header className="ld-feature-header">
        <button
          aria-label={selected ? "Back to friends" : "Back to main menu"}
          onClick={() => (selected ? setSelected(null) : onBack())}
        >
          <ArrowLeft />
        </button>
        <div>
          <strong>{friend?.name || "ADDA & FRIENDS"}</strong>
          <small>
            {friend
              ? friend.online
                ? "Online now"
                : "Offline · messages are saved"
              : "Your people. Your next game."}
          </small>
        </div>
        <LudoArtwork kind="chat" />
      </header>
      {(error || social.error || chat.error) && (
        <p className="ld-feature-error" role="alert">
          {error || (social.error ?? chat.error)?.message}
        </p>
      )}
      {!selected ? (
        <div className="ld-feature-body">
          <div className="ld-friend-code">
            <span>YOUR FRIEND CODE</span>
            <strong>{social.data?.friendCode ?? "Loading…"}</strong>
            <button
              disabled={!social.data}
              onClick={() =>
                void run(async () => {
                  await navigator.clipboard.writeText(social.data!.friendCode);
                  setCopied(true);
                })
              }
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <form
            className="ld-friend-add"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await customFetch("/api/ludo/social/request", {
                  method: "POST",
                  body: JSON.stringify({ code }),
                });
                setCode("");
                await social.refetch();
              });
            }}
          >
            <label htmlFor="ludo-friend-code">Add by friend code</label>
            <div>
              <input
                id="ludo-friend-code"
                value={code}
                onChange={(e) =>
                  setCode(
                    e.target.value
                      .replace(/[^a-fA-F0-9]/g, "")
                      .toUpperCase()
                      .slice(0, 12),
                  )
                }
                placeholder="12-character code"
                maxLength={12}
              />
              <button
                disabled={busy || code.length !== 12}
                aria-label="Send friend request"
              >
                <UserPlus />
              </button>
            </div>
          </form>
          <div className="ld-friends-list">
            {social.data?.friends.map((f) => (
              <article key={f.id} className="ld-friend-row">
                <LudoArtwork kind="profile" />
                <div>
                  <strong>{f.name}</strong>
                  <small>
                    {f.blockedByYou
                      ? "Blocked"
                      : f.status === "pending"
                        ? f.incoming
                          ? "Wants to be your friend"
                          : "Request sent"
                        : f.online
                          ? "Online now"
                          : "Offline"}
                  </small>
                </div>
                {f.blockedByYou ? (
                  <button disabled={busy} onClick={() => action(f, "unblock")}>
                    Unblock
                  </button>
                ) : f.status === "pending" ? (
                  <>
                    {f.incoming && (
                      <button
                        aria-label={`Accept ${f.name}`}
                        disabled={busy}
                        onClick={() => action(f, "accept")}
                      >
                        <Check />
                      </button>
                    )}
                    <button
                      aria-label={`Remove request from ${f.name}`}
                      disabled={busy}
                      onClick={() => action(f, "remove")}
                    >
                      <X />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => {
                      setSelected(f.id);
                      setError("");
                    }}
                  >
                    Chat
                  </button>
                )}
              </article>
            ))}
            {social.data && !social.data.friends.length && (
              <div className="ld-feature-empty">
                <LudoArtwork kind="friends" />
                <h2>Start your circle</h2>
                <p>
                  Share your friend code, accept a request and chat before your
                  next match.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="ld-community-thread">
          <div className="ld-thread-tools">
            {roomCode && (
              <button disabled={busy} onClick={() => send(roomCode)}>
                Invite to room {roomCode}
              </button>
            )}
            <button
              disabled={busy}
              onClick={() => friend && action(friend, "block")}
            >
              <ShieldBan size={16} /> Block
            </button>
            <button
              disabled={busy}
              onClick={() => friend && action(friend, "remove")}
            >
              Remove friend
            </button>
          </div>
          <div
            className="ld-direct-messages"
            role="log"
            aria-label="Conversation"
          >
            {chat.data?.messages.map((m) => (
              <article key={m.id} className={m.mine ? "mine" : ""}>
                <p>{m.text}</p>
                {m.roomCode && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        setPreview(
                          await customFetch<LudoRoomPreview>(
                            `/api/ludo/rooms/${m.roomCode}`,
                          ),
                        );
                      })
                    }
                  >
                    View room {m.roomCode}
                  </button>
                )}
                <time>
                  {new Date(m.at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </article>
            ))}
            {!chat.data?.messages.length && (
              <p className="ld-chat-empty">
                Say hello. Messages here are free.
              </p>
            )}
          </div>
          <form
            className="ld-direct-compose"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              aria-label="Message your friend"
              value={text}
              maxLength={500}
              onChange={(e) => setText(e.target.value)}
              placeholder="Write a message…"
            />
            <button aria-label="Send message" disabled={busy || !text.trim()}>
              <Send />
            </button>
          </form>
        </div>
      )}
      <Dialog
        open={!!preview}
        onOpenChange={(v) => {
          if (!v) setPreview(null);
        }}
      >
        <DialogContent className="ld-modal">
          <DialogTitle>Join your friend's room</DialogTitle>
          <DialogDescription>
            Confirm the current entry before joining. A full or expired room
            cannot be joined.
          </DialogDescription>
          {preview && (
            <>
              <p>
                {preview.capacity} players · {preview.variant} ·{" "}
                {preview.joined} joined
              </p>
              <p>
                Entry <strong>{money(preview.entryPaise)}</strong> · Prize{" "}
                <strong>{money(preview.prizePaise)}</strong>
              </p>
              <button
                className="ld-feature-primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (joinRequest.current?.code !== preview.code)
                      joinRequest.current = {
                        code: preview.code,
                        requestId: crypto.randomUUID(),
                      };
                    await customFetch("/api/ludo/join", {
                      method: "POST",
                      body: JSON.stringify({
                        mode: "private",
                        variant: preview.variant,
                        capacity: preview.capacity,
                        entryPaise: Number(preview.entryPaise),
                        roomCode: preview.code,
                        requestId: joinRequest.current.requestId,
                      }),
                    });
                    setPreview(null);
                    onBack();
                  })
                }
              >
                Join for {money(preview.entryPaise)}
              </button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
