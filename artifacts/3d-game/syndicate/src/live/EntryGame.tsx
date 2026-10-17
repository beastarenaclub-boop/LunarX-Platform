"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Check,
  ChevronRight,
  KeyRound,
  LockKeyhole,
  MoveUpRight,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Emblem } from "../App";
import EntrySoundscape from "./EntrySoundscape";
import CyberBackdrop from "./CyberBackdrop";
import VisitorCheckIn from "./VisitorCheckIn";
import { playEntrySound } from "./entry-audio";

type Stage = "puzzle" | "gate" | "walk" | "chamber" | "unlock";
const INITIAL = [1, 2, 1];
const spots = [
  {
    name: "lantern alcove",
    empty: "Sirf ek purana lantern. Roshni ke aage bhi dekho.",
    found: "Lantern ke peeche ek sunehri key chamak rahi hai.",
  },
  {
    name: "cracked stone",
    empty: "Patthar ke neeche dhool hai. Talash jaari rakho.",
    found: "Patthar ke neeche gate ki key chhupi hui hai.",
  },
  {
    name: "stone pedestal",
    empty: "Yeh pedestal khaali hai. Kamre ki doosri taraf dekho.",
    found: "Pedestal ke andar ek chhoti sunehri key hai.",
  },
];

export function TrianglePuzzle({
  angles,
  rotate,
  disabled = false,
  camera,
  cameraLocked = false,
  eyeMarked = false,
}: {
  angles: number[];
  rotate: (index: number) => void;
  disabled?: boolean;
  camera?: () => void;
  cameraLocked?: boolean;
  eyeMarked?: boolean;
}) {
  return (
    <svg
      className="init-triangle"
      viewBox="0 0 500 450"
      aria-label="Three-piece triangle puzzle"
    >
      <defs>
        <linearGradient id="init-metal" x2="0.6" y2="1">
          <stop stopColor="#50422b" />
          <stop offset=".5" stopColor="#27281f" />
          <stop offset="1" stopColor="#111a18" />
        </linearGradient>
        <radialGradient id="init-eye-glow">
          <stop stopColor="#e1bd69" stopOpacity=".27" />
          <stop offset="1" stopColor="#e1bd69" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle
        cx="250"
        cy="246"
        r="206"
        fill="none"
        stroke="#8c754c"
        strokeOpacity=".15"
        strokeDasharray="2 12"
      />
      <path
        d="M250 17 21 414H479Z"
        fill="none"
        stroke="#977b45"
        strokeOpacity=".25"
      />
      <path
        d="M250 40 46 394H454Z"
        fill="#111712"
        stroke="#897a50"
        strokeWidth="1.5"
      />
      {[
        [250, 163, 0],
        [149, 338, -120],
        [351, 338, 120],
      ].map(([x, y, base], index) => (
        <g
          key={index}
          className={`init-fragment ${angles[index] === 0 ? "aligned" : ""}`}
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-label={`Rotate ${["upper", "left", "right"][index]} triangle fragment`}
          aria-pressed={angles[index] === 0}
          aria-disabled={disabled}
          onClick={() => !disabled && rotate(index)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!disabled) rotate(index);
            }
          }}
        >
          <g transform={`translate(${x} ${y})`}>
            <g
              className="init-piece-turn"
              style={{ transform: `rotate(${base + angles[index] * 120}deg)` }}
            >
              <path
                d="M0-108-94 54H94Z"
                fill="url(#init-metal)"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M0-91-79 45H79Z"
                fill="none"
                stroke="currentColor"
                strokeOpacity=".28"
              />
              <path
                className="init-conduit"
                d="M0-80V19M-35-8 0 27 35-8M0 27V51"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
              />
              <circle cy="-53" r="5" fill="#141913" stroke="currentColor" />
              <path d="M-56 34h13m86 0h13" stroke="currentColor" />
            </g>
            <circle r="18" fill="none" className="init-focus-ring" />
          </g>
        </g>
      ))}
      <circle cx="250" cy="268" r="83" fill="url(#init-eye-glow)" />
      <g
        className={`init-eye ${camera ? "camera-eye" : ""} ${eyeMarked ? "eye-marked" : ""}`}
        fill="none"
        stroke="#d6b674"
        strokeWidth="1.8"
        role={camera ? "button" : undefined}
        tabIndex={camera ? 0 : undefined}
        aria-label={camera ? "Open visitor camera check-in" : undefined}
        aria-haspopup={camera ? "dialog" : undefined}
        aria-disabled={camera ? cameraLocked : undefined}
        onClick={() => {
          if (!cameraLocked) camera?.();
        }}
        onKeyDown={(event) => {
          if (
            camera &&
            !cameraLocked &&
            (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            camera();
          }
        }}
      >
        {camera && (
          <circle cx="250" cy="265" r="44" fill="#121910" stroke="none" />
        )}
        <g className="seal-eye-lid">
          <path d="M206 265Q250 219 294 265Q250 311 206 265Z" />
          <circle cx="250" cy="265" r="17" />
          <circle cx="250" cy="265" r="5" fill="#dfc381" />
        </g>
        <path
          d="M250 225v-13m0 106v-13m-53-40h-13m132 0h-13"
          strokeOpacity=".5"
        />
        {eyeMarked && (
          <g
            className="eye-complete-mark"
            role="img"
            aria-label="Eye check-in complete"
          >
            <circle cx="284" cy="297" r="15" fill="#102b1b" stroke="#a4e8b3" />
            <path d="m277 297 5 5 9-11" stroke="#a4e8b3" strokeWidth="3" />
          </g>
        )}
      </g>
      <text
        x="250"
        y="440"
        textAnchor="middle"
        fill="#8a826d"
        fontSize="9"
        letterSpacing="5"
      >
        ALIGN THE THREE / AWAKEN THE EYE
      </text>
    </svg>
  );
}

