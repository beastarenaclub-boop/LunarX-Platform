const bankerRows = [
  ["0–2", "Always draws", "—"],
  ["3", "0, 1, 2, 3, 4, 5, 6, 7, 9", "8"],
  ["4", "2, 3, 4, 5, 6, 7", "0, 1, 8, 9"],
  ["5", "4, 5, 6, 7", "0, 1, 2, 3, 8, 9"],
  ["6", "6, 7", "0, 1, 2, 3, 4, 5, 8, 9"],
  ["7", "Stands", "All"],
  ["8–9", "Natural: neither hand draws", "All"],
];
const cell = "border border-white/20 px-2 py-2 text-center font-normal";

export default function BaccaratRules() {
  return (
    <section className="space-y-3 text-xs leading-relaxed text-white/80" data-testid="baccarat-drawing-rules" aria-label="Baccarat card drawing rules">
      <h3 className="font-bold text-amber-300">Card values and drawing rules</h3>
      <p>Ace counts as 1; 2–9 count at face value; 10, Jack, Queen and King count as 0. Only the last digit of the total counts. The hand closest to 9 wins. A natural 8 or 9 in either initial hand stops all draws.</p>
      <table className="w-full table-fixed border-collapse bg-black/20">
        <caption className="pb-2 text-left font-bold text-amber-300">Rules for Player</caption>
        <thead><tr><th className={cell}>First two cards total</th><th className={cell}>Action</th></tr></thead>
        <tbody>
          <tr><td className={cell}>0–5</td><td className={cell}>Draw a third card</td></tr>
          <tr><td className={cell}>6–7</td><td className={cell}>Stand</td></tr>
          <tr><td className={cell}>8–9</td><td className={cell}>Natural: neither hand draws</td></tr>
        </tbody>
      </table>
      <h3 className="font-bold text-amber-300">Rules for Banker</h3>
      <p>If Player stands on 6 or 7, Banker draws on 0–5 and stands on 6–7. Otherwise, when Player draws a third card, use this table. Natural 8–9 always stops the deal.</p>
      <table className="w-full table-fixed border-collapse bg-black/20">
        <thead><tr>
          <th className={cell}>Banker's first two cards total</th>
          <th className={cell}>Draws when Player's third card is</th>
          <th className={cell}>Stands when Player's third card is</th>
        </tr></thead>
        <tbody>{bankerRows.map(([total, draws, stands]) => (
          <tr key={total}><td className={cell}>{total}</td><td className={cell}>{draws}</td><td className={cell}>{stands}</td></tr>
        ))}</tbody>
      </table>
      <p>Pairs use only the first two cards of the selected hand, matched by rank. Winning-score bets use the winning hand's final total, not the difference between the hands. All score bets lose on a tie; Player and Banker main bets return their stakes.</p>
      <p className="rounded border border-amber-300/30 bg-amber-300/5 p-3" data-testid="banker-six-example">Banker winning with 6 pays half profit: ₹100 returns ₹150 (₹50 profit + ₹100 stake). Other Banker wins and all Player wins pay 1:1: ₹100 returns ₹200. This exception does not reduce pair or winning-score payouts.</p>
    </section>
  );
}
