/** Shared original artwork for the lobby and matchmaking screen. */
export function LudoEmblem({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={"ld-emblem" + (compact ? " ld-emblem-compact" : "")}
      aria-label="Ludo Live"
    >
      <div className="ld-emblem-word" aria-hidden="true">
        {"LUDO".split("").map((letter, i) => (
          <span
            key={letter}
            style={{ color: ["#4cc8ff", "#ff6374", "#62e88b", "#ffe16a"][i] }}
          >
            {letter}
          </span>
        ))}
        <b>LIVE</b>
      </div>
      <p className="ld-emblem-tagline">FOUR COLOURS. ONE CROWN.</p>
      <div className="ld-emblem-scene">
        <img
          className="ld-emblem-art"
          src={`${import.meta.env.BASE_URL}media/ludo/royal-board.png`}
          alt=""
          width="1536"
          height="1024"
          fetchPriority={compact ? "auto" : "high"}
          draggable={false}
        />
        <span className="ld-art-lustre" aria-hidden="true" />
        <span className="ld-art-stars" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}