function Passage({
  walking,
  chamber,
  progress,
}: {
  walking: boolean;
  chamber: boolean;
  progress: number;
}) {
  return (
    <div
      className={`init-passage ${walking ? "walking" : ""} ${chamber ? "arrived" : ""}`}
      style={{ "--travel": progress } as CSSProperties}
      aria-hidden="true"
    >
      <svg
        className="init-architecture"
        viewBox="0 0 1400 850"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="init-wall">
            <stop stopColor="#080d0c" />
            <stop offset=".5" stopColor="#26302a" />
            <stop offset="1" stopColor="#080d0c" />
          </linearGradient>
          <linearGradient id="init-ground" x2="0" y2="1">
            <stop stopColor="#25271b" />
            <stop offset="1" stopColor="#080e0e" />
          </linearGradient>
          <radialGradient id="init-light">
            <stop stopColor="#dbc88a" stopOpacity=".5" />
            <stop offset=".4" stopColor="#8d8553" stopOpacity=".17" />
            <stop offset="1" stopColor="#546453" stopOpacity="0" />
          </radialGradient>
        </defs>
        <path d="M0 0H1400V850H0Z" fill="#0c1311" />
        <path
          d="M0 0 590 255V565L0 850ZM1400 0 810 255V565L1400 850Z"
          fill="url(#init-wall)"
        />
        <path d="M590 565H810L1400 850H0Z" fill="url(#init-ground)" />
        <g stroke="#81917c" strokeOpacity=".14" fill="none">
          {[0, 140, 280, 420, 560, 700, 840, 980, 1120, 1260, 1400].map((x) => (
            <path key={x} d={`M700 475 ${x} 850`} />
          ))}
          {[575, 602, 644, 706, 795].map((y) => (
            <path key={y} d={`M0 ${y}H1400`} />
          ))}
          <path d="M0 285 590 350M0 570 590 446M1400 285 810 350M1400 570 810 446" />
        </g>
        <ellipse cx="700" cy="480" rx="350" ry="430" fill="url(#init-light)" />
        <path
          className="init-floor-light"
          d="M680 560H720L1040 850H360Z"
          fill="#ddc16f"
          fillOpacity=".055"
        />
      </svg>
      <div className="init-arches">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            className="init-arch"
            key={i}
            style={{ "--depth": i } as CSSProperties}
          >
            <span />
            <span />
          </div>
        ))}
      </div>
      <div className="init-distant-light" />
      <div className="init-dust">
        {Array.from({ length: 16 }, (_, i) => (
          <i
            key={i}
            style={
              { "--i": i, "--top": `${15 + ((i * 17) % 70)}%` } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="init-vignette" />
    </div>
  );
}

export default function EntryGame({
  complete,
  exit,
  initialAligned = false,
  initialEyeMarked = false,
}: {
  complete: () => void;
  exit: () => void;
  initialAligned?: boolean;
  initialEyeMarked?: boolean;
}) {
  const [stage, setStage] = useState<Stage>("puzzle"),
    [angles, setAngles] = useState(initialAligned ? [0, 0, 0] : INITIAL);
  const [visitorOpen, setVisitorOpen] = useState(false);
  const [eyeMarked, setEyeMarked] = useState(initialEyeMarked);
  const closeVisitor = useCallback(() => setVisitorOpen(false), []);
  const [reduced, setReduced] = useState(false),
    [paused, setPaused] = useState(false),
    [progress, setProgress] = useState(0);
  const [keySpot, setKeySpot] = useState(1),
    [searched, setSearched] = useState<number[]>([]),
    [revealed, setRevealed] = useState(false),
    [hasKey, setHasKey] = useState(false);
  const [message, setMessage] = useState(""),
    [hint, setHint] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState<(() => void) | null>(null);
  const inFlight = useRef(false);
  async function action(name: string, data: unknown = {}) {
    const response = await fetch("/api/entry/" + name, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = (await response.json()) as {
      error?: string;
      found?: boolean;
    };
    if (!response.ok) {
      throw Error(result.error || "Could not save game progress. Retry.");
    }
    return result;
  }
  async function run(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setRetry(null);
    try {
      await work();
    } catch (e) {
      playEntrySound("error");
      setError(e instanceof Error ? e.message : "Connection failed. Retry.");
      setRetry(() => () => void run(work));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const titleRef = useRef<HTMLHeadingElement>(null);
  const aligned = angles.filter((n) => n === 0).length;
  const chapter =
    stage === "puzzle"
      ? 0
      : stage === "gate" || stage === "walk"
        ? 1
        : stage === "chamber"
          ? 2
          : 3;
  useEffect(() => {
    setReduced(matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, [stage]);
  useEffect(() => {
    if (stage !== "puzzle" || aligned !== 3 || visitorOpen) return;
    const timer = setTimeout(
      () => {
        void run(async () => {
          await action("start");
          await action("puzzle", { angles });
          setMessage("");
          setStage("gate");
        });
      },
      reduced ? 250 : 800,
    );
    return () => clearTimeout(timer);
  }, [aligned, stage, reduced, visitorOpen]);
  useEffect(() => {
    if (stage !== "gate" && stage !== "unlock") return;
    const timer = setTimeout(
      () => {
        if (stage === "gate") {
          setProgress(0);
          setStage("walk");
        } else complete();
      },
      reduced ? 600 : stage === "gate" ? 2800 : 2300,
    );
    return () => clearTimeout(timer);
  }, [stage, reduced, complete]);
  useEffect(() => {
    if (stage !== "walk" || paused) return;
    let frame = 0,
      previous = performance.now();
    const move = (time: number) => {
      const delta = Math.min(time - previous, 100);
      previous = time;
      if (!document.hidden)
        setProgress((value) =>
          Math.min(1, value + delta / (reduced ? 1800 : 7600)),
        );
      frame = requestAnimationFrame(move);
    };
    frame = requestAnimationFrame(move);
    return () => cancelAnimationFrame(frame);
  }, [stage, paused, reduced]);
  useEffect(() => {
    if (stage === "walk" && progress >= 1) {
      void run(async () => {
        await action("arrive");
        setStage("chamber");
        setMessage("Roshni aa gayi. Ab kamre mein key talasho.");
      });
    }
  }, [stage, progress]);
  function reset() {
    playEntrySound("click");
    setStage("puzzle");
    setAngles([...INITIAL]);
    setEyeMarked(false);
    setVisitorOpen(false);
    setProgress(0);
    setPaused(false);
    setHasKey(false);
    setRevealed(false);
    setSearched([]);
    setMessage("");
    setHint(false);
    setError("");
    setRetry(null);
  }
  function search(index: number) {
    if (stage !== "chamber" || searched.includes(index) || hasKey) return;
    playEntrySound("search");
    void run(async () => {
      const result = await action("search", { spot: index });
      setSearched((values) => [...values, index]);
      if (result.found) {
        playEntrySound("key");
        setKeySpot(index);
        setRevealed(true);
        setMessage(spots[index].found);
      } else setMessage(spots[index].empty);
    });
  }
  const title =
    stage === "puzzle"
      ? "Align the triangle."
      : stage === "gate"
        ? "The passage awakens."
        : stage === "walk"
          ? "Follow the faint light."
          : stage === "unlock"
            ? "Welcome to the inside."
            : hasKey
              ? "The key is yours."
              : "Every lock has a secret.";
  return (
    <main
      className={`initiation stage-${stage} ${reduced ? "motion-reduced" : ""} ${paused ? "walk-paused" : ""}`}
      aria-label="The inner gate entry game"
    >
      <header className="init-header">
        <button
          className="init-brand"
          onClick={exit}
          aria-label="Back to entrance"
          disabled={busy}
        >
          <Emblem />
          <span>
            SYNDICATE<small>THE INNER GATE</small>
          </span>
        </button>
        <div className="init-header-actions">
          <EntrySoundscape scene={stage} paused={stage === "walk" && paused} />
          <button
            className={reduced ? "selected" : ""}
            onClick={() => setReduced((v) => !v)}
            aria-label="Reduce motion"
            aria-pressed={reduced}
          >
            <Sparkles size={14} />
            <span>Reduce motion</span>
          </button>
          <button
            onClick={reset}
            aria-label="Restart entry game"
            disabled={busy}
          >
            <RotateCcw size={16} />
            <span>Restart</span>
          </button>
        </div>
      </header>
      <div className="init-scene">
        <CyberBackdrop variant="game" reducedMotion={reduced} />
        <Passage
          walking={stage === "walk"}
          chamber={stage === "chamber" || stage === "unlock"}
          progress={progress}
        />
        {(stage === "puzzle" || stage === "gate") && (
          <div className="init-first-gate" aria-hidden="true">
            <div className="init-gate-crown">
              <span>⟡</span>
            </div>
            <div className="init-gate-leaf leaf-left" />
            <div className="init-gate-leaf leaf-right" />
            <div className="init-gate-seam" />
            <div className="init-gate-step" />
          </div>
        )}
        {stage === "puzzle" && (
          <div className="init-puzzle-layout">
            <div className="init-puzzle-board">
              <div className="init-board-aura" />
              <TrianglePuzzle
                angles={angles}
                camera={() => setVisitorOpen(true)}
                cameraLocked={busy}
                eyeMarked={eyeMarked}
                rotate={(index) => {
                  if (aligned !== 3) {
                    playEntrySound(
                      (angles[index] + 1) % 3 === 0 ? "aligned" : "rotate",
                    );
                    setAngles((values) =>
                      values.map((value, i) =>
                        i === index ? (value + 1) % 3 : value,
                      ),
                    );
                  }
                }}
              />
              <span className="init-board-caption">I · THE TRIANGLE SEAL</span>
            </div>
            <section className="init-puzzle-copy">
              <span className="init-overline">THE FIRST TRIAL / 01</span>
              <h1 tabIndex={-1} ref={titleRef}>
                {title}
              </h1>
              <p>
                Teen tukde. Ek nishaan.
                <br />
                Fragments ko tap karke ghumao aur sunehri lakeerein centre ke
                eye ki taraf milao.
              </p>
              <div className="init-alignment" role="status">
                <span>
                  {String(aligned).padStart(2, "0")}
                  <small> / 03</small>
                </span>
                <div>
                  <strong>
                    {aligned === 3 ? "Seal complete" : "Fragments aligned"}
                  </strong>
                  <p>
                    {aligned === 3
                      ? "The gate is opening…"
                      : "Har sahi piece sunehra ho jayega."}
                  </p>
                </div>
              </div>
              <button
                className="init-hint"
                onClick={() => {
                  playEntrySound("click");
                  setHint((v) => !v);
                }}
                aria-expanded={hint}
              >
                Need a clue? <ChevronRight size={15} />
              </button>
              {hint && (
                <p className="init-hint-copy">
                  Har fragment ka arrow centre ke eye ki taraf hona chahiye:
                  upar wala neeche, left wala upar-right, aur right wala
                  upar-left.
                </p>
              )}
              <span className="init-control-note">
                TAP TO ROTATE · KEYBOARD: TAB + ENTER
              </span>
            </section>
          </div>
        )}
        {stage === "gate" && (
          <div className="init-stage-caption">
            <span className="init-overline">THE SEAL IS BROKEN</span>
            <h1 tabIndex={-1} ref={titleRef}>
              {title}
            </h1>
            <p>Aage ka raasta khul raha hai.</p>
          </div>
        )}
        {stage === "walk" && (
          <>
            <div className="init-crosshair" aria-hidden="true" />
            <section className="init-walk-copy">
              <span className="init-overline">THE PASSAGE / 02</span>
              <h1 tabIndex={-1} ref={titleRef}>
                {title}
              </h1>
              <p>Andhere ke paar ek roshni tumhara intezaar kar rahi hai.</p>
              <div className="init-distance">
                <span>ENTRANCE</span>
                <div
                  role="progressbar"
                  aria-label="Passage progress"
                  aria-valuenow={Math.round(progress * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <i style={{ width: `${progress * 100}%` }} />
                </div>
                <span>{Math.ceil((1 - progress) * 24)} m</span>
              </div>
              <button
                className="init-walk-pause"
                onClick={() => setPaused((v) => !v)}
              >
                {paused ? <Play size={14} /> : <Pause size={14} />}
                {paused ? "Continue walking" : "Pause walk"}
              </button>
            </section>
          </>
        )}
        {(stage === "chamber" || stage === "unlock") && (
          <>
            <div className="init-chamber-roof" />
            <div className="init-chamber-beam" aria-hidden="true" />
            <div className="init-vault">
              <div className="init-vault-frame">
                <div className="init-vault-leaf">
                  <Emblem />
                  <div className="init-vault-lines" />
                  <span>THE INNER CIRCLE</span>
                </div>
                <div className="init-vault-light" />
              </div>
              <button
                className={`init-lock ${stage === "unlock" ? "unlocked" : ""}`}
                disabled={busy || stage === "unlock"}
                aria-label={
                  hasKey
                    ? "Unlock the gate with the key"
                    : "Inspect the locked gate"
                }
                onClick={() => {
                  if (!hasKey) {
                    playEntrySound("locked");
                    setMessage(
                      "Gate locked hai. Pehle kamre mein chhupi key dhoondho.",
                    );
                  } else {
                    void run(async () => {
                      await action("unlock");
                      setMessage("Lock khul gaya. Login page khul raha hai…");
                      setStage("unlock");
                    });
                  }
                }}
              >
                <LockKeyhole size={36} />
                <span>
                  {stage === "unlock"
                    ? "UNLOCKED"
                    : hasKey
                      ? "USE KEY"
                      : "LOCKED"}
                </span>
              </button>
            </div>
            {stage === "chamber" &&
              spots.map((spot, index) => (
                <div
                  key={spot.name}
                  className={`init-search-spot spot-${index} ${searched.includes(index) ? "searched" : ""}`}
                >
                  <button
                    className="init-search-object"
                    aria-label={`Search ${spot.name}`}
                    disabled={busy || searched.includes(index) || hasKey}
                    onClick={() => search(index)}
                  >
                    <span className="init-prop" aria-hidden="true">
                      {index === 0 ? (
                        <i className="init-lantern-flame" />
                      ) : (
                        <i />
                      )}
                    </span>
                    <span className="init-search-label">
                      {searched.includes(index) ? (
                        <Check size={13} />
                      ) : (
                        <MoveUpRight size={13} />
                      )}
                      {spot.name}
                    </span>
                  </button>
                  {revealed && index === keySpot && !hasKey && (
                    <button
                      className="init-found-key"
                      aria-label="Pick up the hidden key"
                      disabled={busy}
                      onClick={() => {
                        void run(async () => {
                          await action("pickup");
                          playEntrySound("key");
                          setHasKey(true);
                          setMessage(
                            "Key mil gayi! Ab saamne wale lock par tap karo.",
                          );
                        });
                      }}
                    >
                      <KeyRound size={34} />
                      <span>Take the key</span>
                    </button>
                  )}
                </div>
              ))}
            <section className="init-chamber-copy">
              <span className="init-overline">
                {stage === "unlock"
                  ? "ACCESS UNLOCKED / 04"
                  : "THE KEY CHAMBER / 03"}
              </span>
              <h1 tabIndex={-1} ref={titleRef}>
                {title}
              </h1>
              <p>
                {stage === "unlock"
                  ? "Your next chapter begins here."
                  : hasKey
                    ? "Saamne ke lock par tap karke gate kholo."
                    : "Kamre ki teen jagahon ko tap karke talasho. Key milne par use uthao aur gate ka lock kholo."}
              </p>
            </section>
          </>
        )}
        <div className="init-scene-corners" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
      <footer className="init-footer">
        <ol aria-label="Entry game chapters">
          {["Triangle", "Passage", "Find the key", "Unlock"].map(
            (label, index) => (
              <li
                key={label}
                className={
                  chapter === index
                    ? "current"
                    : chapter > index
                      ? "finished"
                      : ""
                }
                aria-current={chapter === index ? "step" : undefined}
              >
                <span>
                  {chapter > index ? <Check size={12} /> : `0${index + 1}`}
                </span>
                <strong>{label}</strong>
                {index < 3 && <ChevronRight size={12} />}
              </li>
            ),
          )}
        </ol>
        <div className={`init-inventory ${hasKey ? "has-key" : ""}`}>
          <KeyRound size={18} />
          <span>{hasKey ? "Gate key collected" : "Inventory empty"}</span>
        </div>
      </footer>
      <div className="init-message" role="status" aria-live="polite">
        {message && (
          <>
            <span className="init-message-dot" />
            {message}
          </>
        )}
      </div>
      {error && (
        <div className="init-connection-error" role="alert">
          <p>{error}</p>
          {retry && (
            <button disabled={busy} onClick={retry}>
              Retry step
            </button>
          )}
          <button disabled={busy} onClick={reset}>
            Restart game
          </button>
        </div>
      )}
      {stage === "unlock" && (
        <div className="init-final-glow" aria-hidden="true" />
      )}
      {visitorOpen && (
        <VisitorCheckIn close={closeVisitor} onStatus={setEyeMarked} />
      )}
    </main>
  );
}
