import type { ReactNode } from "react";
import { LockKeyhole } from "lucide-react";
import {
  OD_MARKETS,
  OD_RANKS,
  type ODQuote,
} from "@workspace/api-zod/dragon-tiger-one-day";

type MarketProps = {
  quotes: ODQuote[];
  canEdit: boolean;
  amount: (id: string) => number;
  selected: (id: string) => boolean;
  onSelect: (id: string) => void;
};

const price = (quote?: ODQuote) =>
  quote?.oddsHundredths ? `${(quote.oddsHundredths / 100).toFixed(2)}×` : "—";
const stake = (amount: number) =>
  (amount / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });

function MarketButton({
  id,
  variant = "option",
  label,
  ...props
}: MarketProps & {
  id: string;
  variant?: "match" | "option" | "rank";
  label?: ReactNode;
}) {
  const market = OD_MARKETS.find((market) => market.id === id)!;
  const quote = props.quotes.find((quote) => quote.id === id);
  const locked = !props.canEdit || !quote?.available;
  const amount = props.amount(id);
  const name = `${market.side === "match" ? "" : `${market.side} `}${market.label}`;

  return (
    <button
      type="button"
      className={`od-market od-${variant}-bet od-market-${id}${props.selected(id) ? " od-selected" : ""}`}
      data-testid={`od-market-${id}`}
      disabled={locked}
      aria-label={`${name}, ${quote?.oddsHundredths ? `${price(quote)} total return` : "unavailable"}${amount ? `, ₹${stake(amount)} staked` : ""}`}
      aria-pressed={props.selected(id)}
      onClick={() => props.onSelect(id)}
    >
      <span className="od-bet-price">{price(quote)}</span>
      <span className="od-bet-face">
        <span className="od-bet-label">{label ?? market.label}</span>
        {variant === "match" && (
          <small className="od-bet-stake">{stake(amount)}</small>
        )}
        {variant !== "match" && amount > 0 && (
          <small className="od-stake-chip">₹{stake(amount)}</small>
        )}
        {locked && (
          <span className="od-market-lock" aria-hidden="true">
            <LockKeyhole size={21} strokeWidth={3} />
          </span>
        )}
      </span>
    </button>
  );
}

export function OneDayMatchMarkets(props: MarketProps) {
  return (
    <div className="od-match-grid" aria-label="Match winner markets">
      <MarketButton {...props} id="dragon" variant="match" />
      <MarketButton {...props} id="tiger" variant="match" />
      <MarketButton {...props} id="tie" variant="match" />
      <MarketButton
        {...props}
        id="suited-tie"
        variant="match"
        label="Pair · Suited tie"
      />
    </div>
  );
}

export function OneDayCardMarkets({
  side,
  ...props
}: MarketProps & { side: "dragon" | "tiger" }) {
  const sideName = side === "dragon" ? "Dragon" : "Tiger";
  const extras = props.quotes.filter(
    (quote) =>
      quote.side === side &&
      ["Suit", "Card type", "Size"].includes(quote.group),
  );
  return (
    <section
      className={`od-card-markets od-card-markets-${side}`}
      aria-labelledby={`od-${side}-heading`}
    >
      <h2 id={`od-${side}-heading`}>{sideName}</h2>
      <div className="od-colour-grid">
        <MarketButton {...props} id={`${side}-even`} />
        <MarketButton {...props} id={`${side}-odd`} />
        <MarketButton
          {...props}
          id={`${side}-black`}
          label={<span className="od-black-suits">♠︎ ♣︎</span>}
        />
        <MarketButton
          {...props}
          id={`${side}-red`}
          label={<span className="od-red-suits">♥︎ ♦︎</span>}
        />
      </div>
      <div
        className="od-rank-board"
        role="group"
        aria-label={`${sideName} exact card`}
      >
        <span className="od-rank-caption">
          Exact card <span>· A low</span>
        </span>
        <div className="od-rank-grid">
          {OD_RANKS.map((rank, i) => (
            <MarketButton
              {...props}
              key={rank}
              id={`${side}-rank-${i + 1}`}
              variant="rank"
              label={
                <span className="od-rank-card" aria-hidden="true">
                  <b>{rank}</b>
                  <span className="od-rank-suits">
                    <span>♠︎</span>
                    <span>♦︎</span>
                    <span>♣︎</span>
                    <span>♥︎</span>
                  </span>
                </span>
              }
            />
          ))}
        </div>
      </div>
      {extras.length > 0 && (
        <details className="od-extra-markets">
          <summary>
            More {sideName} bets <span>Suit · Size · Card type</span>
          </summary>
          <div className="od-extra-grid">
            {extras.map((quote) => (
              <MarketButton {...props} key={quote.id} id={quote.id} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
