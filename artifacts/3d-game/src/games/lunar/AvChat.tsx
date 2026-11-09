import { useEffect, useRef, useState } from "react";
import { useStore } from "@/game/store";
import { sendChat } from "@/game/engine";
import { RainCard } from "@/components/lunar/ChatPanel";
import { Heart, ChevronDown, ChevronLeft, X, Send, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { nameColor, fmtHMS, maskName } from "./avUtils";
import { PlayerAvatar } from "./PlayerAvatar";

const MAX_LEN = 160;

/**
 * Picker contents. The reference shows a full grid several rows deep with a
 * working search, so the six-emoji quick row we had before reads as empty by
 * comparison. Keywords exist so "Search emoji.." actually filters — a search
 * box that does nothing is worse than none.
 */
const PICKER: ReadonlyArray<readonly [string, string]> = [
  ["😀", "grin smile happy"], ["😃", "smile happy joy"], ["😄", "smile laugh happy"],
  ["😁", "beam grin happy"], ["😆", "laugh satisfied"], ["😅", "sweat laugh"],
  ["🤣", "rofl laugh"], ["😂", "joy tears laugh"], ["🙂", "slight smile"],
  ["😉", "wink"], ["😊", "blush smile happy"], ["😇", "innocent angel"],
  ["😍", "heart eyes love"], ["🤩", "star struck wow"], ["😘", "kiss love"],
  ["😋", "yum tasty"], ["😜", "wink tongue crazy"], ["🤪", "zany crazy"],
  ["🤨", "raised brow doubt"], ["😎", "cool sunglasses"], ["🥳", "party celebrate"],
  ["😏", "smirk"], ["😒", "unamused meh"], ["😞", "sad disappointed"],
  ["😭", "cry sob sad"], ["😤", "triumph angry steam"], ["😡", "angry rage mad"],
  ["🤯", "mind blown shock"], ["😱", "scream shock fear"], ["😨", "fear anxious"],
  ["🥶", "cold freeze"], ["😴", "sleep tired"], ["🤑", "money rich cash"],
  ["🤗", "hug"], ["🤔", "think hmm"], ["🤐", "zip quiet"],
  ["😬", "grimace awkward"], ["🙄", "eye roll"], ["😳", "flushed shock"],
  ["🚀", "rocket moon up fly"], ["🔥", "fire hot lit"], ["💎", "diamond hands gem"],
  ["💸", "money fly cash loss"], ["💰", "money bag rich"], ["🏆", "trophy win"],
  ["🎯", "target aim"], ["👀", "eyes look watch"], ["🛫", "plane takeoff fly"],
  ["💀", "skull dead rip"], ["🤞", "fingers crossed luck"], ["🙏", "pray please"],
  ["👍", "thumbs up good"], ["👎", "thumbs down bad"], ["❤️", "heart love"],
];

// Tokens measured off the reference panel (docs/aviator-chat-panel-spec.md).
const PANEL_BG = "#131417";
const SURFACE = "#26272B"; // header pill + message bubbles
const INPUT_BG = "#1E1F23";
const CONTROL = "#3A3B40"; // info circle, search field
const TEXT_2 = "#9EA0A4";
const TIMESTAMP = "#6E7076";
const PLACEHOLDER = "#7C7E83";
const ONLINE_GREEN = "#2FBE0E";
const HEART_IDLE = "#2F3034";

/**
 * Spribe-exact chat column. Structure and every value below come from the
 * measured spec: a 46px header pill floating 6px inside the panel, message
 * rows of [38px avatar | bubble | like column], and a single rounded input
 * container holding the text field, a toolbar, and the expanding emoji panel.
 *
 * Not built (see the notes at the end of the spec): the purple win-share
 * "ticket" cards, which need structured win data rather than the plain text
 * our chat carries, and the player-initiated Rain panel, which moves real
 * money and has no server endpoint behind it yet. The rain cloud below opens
 * nothing rather than pretending.
 */
export default function AvChat({ onClose }: { onClose?: () => void }) {
  const chat = useStore((s) => s.chat);
  const onlinePlayers = useStore((s) => s.onlinePlayers);
  const [text, setText] = useState("");
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [atBottom, setAtBottom] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiQuery, setEmojiQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const q = emojiQuery.trim().toLowerCase();
  const shownEmoji = q ? PICKER.filter(([, kw]) => kw.includes(q)) : PICKER;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (atBottom) {
      el.scrollTo({ top: el.scrollHeight });
      setHasNew(false);
    } else {
      setHasNew(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAtBottom(near);
    if (near) setHasNew(false);
  };

  const jump = () => {
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
    <div
      className="relative flex h-full flex-col overflow-hidden"
      style={{ background: PANEL_BG }}
    >
      {/* Header pill — 46px, radius 10, inset 6px */}
      <div
        className="mx-[6px] mt-[6px] flex h-[46px] shrink-0 items-center rounded-[10px] px-3"
        style={{ background: SURFACE }}
      >
        <button
          onClick={() =>
            toast.info("Be respectful. No spam, no links, no personal details in chat.")
          }
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-serif text-[15px] text-white transition-opacity hover:opacity-80"
          style={{ background: CONTROL }}
          aria-label="Chat rules"
          data-testid="btn-chat-rules"
        >
          i
        </button>

        <span className="flex-1 text-center text-[14px]" style={{ color: TEXT_2 }}>
          Online:{" "}
          <span
            className="font-bold tabular-nums"
            style={{ color: ONLINE_GREEN }}
            data-testid="text-online-count"
          >
            {onlinePlayers.toLocaleString("en-IN")}
          </span>
        </span>

        {/* The screenshots show this in the same 32px circle as the info
            button, not the bare glyph the written spec describes. */}
        {onClose ? (
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-80"
            style={{ background: CONTROL, color: PLACEHOLDER }}
            aria-label="Close chat"
            data-testid="btn-chat-close"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        ) : (
          <span className="w-8 shrink-0" />
        )}
      </div>

      <RainCard />

      {/* Message list */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-[6px] py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {chat.length === 0 && (
          <div className="py-6 text-center text-[12px]" style={{ color: TIMESTAMP }}>
            Say something…
          </div>
        )}
        {chat.map((m) => (
          <div key={m.id} className="mb-2 flex items-end gap-2">
            <PlayerAvatar
              name={m.name}
              className="h-[38px] w-[38px] shrink-0 rounded-full text-center text-[14px] font-bold leading-[38px] text-white"
            />

            {/* Bubble sits in a flexible cell so the like column below is
                pinned to the panel's right edge — the hearts line up down the
                list regardless of how long each message is. */}
            <div className="min-w-0 flex-1">
            <div
              className="w-fit max-w-[230px] rounded-[10px] px-[10px] py-[6px]"
              style={{ background: SURFACE }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="truncate text-[12px] font-bold"
                  style={{ color: m.isMe ? ONLINE_GREEN : nameColor(m.name) }}
                >
                  {m.isMe ? "You" : maskName(m.name)}
                </span>
                <span
                  className="shrink-0 text-[11px] tabular-nums"
                  style={{ color: TIMESTAMP }}
                >
                  {fmtHMS(m.ts)}
                </span>
              </div>
              <p className="break-words text-[14px] font-medium leading-[1.35] text-white">
                {m.text}
              </p>
            </div>
            </div>

            <button
              onClick={() => setLiked((l) => ({ ...l, [m.id]: !l[m.id] }))}
              className="flex w-[28px] shrink-0 flex-col items-center self-center"
              aria-label="Like message"
            >
              <Heart
                className="h-5 w-5"
                style={{
                  fill: liked[m.id] ? "#e50539" : HEART_IDLE,
                  color: liked[m.id] ? "#e50539" : HEART_IDLE,
                }}
              />
              {liked[m.id] && (
                <span className="text-[11px]" style={{ color: TIMESTAMP }}>
                  1
                </span>
              )}
            </button>
          </div>
        ))}
      </div>

      {hasNew && (
        <button
          onClick={jump}
          className="absolute bottom-[92px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[#28a909] px-2.5 py-1 text-[11px] font-bold text-white shadow-lg"
          data-testid="btn-new-messages"
        >
          New messages
          <ChevronDown className="h-3 w-3" />
        </button>
      )}

      {/* Input area — one rounded container: text row, toolbar, then the
          emoji panel expanding upward above the toolbar's own row. */}
      <div
        className="m-[6px] shrink-0 rounded-[13px]"
        style={{ background: INPUT_BG }}
      >
        <input
          value={text}
          maxLength={MAX_LEN}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Your message..."
          className="w-full bg-transparent px-[14px] py-3 text-[15px] text-white outline-none"
          style={{ ["--tw-placeholder-opacity" as string]: 1 }}
          data-testid="input-chat"
        />

        <div className="flex items-center gap-3 px-3 pb-2">
          {emojiOpen && (
            <>
              <button
                onClick={() => setEmojiOpen(false)}
                aria-label="Close emoji picker"
                style={{ color: TEXT_2 }}
              >
                <ChevronLeft className="h-[19px] w-[19px]" />
              </button>
              <span className="h-4 w-px" style={{ background: CONTROL }} />
            </>
          )}

          {/* Real emoji glyphs, greyscaled when the tab is inactive — that is
              how the reference renders them, and no outline icon matches. */}
          <button
            onClick={() => setEmojiOpen((v) => !v)}
            aria-label="Emoji"
            data-testid="btn-chat-emoji"
            className={cn(
              "text-[19px] leading-none transition",
              !emojiOpen && "opacity-70 grayscale",
            )}
          >
            😊
          </button>

          <button
            onClick={() =>
              toast.info("Rain is sent by the operator — watch chat for a drop to claim.")
            }
            aria-label="Rain"
            data-testid="btn-chat-rain"
            className="text-[19px] leading-none opacity-70 grayscale transition"
          >
            🌧️
          </button>

          {/* Centred in the row, not pinned to the send button — the spec puts
              this "center-right", between the tab icons and the plane. */}
          <span
            className="flex-1 text-center text-[14px] tabular-nums"
            style={{ color: TEXT_2 }}
          >
            aA {MAX_LEN - text.length}
          </span>

          <button
            onClick={submit}
            aria-label="Send"
            data-testid="btn-chat-send"
            style={{ color: text.trim() ? ONLINE_GREEN : "#96989C" }}
          >
            <Send className="h-[18px] w-[18px]" />
          </button>
        </div>

        {emojiOpen && (
          <div className="px-[10px] pb-[10px]">
            {/* Search pill — 35px, fully rounded, #3A3B40 */}
            <div
              className="mb-[10px] flex h-[35px] items-center gap-2 rounded-full px-3"
              style={{ background: CONTROL }}
            >
              <Search className="h-4 w-4 shrink-0" style={{ color: "#9A9CA0" }} />
              <input
                value={emojiQuery}
                onChange={(e) => setEmojiQuery(e.target.value)}
                placeholder="Search emoji.."
                className="min-w-0 flex-1 bg-transparent text-[14px] text-white outline-none placeholder:text-[#9A9CA0]"
                data-testid="input-emoji-search"
              />
            </div>

            <div className="grid max-h-[180px] grid-cols-9 gap-[10px] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {shownEmoji.map(([e]) => (
                <button
                  key={e}
                  onClick={() => setText((t) => (t + e).slice(0, MAX_LEN))}
                  className="text-[22px] leading-none transition-transform hover:scale-125"
                >
                  {e}
                </button>
              ))}
              {shownEmoji.length === 0 && (
                <span className="col-span-9 py-2 text-center text-[12px]" style={{ color: TIMESTAMP }}>
                  No emoji found
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
