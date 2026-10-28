import { useId } from "react";

export type LudoArtKind =
  | "online"
  | "team"
  | "friends"
  | "computer"
  | "pass"
  | "crown"
  | "gift"
  | "wheel"
  | "calendar"
  | "inventory"
  | "chat"
  | "adda"
  | "target"
  | "dice"
  | "home"
  | "mail"
  | "profile"
  | "settings"
  | "help"
  | "coins"
  | "results"
  | "themes"
  | "shop"
  | "season"
  | "snakes";

/** Generated illustrations share the same scalable, accessible decoration wrapper. */
export function LudoArtwork({
  kind,
  className = "",
}: {
  kind: LudoArtKind;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const generated: Partial<Record<LudoArtKind, string>> = {
    online: "mode-online",
    team: "mode-team",
    friends: "mode-friends",
    computer: "mode-computer",
    pass: "mode-pass",
    crown: "ludo-hero-crown",
    gift: "gift",
    wheel: "wheel",
    calendar: "calendar",
    inventory: "inventory",
    chat: "chat",
    adda: "adda",
    target: "target",
    dice: "dice-theme",
    home: "home",
    mail: "mail",
    settings: "settings",
    help: "help",
    coins: "coins",
    snakes: "snakes-entry",
    results: "results",
    themes: "themes",
    shop: "shop",
    season: "season",
  };
  const asset = generated[kind];
  if (asset)
    return (
      <svg
        viewBox="0 0 120 100"
        className={`ld-crafted-art ld-art-${kind} ${className}`}
        aria-hidden="true"
        data-generated-art={asset}
      >
        <g
          className={
            kind === "friends"
              ? "ld-generated-icon ld-art-heart"
              : "ld-generated-icon"
          }
        >
          <image
            href={`/media/ludo/generated-v1/${asset}.webp`}
            width="120"
            height="100"
            preserveAspectRatio="xMidYMid meet"
          />
          {kind === "computer" && (
            <text
              x="60"
              y="58"
              textAnchor="middle"
              fill="#fff0ac"
              stroke="#543209"
              strokeWidth=".5"
              fontFamily="Arial,sans-serif"
              fontWeight="900"
              fontSize="22"
            >
              VS
            </text>
          )}
        </g>
      </svg>
    );
  const gold = `url(#${id}gold)`,
    blue = `url(#${id}blue)`;
  const phone = (x: number, y: number, angle: number) => (
    <g transform={`translate(${x} ${y}) rotate(${angle} 15 24)`}>
      <rect
        width="30"
        height="48"
        rx="5"
        fill={gold}
        stroke="#6c3807"
        strokeWidth="2"
      />
      <rect
        x="4"
        y="7"
        width="22"
        height="30"
        rx="2"
        fill="#174b93"
        stroke="#fff7b7"
      />
      <circle cx="15" cy="42" r="2" fill="#704215" />
    </g>
  );
  const pawn = (x: number, y: number, color: string) => (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cy="32" rx="13" ry="5" fill="#081938" opacity=".35" />
      <path
        d="M-5 5Q-5 19-13 29Q0 38 13 29Q5 19 5 5Z"
        fill={color}
        stroke="#073c66"
        strokeWidth="1.5"
      />
      <circle r="9" fill={color} stroke="#073c66" strokeWidth="1.5" />
      <path
        d="M-4-4Q-7-3-6 2"
        fill="none"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        opacity=".8"
      />
    </g>
  );
  return (
    <svg
      viewBox="0 0 120 100"
      className={`ld-crafted-art ld-art-${kind} ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id + "gold"} x2=".3" y2="1">
          <stop stopColor="#fffbd2" />
          <stop offset=".3" stopColor="#ffe86d" />
          <stop offset=".65" stopColor="#ffbd21" />
          <stop offset="1" stopColor="#b6660d" />
        </linearGradient>
        <radialGradient id={id + "blue"} cx=".3" cy=".2">
          <stop stopColor="#5dd5ff" />
          <stop offset=".55" stopColor="#127bd9" />
          <stop offset="1" stopColor="#073e86" />
        </radialGradient>
      </defs>
      {kind === "online" && (
        <>
          <ellipse
            cx="60"
            cy="77"
            rx="47"
            ry="9"
            fill="none"
            stroke="#ffd651"
            strokeWidth="3"
            strokeDasharray="1 7"
            strokeLinecap="round"
          />
          <g className="ld-art-orbit">
            <circle
              cx="60"
              cy="42"
              r="32"
              fill={blue}
              stroke="#062960"
              strokeWidth="2"
            />
            <path
              d="M43 15L60 12 66 20 58 26 62 36 50 40 47 31 34 28ZM78 28L88 36 89 50 78 56 74 72 64 66 61 52 68 43 66 35Z"
              fill="#6ecf27"
              stroke="#1d791f"
              strokeWidth="1.5"
            />
            <path
              d="M45 19Q32 25 33 41"
              fill="none"
              stroke="#c0f4ff"
              strokeWidth="3"
              opacity=".65"
            />
          </g>
          {phone(7, 44, -15)}
          {phone(84, 44, 15)}
        </>
      )}
      {kind === "computer" && (
        <>
          <g className="ld-art-bob">
            {phone(39, 20, 0)}
            <text
              x="54"
              y="47"
              textAnchor="middle"
              fontSize="15"
              fontWeight="900"
              fill="#ffe88c"
            >
              VS
            </text>
          </g>
          <ellipse cx="58" cy="82" rx="31" ry="5" fill="#052a55" opacity=".5" />
        </>
      )}
      {kind === "team" && (
        <>
          <g className="ld-art-swords" transform="translate(0 -2)">
            <path
              d="M58 5L67 16 64 67 55 67 54 17Z"
              fill="#e8f6ff"
              stroke="#2c5c88"
              strokeWidth="2"
            />
            <path d="M60 14v51" stroke="#8cbbcc" strokeWidth="2" />
            <path
              d="M44 68H76M60 70V89"
              stroke="#efc44d"
              strokeWidth="7"
              strokeLinecap="round"
            />
            <path
              d="M48 16Q80 24 65 40T51 61"
              fill="none"
              stroke="#ecd468"
              strokeWidth="3"
            />
          </g>
          <g fill="none" stroke="#c4f1f4" strokeWidth="3">
            <path d="M11 45V36a14 14 0 0 1 28 0v11" />
            <path d="M83 47V37a13 13 0 0 1 26 0v12" />
          </g>
          {[
            [23, 45, "#4ac8ed"],
            [38, 59, "#83dbf0"],
            [94, 45, "#ec5144"],
            [80, 59, "#ff9a7d"],
          ].map(([x, y, c]) => (
            <g key={String(x)} transform={`translate(${x} ${y})`}>
              <path
                d="M-9 0a9 9 0 0 1 18 0q0 9-9 18Q-9 9-9 0Z"
                fill={String(c)}
                stroke="#fff0be"
                strokeWidth="2"
              />
              <circle r="4" fill="#27658a" />
            </g>
          ))}
        </>
      )}
      {kind === "friends" && (
        <>
          {phone(9, 41, -12)}
          {phone(82, 41, 12)}
          <path
            className="ld-art-heart"
            d="M60 69C17 45 28 6 51 20L60 29 69 20C92 6 103 45 60 69Z"
            fill="#fb5056"
            stroke="#9c1f38"
            strokeWidth="2"
          />
          <path
            d="M38 29Q41 20 49 26"
            stroke="#ffd7c4"
            strokeWidth="4"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M96 8v21m-6-8v5a6 6 0 0 0 12 0v-5m-6 12v6m-4 0h8"
            fill="none"
            stroke="#7eea48"
            strokeWidth="3"
          />
        </>
      )}
      {kind === "pass" && (
        <>
          <g className="ld-art-left">
            <circle cx="24" cy="25" r="10" fill={gold} />
            <path
              d="M22 38Q8 45 12 68H35L47 56 42 50 30 57 34 40Z"
              fill={gold}
              stroke="#8a510c"
              strokeWidth="1.5"
            />
          </g>
          <g className="ld-art-right">
            <circle cx="96" cy="25" r="10" fill={gold} />
            <path
              d="M98 38Q112 45 108 68H85L73 56 78 50 90 57 86 40Z"
              fill={gold}
              stroke="#8a510c"
              strokeWidth="1.5"
            />
          </g>
          <path
            d="M48 61L60 52 75 61 61 72Z"
            fill={gold}
            stroke="#9a610d"
            strokeWidth="2"
          />
        </>
      )}
      {kind === "crown" && (
        <g className="ld-art-bob">
          <path
            d="M19 29L39 43 60 14 81 43 101 29 91 74H29Z"
            fill={gold}
            stroke="#88550d"
            strokeWidth="3"
          />
          <path
            d="M30 76H91V87H30Z"
            fill={gold}
            stroke="#88550d"
            strokeWidth="2"
          />
          {[
            [18, 26],
            [60, 12],
            [102, 26],
          ].map(([x, y]) => (
            <circle
              key={x}
              cx={x}
              cy={y}
              r="6"
              fill="#fff3a3"
              stroke="#bd751a"
              strokeWidth="2"
            />
          ))}
          <path
            d="M60 45L69 57 60 68 51 57Z"
            fill="#e6404e"
            stroke="#fff7ac"
            strokeWidth="2"
          />
        </g>
      )}
      {kind === "gift" && (
        <>
          <path
            d="M24 47H96V88H24Z"
            fill="#da4e39"
            stroke="#682a1c"
            strokeWidth="3"
          />
          <path
            className="ld-art-lid"
            d="M18 34H102V52H18Z"
            fill={gold}
            stroke="#9f5c12"
            strokeWidth="2"
          />
          <path d="M53 35H67V88H53Z" fill={gold} />
          <g
            className="ld-art-bow"
            fill="none"
            stroke="#ffeb84"
            strokeWidth="7"
          >
            <path d="M58 34C14 32 33-8 58 34ZM63 34C106 32 86-8 63 34Z" />
          </g>
          <path d="M30 60V80" stroke="#ff8973" strokeWidth="3" />
        </>
      )}
      {kind === "wheel" && (
        <>
          <path d="M40 88L48 69H72L80 88Z" fill={gold} />
          <g className="ld-art-wheel" transform="translate(60 44)">
            <circle r="35" fill="#ffe06c" stroke="#925b13" strokeWidth="3" />
            {Array.from({ length: 8 }, (_, i) => (
              <path
                key={i}
                d="M0 0L0-31A31 31 0 0 1 21.92-21.92Z"
                transform={`rotate(${i * 45})`}
                fill={i % 2 ? "#2096d5" : "#ffe59c"}
                stroke="#b5811a"
              />
            ))}
            <circle r="11" fill={gold} />
            <text
              y="3"
              textAnchor="middle"
              fontSize="7"
              fontWeight="900"
              fill="#754112"
            >
              SPIN
            </text>
          </g>
          <path
            d="M52 5H68L60 19Z"
            fill="#e94743"
            stroke="#fff7b5"
            strokeWidth="2"
          />
          <path
            d="M31 89H89"
            stroke="#fff2a4"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === "calendar" && (
        <>
          <rect
            x="24"
            y="21"
            width="72"
            height="66"
            rx="9"
            fill="#effaff"
            stroke="#e4b339"
            strokeWidth="4"
          />
          <path d="M26 38H94V26Q94 23 90 23H30Q26 23 26 27Z" fill="#df414e" />
          <path
            d="M40 14v17M80 14v17"
            stroke="#ffe791"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <path
            className="ld-art-check"
            d="M43 61L54 72 78 47"
            stroke="#2bbb75"
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {kind === "inventory" && (
        <>
          <path
            d="M28 35H92L100 86H20Z"
            fill={gold}
            stroke="#965613"
            strokeWidth="3"
          />
          <path
            d="M43 38V25a17 17 0 0 1 34 0V38"
            fill="none"
            stroke="#ffef9f"
            strokeWidth="7"
          />
          {pawn(60, 54, "#3cc2f2")}
        </>
      )}
      {(kind === "chat" || kind === "mail") && (
        <>
          {kind === "chat" ? (
            <>
              <path
                d="M18 23Q18 12 30 12H90Q103 12 103 25V57Q103 69 90 69H53L31 87V69Q18 69 18 57Z"
                fill="#e8f7ff"
                stroke="#66a2d2"
                strokeWidth="3"
              />
              {[40, 60, 80].map((x, i) => (
                <circle
                  key={x}
                  className={`ld-art-dot ld-art-dot-${i}`}
                  cx={x}
                  cy="42"
                  r="6"
                  fill="#2489cb"
                />
              ))}
            </>
          ) : (
            <>
              <rect
                x="15"
                y="25"
                width="90"
                height="57"
                rx="6"
                fill={gold}
                stroke="#8a520f"
                strokeWidth="3"
              />
              <path
                d="M17 28L60 60 103 28M17 80L45 52M103 80L75 52"
                fill="none"
                stroke="#ae7420"
                strokeWidth="3"
              />
            </>
          )}
        </>
      )}
      {kind === "target" && (
        <>
          <circle
            cx="56"
            cy="53"
            r="33"
            fill="#ef5357"
            stroke="#a82a35"
            strokeWidth="3"
          />
          <circle cx="56" cy="53" r="23" fill="#fff7e7" />
          <circle cx="56" cy="53" r="13" fill="#ef5357" />
          <path
            className="ld-art-arrow"
            d="M57 52L97 12M88 13L98 11 96 22M78 21L85 23 88 30"
            stroke="#ffd457"
            strokeWidth="5"
            fill="none"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === "dice" && (
        <g className="ld-art-dice" transform="rotate(-12 60 50)">
          <rect
            x="27"
            y="15"
            width="66"
            height="66"
            rx="13"
            fill={gold}
            stroke="#98580e"
            strokeWidth="3"
          />
          {[
            [43, 32],
            [77, 32],
            [60, 49],
            [43, 66],
            [77, 66],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="5" fill="#70431c" />
          ))}
          <path
            d="M34 25H77"
            stroke="#fffbd4"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
      )}
      {kind === "home" && (
        <>
          <path
            d="M15 46L60 11 105 46"
            fill={gold}
            stroke="#8c5510"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <path
            d="M26 44H94V87H26Z"
            fill="#ffeb9a"
            stroke="#a5701a"
            strokeWidth="3"
          />
          {[
            [39, 52, "#ee5146"],
            [63, 52, "#55b875"],
            [39, 70, "#36b2e4"],
            [63, 70, "#e9bd24"],
          ].map(([x, y, c]) => (
            <rect
              key={`${x}${y}`}
              x={x}
              y={y}
              width="15"
              height="13"
              rx="3"
              fill={String(c)}
            />
          ))}
        </>
      )}
      {kind === "profile" && (
        <>
          <rect
            x="16"
            y="8"
            width="88"
            height="84"
            rx="20"
            fill={blue}
            stroke="#ffd96b"
            strokeWidth="3"
          />
          <path d="M26 90V77Q28 58 60 58Q92 58 94 77V90" fill="#944cb5" />
          <ellipse cx="60" cy="42" rx="22" ry="27" fill="#efbd8c" />
          <path
            d="M37 41Q30 9 59 14Q89 10 84 40L73 26Q55 37 40 29Z"
            fill="#543020"
          />
          <path
            d="M49 43h1m20 0h1"
            stroke="#382515"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path
            d="M52 56Q60 62 68 56"
            fill="none"
            stroke="#a65242"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === "settings" && (
        <>
          <g fill={gold} stroke="#956d22" strokeWidth="2">
            {Array.from({ length: 8 }, (_, i) => (
              <rect
                key={i}
                x="51"
                y="10"
                width="18"
                height="27"
                rx="4"
                transform={`rotate(${i * 45} 60 50)`}
              />
            ))}
            <circle cx="60" cy="50" r="29" />
            <circle cx="60" cy="50" r="13" fill="#195596" />
          </g>
        </>
      )}
      {kind === "help" && (
        <>
          <rect
            x="25"
            y="16"
            width="70"
            height="70"
            rx="16"
            fill={blue}
            stroke="#ffdf61"
            strokeWidth="4"
          />
          <text
            x="60"
            y="70"
            textAnchor="middle"
            fill="#ffed90"
            stroke="#805b16"
            strokeWidth="1"
            fontSize="65"
            fontWeight="900"
          >
            ?
          </text>
        </>
      )}
      {kind === "adda" && (
        <g>
          <rect
            x="47"
            y="11"
            width="28"
            height="51"
            rx="14"
            fill={gold}
            stroke="#95620d"
            strokeWidth="2"
          />
          {[22, 31, 40, 49].map((y) => (
            <path
              key={y}
              d={`M48 ${y}h9m9 0h9`}
              stroke="#705019"
              strokeWidth="2"
            />
          ))}
          <path
            d="M38 43v8a23 23 0 0 0 46 0v-8M61 74v14M44 90h34"
            fill="none"
            stroke="#ffec9c"
            strokeWidth="5"
          />
          <path
            d="M37 84h-18l-7 6V70h25Z"
            fill="#54b9f8"
            stroke="white"
            strokeWidth="2"
          />
        </g>
      )}
      {kind === "coins" && (
        <>
          {[
            [31, 63],
            [59, 75],
            [86, 62],
            [56, 43],
          ].map(([x, y]) => (
            <g key={x}>
              <path
                d={`M${x - 17} ${y}v9a17 7 0 0 0 34 0v-9`}
                fill={gold}
                stroke="#a26412"
              />
              <ellipse
                cx={x}
                cy={y}
                rx="17"
                ry="7"
                fill={gold}
                stroke="#fff2a0"
                strokeWidth="2"
              />
            </g>
          ))}
        </>
      )}
      {kind === "snakes" && (
        <>
          <rect
            x="23"
            y="17"
            width="74"
            height="70"
            rx="10"
            fill="#f4dfa1"
            stroke="#bd801b"
            strokeWidth="3"
          />
          {Array.from({ length: 16 }, (_, i) => (
            <rect
              key={i}
              x={27 + (i % 4) * 16}
              y={21 + Math.floor(i / 4) * 15}
              width="16"
              height="15"
              fill={i % 2 ? "#f8edbe" : "#3aabb7"}
            />
          ))}
          <path
            d="M35 66L70 30m-28 44L77 38M41 60l7 7M50 51l7 7M59 42l7 7"
            fill="none"
            stroke="#996328"
            strokeWidth="3"
          />
          <path
            className="ld-art-snake"
            d="M80 68Q54 70 69 55T52 25"
            fill="none"
            stroke="#3ba143"
            strokeWidth="8"
            strokeLinecap="round"
          />
          <circle cx="51" cy="23" r="7" fill="#55b544" />
          <circle cx="49" cy="21" r="1.7" fill="#142d16" />
        </>
      )}
    </svg>
  );
}

export function LudoCraftedHero() {
  return (
    <div className="ld-crafted-hero" aria-label="Ludo King">
      <div className="ld-hero-crown">
        <LudoArtwork kind="crown" />
      </div>
      <div className="ld-hero-title" aria-hidden="true">
        {"LUDO".split("").map((c, i) => (
          <span
            key={c}
            style={
              {
                "--letter-color": ["#3dbdff", "#ff5b4a", "#79bd38", "#ffcf33"][
                  i
                ],
              } as React.CSSProperties
            }
          >
            {c}
          </span>
        ))}
        <b>KING</b>
      </div>
      <svg className="ld-hero-board" viewBox="0 0 280 110" aria-hidden="true">
        <defs>
          <linearGradient id="ld-hero-board-shine" x2="0" y2="1">
            <stop stopColor="#fffef2" />
            <stop offset="1" stopColor="#c7e0ee" />
          </linearGradient>
        </defs>
        <path
          d="M54 8H226L273 95H7Z"
          fill="url(#ld-hero-board-shine)"
          stroke="#073d78"
          strokeWidth="5"
        />
        {[
          [51, 15, "#ff4b43"],
          [161, 15, "#61b72c"],
          [26, 56, "#2ab8ed"],
          [177, 56, "#f6c42b"],
        ].map(([x, y, c]) => (
          <g key={String(c)} transform={`translate(${x} ${y}) skewX(-5)`}>
            <rect width="70" height="29" rx="3" fill={String(c)} />
            <rect x="13" y="6" width="44" height="17" rx="3" fill="#fffbe7" />
            {[20, 47].map((cx) => (
              <circle key={cx} cx={cx} cy="14" r="5" fill={String(c)} />
            ))}
          </g>
        ))}
        <path
          d="M126 11L104 90M153 11L176 90M30 45H250M22 56H258"
          stroke="#3b6b8f"
          strokeWidth="2"
        />
      </svg>
      <div className="ld-hero-pawn ld-hero-pawn-blue">
        <i />
        <b />
      </div>
      <div className="ld-hero-pawn ld-hero-pawn-yellow">
        <i />
        <b />
      </div>
      <div className="ld-hero-die">
        <LudoArtwork kind="dice" />
      </div>
      <span className="ld-hero-spark ld-hero-spark-one">✦</span>
      <span className="ld-hero-spark ld-hero-spark-two">✧</span>
    </div>
  );
}
