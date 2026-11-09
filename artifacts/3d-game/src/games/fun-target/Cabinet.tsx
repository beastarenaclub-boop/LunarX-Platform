import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import scene from "./scene.json";
import { art } from "./art";
import litNumber from "./assets/Buttons_9_0.png";
import litPointer from "./assets/Buttons_11_0.png";
import { DIGITS, DENOMINATIONS } from "./helpers";
import { viewport } from "./viewport";
import Wheel from "./Wheel";
import type { Reveal, WireBet } from "./types";
import { formatRupees } from "@/lib/format";
import type { Lang } from "@/game/i18n";
import { ft as t } from "./i18n";

const coinIds = [10, 75, 55, 46, 37, 60, 61, 57];
const controlIds = [14, 34, 48, 79, 107];
const numberIds = [31, 106, 43, 105, 95, 3, 78, 63, 83, 26];
function rect(id: number) { return scene.find(s => s.id === id)!.rect; }
function box(r: number[]) { return { left: r[0], top: r[1], width: r[2], height: r[3] }; }
export default function Cabinet(props: {
  lang: Lang; embedded: boolean; sound: boolean; spinning: boolean; chip: number; bets: WireBet[]; balance: bigint; winner: bigint; total: bigint;
  reveal: Reveal | null; restingPocket: number | null; resultPocket: number | null; history: number[];
  seconds: number | null; canBet: boolean; message: string; removeMode: boolean;
  controls: { take: ReactNode; clear: ReactNode; specific: ReactNode; place: ReactNode; exit: ReactNode };
  onChip: (value: number) => void; onDigit: (digit: number, repeat?: number) => void; onLand: (id: string, pocket: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null), [size, setSize] = useState({ width: 1024, height: 720 });
  const handler = useRef(props.onDigit); handler.current = props.onDigit;
  const permitted = useRef(props.canBet); permitted.current = props.canBet;
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopHold = () => { if (hold.current) clearTimeout(hold.current); hold.current = null; };
  useEffect(() => {
    const node = host.current!;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(node);
    return () => { observer.disconnect(); stopHold(); };
  }, []);
  useEffect(() => { if (!props.canBet) stopHold(); }, [props.canBet]);
  const transform = viewport(size.width, size.height);
  const digitAmount = (digit: number) => props.bets.filter(b => b.selection[0] === digit).reduce((s, b) => s + BigInt(b.amountPaise), 0n);
  const money = (amount: bigint) => formatRupees(amount).replace(/^₹/, "");
  const betMoney = (amount: bigint) => money(amount).replace(/\.00$/, "");
  const assets = scene.filter(s => s.active && s.id !== 40 && s.id !== 2 && s.id !== 109 && !controlIds.includes(s.id));
  function layer(s: typeof scene[number]) {
    if (s.asset.startsWith("FunTargetBg")) return 0;
    if (s.path.includes("Star_")) return 8;
    if (s.id === 41 || s.id === 62) return 6;
    if (s.path.includes("CoinsHeigh")) return 5;
    return 4;
  }
  return <div className="ft-cabinet-host" ref={host} data-testid="cabinet">
    <div className={"ft-cabinet " + (props.lang === "hi" ? "ft-hindi" : "")} style={{ transform: transform.rotated ? `translateX(${size.width}px) rotate(90deg) scale(${transform.scaleX}, ${transform.scaleY})` : `scale(${transform.scaleX}, ${transform.scaleY})` }}>
      {assets.map(s => {
        if (s.path.includes("CoinsHeigh") && Number(s.path.split("_").pop()) !== props.chip) return null;
        if (s.id === 113 && (props.seconds === null || props.seconds > 15 || props.seconds <= 10)) return null;
        return <img key={s.id} src={art[s.asset]} alt="" draggable={false} className={"ft-art " +
          (s.path.includes("Star_") ? "ft-star " : "") + (s.id === 69 ? "ft-title " : "") +
          (s.id === 113 ? "ft-clock-flash " : "")}
          style={{ ...box(s.rect), zIndex: layer(s) }} />;
      })}
      {props.resultPocket !== null && <div key={props.reveal?.roundId} className="ft-result-flash" aria-hidden="true">
        <img className="ft-art" src={litNumber} alt="" draggable={false} style={{ ...box(rect(numberIds[DIGITS.findIndex(digit => digit === props.resultPocket)])), zIndex: 4 }} />
        <img className="ft-art" src={litPointer} alt="" draggable={false} style={{ ...box(rect(62)), zIndex: 6 }} />
      </div>}
      <Wheel sound={props.sound} spinning={props.spinning} reveal={props.reveal} restingPocket={props.restingPocket} onLand={props.onLand} />
      <output className="ft-text ft-score" aria-label={t(props.lang, "funTargetScore")} data-testid="wallet-balance">{money(props.balance)}</output>
      <output className="ft-text ft-winner" aria-label={t(props.lang, "funTargetWinner")} data-testid="winner-amount">{money(props.winner)}</output>
      <output className="ft-text ft-clock" data-testid="round-clock">{props.seconds === null ? "—" : `0 : ${props.seconds}`}</output>
      <output className="ft-text ft-history" data-testid="recent-results" aria-label={t(props.lang, "funTargetHistory")}>{props.history.map((digit, index) => <span key={index}>{digit}</span>)}</output>
      <div data-testid="chip-rack" role="group" aria-label={t(props.lang, "funTargetChip")}>
        {DENOMINATIONS.map((value, index) => <button key={value} className="ft-hit ft-coin-hit" style={box(rect(coinIds[index]))} data-testid={`chip-${value}`} aria-label={`${t(props.lang, "funTargetChip")} ${value}`} aria-pressed={props.chip === value} onClick={() => props.onChip(value)} />)}
      </div>
      {DIGITS.map((digit, i) => {
        const r = rect(numberIds[i]), amount = digitAmount(digit);
        return <div key={digit}>
          <output className="ft-text ft-amount" style={{ left: r[0] + r[2] / 2, top: 601.2 }} data-testid={`stake-${digit}`}>{amount > 0n ? betMoney(amount) : ""}</output>
          <button className="ft-hit ft-digit" style={box(r)}
            aria-label={`${t(props.lang, "funTargetDigit")} ${digit}`} data-testid={`bet-spot-${digit}`}
            onPointerDown={e => { if (e.button !== 0) return; stopHold(); e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); handler.current(digit); if (!props.removeMode) { let count = 0; const repeat = () => { if (!permitted.current) return; handler.current(digit, ++count); hold.current = setTimeout(repeat, 90); }; hold.current = setTimeout(repeat, 350); } }}
            onPointerUp={stopHold} onPointerCancel={stopHold} onLostPointerCapture={stopHold}
            onClick={e => { if (e.detail === 0) handler.current(digit); }}>{digit}</button>
        </div>;
      })}
      <div className="ft-control ft-control-take" style={box(rect(107))}>{props.controls.take}</div>
      <div className="ft-control ft-control-cancel" style={box(rect(48))}>{props.controls.clear}</div>
      <div className="ft-control ft-control-cancel" style={box(rect(34))}>{props.controls.specific}</div>
      <div className="ft-control ft-control-bet" style={box(rect(79))}>{props.controls.place}</div>
      {!props.embedded && <div className="ft-control ft-control-exit" style={box(rect(14))}>{props.controls.exit}</div>}
      <output data-testid="total-bet-amount" className="ft-text ft-total" aria-label={t(props.lang, "funTargetTotal")}>{betMoney(props.total)}</output>
      <p className="ft-text ft-message" role="status" data-testid="game-message">{props.message}</p>
    </div>
  </div>;
}
