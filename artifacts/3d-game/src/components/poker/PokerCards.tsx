const ranks = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];
const suits = ["♠", "♥", "♦", "♣"];

export function Cards({ values }: { values: (number | null)[] }) {
  return (
    <div className="pk-cards">
      {values.map((value, index) => {
        const suit = value === null ? 0 : Math.floor(value / 13);
        return (
          <span
            key={`${index}:${value}`}
            className={`pk-card ${value === null ? "pk-card-back" : "pk-card-face"} ${suit === 1 || suit === 2 ? "pk-card-red" : ""}`}
            style={{ animationDelay: `${index * 70}ms` }}
            aria-label={
              value === null
                ? "Face down card"
                : `${ranks[value % 13]}${suits[suit]}`
            }
          >
            {value !== null && (
              <>
                <b>{ranks[value % 13]}</b>
                <i>{suits[suit]}</i>
              </>
            )}
          </span>
        );
      })}
    </div>
  );
}
