"use client";
import { useState } from "react";
import { ArrowDown, Network } from "lucide-react";
import { Badge, Panel } from "../App";
import { inr } from "./types";
import { commissionAmount, type CommissionPlan } from "./commissions";

export default function CommissionChart({ plan: p }: { plan: CommissionPlan }) {
  const turnoverBasis = p.basis === "per100";
  const [left, setLeft] = useState(turnoverBasis ? 100000 : 100);
  const [right, setRight] = useState(turnoverBasis ? 100000 : 100);
  const [batch, setBatch] = useState(turnoverBasis ? 100000 : 100);
  const number = (value: string) =>
    Math.min(
      10000000,
      Math.max(
        0,
        turnoverBasis
          ? Math.round((Number(value) || 0) * 100) / 100
          : Math.trunc(Number(value) || 0),
      ),
    );
  const share = (rate: number, value: number) =>
    commissionAmount(
      turnoverBasis ? "per100" : "transaction",
      rate,
      Math.trunc(value),
      Math.round(value * 100),
    );
  const pool = p.indirect * (p.mode === "pool" ? 1 : p.levels);
  const company = p.gross - p.self - p.direct - pool - p.reserve;
  const parts = [
    {
      label: "Source member",
      value: p.self,
      text: "Apne sabhi accounts ki verified activity. Member aur agent, dono ka own share.",
      tone: "self",
    },
    {
      label: "Direct parent agent",
      value: p.direct,
      text: "Sirf transaction karne wale member ka ek eligible direct parent.",
      tone: "direct",
    },
    {
      label:
        p.mode === "pool" ? "Shared indirect pool" : "Total indirect levels",
      value: pool,
      text: !pool
        ? "Is plan mein indirect commission allocate nahi hai."
        : p.mode === "pool"
          ? "Level 2 se root tak sab eligible upper agents milkar baantenge."
          : `${p.levels} indirect levels; actual ancestry, no skipped levels.`,
      tone: "indirect",
    },
    {
      label: "Rewards reserve",
      value: p.reserve,
      text: p.reserve
        ? "Approved task incentives aur benefits ke liye reserve."
        : "Is plan se naya reward reserve fund nahi hota.",
      tone: "reserve",
    },
    {
      label: "Company retention",
      value: company,
      text: "Company / admin ka hissa; operating costs aur tax se pehle.",
      tone: "company",
    },
  ];
  return (
    <div className="commission-chart">
      <Panel
        title={`${inr(p.gross)} ka distribution chart`}
        eyebrow="CURRENT PLAN · ILLUSTRATION, NOT A WALLET CREDIT"
        action={<Badge>Plan v{p.version}</Badge>}
      >
        <div className="live-form-pad">
          <div className="commission-source">
            <Network size={25} />
            <div>
              <strong>{inr(p.gross)} company fee</strong>
              <p>
                {p.basis === "transaction"
                  ? "Har verified successful transaction par fixed budget"
                  : p.basis === "per100"
                    ? "Har ₹100 verified turnover par budget"
                    : "Rate basis abhi confirm nahi hai"}
              </p>
            </div>
            <Badge tone={p.enabled ? "green" : "gold"}>
              {p.enabled ? "Active plan" : "Inactive plan"}
            </Badge>
          </div>
          <div className="commission-split-bar" aria-hidden="true">
            {parts.map((part) => (
              <span
                key={part.tone}
                className={part.tone}
                style={{ flexGrow: Math.max(0, part.value) }}
              />
            ))}
          </div>
          <div className="commission-parts">
            {parts.map((part) => (
              <article key={part.tone} className={part.tone}>
                <small>{part.label}</small>
                <strong>{inr(part.value)}</strong>
                <p>{part.text}</p>
              </article>
            ))}
          </div>
          {turnoverBasis && (
            <p className="subtle-note no-pad">
              Har ₹100 verified turnover par {inr(p.gross)} total commission:{" "}
              {inr(p.direct)} eligible direct upper agent ko, {inr(p.self)}{" "}
              member ko, aur {inr(company)} company/admin ko
              {pool || p.reserve
                ? "; indirect pool aur reserve alag upar dikhaye hain"
                : ""}
              . Transaction count se rate multiply nahi hota.
            </p>
          )}
          <p className="subtle-note no-pad">
            Ek transaction ek source member ki hoti hai. Multiple bank accounts
            ya naya member join karne se extra commission nahi banta. Missing ya
            ineligible upline ka share company mein rehta hai; kisi doosre level
            ko direct share nahi milta.
          </p>
        </div>
      </Panel>
      {turnoverBasis && <AccountTurnoverExample plan={p} />}
      {p.basis !== "pending" && (
        <Panel
          title="Left + right: aapko kitna milega?"
          className="spaced"
          eyebrow="EXAMPLE · BOTH DIRECT SHARES REQUIRE YOUR AGENT ELIGIBILITY"
        >
          <div className="live-form-pad">
            <div className="commission-parent">
              <span>AAP · ELIGIBLE AGENT</span>
              <strong>
                {inr(share(p.direct, left) + share(p.direct, right))}
              </strong>
              <small>
                Dono direct members ki{" "}
                {turnoverBasis ? "own turnover" : "transactions"} se aapka total
              </small>
            </div>
            <div className="commission-branches">
              {[
                { side: "Left", value: left, set: setLeft },
                { side: "Right", value: right, set: setRight },
              ].map(({ side, value, set }) => (
                <article key={side}>
                  <ArrowDown size={20} />
                  <h3>{side} direct member</h3>
                  <label className="form">
                    {side}{" "}
                    {turnoverBasis
                      ? "member turnover (INR)"
                      : "successful transactions"}
                    <input
                      type="number"
                      min="0"
                      max="10000000"
                      step={turnoverBasis ? "0.01" : "1"}
                      value={value}
                      onChange={(e) => set(number(e.target.value))}
                    />
                  </label>
                  <p>
                    Us member ka own share{" "}
                    <strong>{inr(share(p.self, value))}</strong>
                  </p>
                  <p>
                    Aapka direct share{" "}
                    <strong>{inr(share(p.direct, value))}</strong>
                  </p>
                </article>
              ))}
            </div>
            <p className="subtle-note no-pad">
              {turnoverBasis ? (
                <>
                  Left {inr(Math.round(left * 100))} aur right{" "}
                  {inr(Math.round(right * 100))} turnover se{" "}
                  {inr(share(p.direct, left))} + {inr(share(p.direct, right))} ={" "}
                  <strong>
                    {inr(share(p.direct, left) + share(p.direct, right))}
                  </strong>
                  . Har side ki actual own turnover ek baar count hoti hai. Dono
                  taraf ka combined turnover{" "}
                  {inr(Math.round((left + right) * 100))} hai; ek hi turnover
                  par do direct shares nahi lagte.
                </>
              ) : (
                <>
                  {left.toLocaleString("en-IN")} × {inr(p.direct)} +{" "}
                  {right.toLocaleString("en-IN")} × {inr(p.direct)} ={" "}
                  <strong>{inr((left + right) * p.direct)}</strong>. Dono ki
                  ek-ek transaction ho to {inr(2 * p.direct)}; ek transaction
                  par sirf {inr(p.direct)} direct share. Direct child member ho
                  ya agent, uski own successful transactions par yahi rule hai.
                  Uske neeche ki transactions aapke liye configured indirect
                  pool mein aati hain.
                </>
              )}
            </p>
          </div>
        </Panel>
      )}
      {!pool && (
        <Panel
          title="Commission kahan tak jayega?"
          className="spaced"
          action={<Badge>Direct parent only</Badge>}
        >
          <p className="live-form-pad">
            Is plan mein har member ki activity se us member ko own share aur
            uske ek eligible direct upper agent ko direct share milta hai. Usse
            upar ke agents ke liye indirect pool ₹0.00 hai. Wahi rule har naye
            member par lagega; network badhne se ek hi fee baar-baar distribute
            nahi hoti. Admin future plan mein budget ke andar indirect pool ya
            rewards fund kar sakta hai.
          </p>
        </Panel>
      )}
      {pool > 0 && p.mode === "pool" && p.basis !== "pending" && (
        <Panel
          title="Kitni upline tak batega?"
          className="spaced"
          action={<Badge>No fixed level cap</Badge>}
        >
          <div className="live-form-pad">
            <p>
              Source ke direct parent ke upar, level 2 se root tak sab eligible
              agents ek hi {inr(p.indirect)} pool share karte hain. Har
              {turnoverBasis ? "₹100 verified turnover" : "transaction"} par
              naya funded pool banta hai; payout budget depth ke saath badhta
              nahi.
            </p>
            <label className="form commission-batch">
              Settlement batch:{" "}
              {turnoverBasis ? "turnover (INR)" : "successful transactions"}
              <input
                type="number"
                min="1"
                max="10000000"
                step={turnoverBasis ? "0.01" : "1"}
                value={batch}
                onChange={(e) => setBatch(Math.max(1, number(e.target.value)))}
              />
            </label>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Eligible indirect uplines</th>
                    <th>Total batch pool</th>
                    <th>Actual whole-paisa distribution</th>
                  </tr>
                </thead>
                <tbody>
                  {[1, 2, 5, 10, 20, 100, 1000].map((count) => {
                    const total = share(p.indirect, batch),
                      each = Math.floor(total / count),
                      extra = total % count;
                    return (
                      <tr key={count}>
                        <td>{count}</td>
                        <td>{inr(total)}</td>
                        <td>
                          {extra
                            ? `${extra} nearest agents: ${inr(each + 1)} each; ${count - extra} others: ${inr(each)} each`
                            : `${inr(each)} each`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="subtle-note no-pad">
              Whole paisa mein settlement hota hai. Remainder ka 1 paisa nearest
              eligible uplines ko pehle milta hai.{" "}
              {turnoverBasis ? "Har ₹100 turnover" : "Single transaction"} ke{" "}
              {inr(p.indirect)} pool mein maximum {p.indirect} agents ko
              kam-se-kam 1 paisa mil sakta hai; baaki ko us settlement mein
              ₹0.00. Fractional paisa future settlements mein carry nahi hota.
              Bade batch mein zyada uplines ko positive share mil sakta hai;
              sabko unlimited fixed income ki guarantee nahi hai.
            </p>
          </div>
        </Panel>
      )}
    </div>
  );
}

function AccountTurnoverExample({ plan: p }: { plan: CommissionPlan }) {
  const [accounts, setAccounts] = useState([20000, 20000, 20000, 20000, 20000]);
  const rows = accounts.map((turnover) => {
    const amount = (rate: number) =>
      commissionAmount("per100", rate, 0, Math.round(turnover * 100));
    const fee = amount(p.gross),
      self = amount(p.self),
      direct = amount(p.direct);
    const indirect = amount(p.indirect) * (p.mode === "pool" ? 1 : p.levels);
    const reserve = amount(p.reserve);
    return {
      turnover: Math.round(turnover * 100),
      fee,
      self,
      direct,
      indirect,
      reserve,
      company: fee - self - direct - indirect - reserve,
    };
  });
  const total = rows.reduce(
    (sum, row) => ({
      turnover: sum.turnover + row.turnover,
      fee: sum.fee + row.fee,
      self: sum.self + row.self,
      direct: sum.direct + row.direct,
      company: sum.company + row.company,
      indirect: sum.indirect + row.indirect,
      reserve: sum.reserve + row.reserve,
    }),
    {
      turnover: 0,
      fee: 0,
      self: 0,
      direct: 0,
      company: 0,
      indirect: 0,
      reserve: 0,
    },
  );
  return (
    <Panel
      title="Ek member ke sab accounts ka hisaab"
      className="spaced"
      eyebrow="EDITABLE EXAMPLE · ELIGIBLE UPLINE · NOT YOUR ACTUAL ACCOUNTS"
    >
      <div className="live-form-pad commission-accounts">
        <p className="subtle-note no-pad">
          Member ke har account ka verified turnover judega. Neeche amounts
          badal kar dekhein; actual bank-wise data Member performance mein milta
          hai.
        </p>
        <div className="commission-account-inputs">
          {accounts.map((value, index) => (
            <label className="form" key={index}>
              Account {index + 1} turnover (INR)
              <input
                type="number"
                min="0"
                max="10000000"
                step="0.01"
                value={value}
                onChange={(e) =>
                  setAccounts(
                    accounts.map((old, i) =>
                      i !== index
                        ? old
                        : Math.min(
                            10000000,
                            Math.max(
                              0,
                              Math.round((Number(e.target.value) || 0) * 100) /
                                100,
                            ),
                          ),
                    ),
                  )
                }
              />
            </label>
          ))}
        </div>
        <div className="commission-account-actions">
          <button
            className="btn"
            type="button"
            disabled={accounts.length >= 20}
            onClick={() => setAccounts([...accounts, 0])}
          >
            Add example account
          </button>
          <button
            className="btn"
            type="button"
            disabled={accounts.length <= 1}
            onClick={() => setAccounts(accounts.slice(0, -1))}
          >
            Remove last example account
          </button>
        </div>
        <div className="summary-pills">
          <span>
            Total turnover{" "}
            <strong data-testid="account-total-turnover">
              {inr(total.turnover)}
            </strong>
          </span>
          <span>
            Total earned fee{" "}
            <strong data-testid="account-total-fee">{inr(total.fee)}</strong>
          </span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Hissa</th>
                <th>Rule per ₹100 turnover</th>
                <th>Sab accounts ka total</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Direct upper agent", p.direct, total.direct],
                ["Member keeps", p.self, total.self],
                [
                  "Company / admin",
                  p.gross -
                    p.direct -
                    p.self -
                    p.indirect * (p.mode === "pool" ? 1 : p.levels) -
                    p.reserve,
                  total.company,
                ],
                ...(p.indirect
                  ? [
                      [
                        "Indirect agents",
                        p.indirect * (p.mode === "pool" ? 1 : p.levels),
                        total.indirect,
                      ],
                    ]
                  : []),
                ...(p.reserve
                  ? [["Rewards reserve", p.reserve, total.reserve]]
                  : []),
              ].map(([label, rate, amount]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>{inr(Number(rate))}</td>
                  <td>{inr(Number(amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="subtle-note no-pad">
          Total {inr(total.fee)} − direct agent {inr(total.direct)} ={" "}
          {inr(total.fee - total.direct)} baaki. Member {inr(total.self)} rakhta
          hai aur company/admin ka hissa {inr(total.company)} hai.
          {total.indirect || total.reserve
            ? " Indirect pool aur reserve bhi upar include hain."
            : ""}{" "}
          Har approved turnover record ek baar settle hota hai. Rounding
          record-wise whole paisa mein hoti hai; sirf accounts ki sankhya badhne
          se commission nahi badhta.
        </p>
      </div>
    </Panel>
  );
}
