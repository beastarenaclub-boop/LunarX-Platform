"use client";
import { useMemo, useState } from "react";
import { Download, GitBranch } from "lucide-react";
import { Badge, Panel } from "../App";
import type { CommissionPlan } from "./commissions";
import { projectTree, type TreeScenario } from "./tree-projection";
import { inr } from "./types";
import { excel, pdf, type ExportSheet } from "./reporting";

export default function TreeCalculator({
  plan,
  notify,
}: {
  plan: CommissionPlan;
  notify: (message: string) => void;
}) {
  const [scenario, setScenario] = useState<TreeScenario>({
    depth: 5,
    turnover: 10000000,
    transactions: 100,
    above: 0,
  });
  const [selected, setSelected] = useState(3);
  const [tracePage, setTracePage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const outcome = useMemo(() => {
    try {
      return { result: projectTree(plan, scenario), error: "" };
    } catch (error) {
      return { result: null, error: (error as Error).message };
    }
  }, [plan, scenario]);
  const result = outcome.result;
  const selectedLevel = Math.min(selected, scenario.depth);
  const row = result?.levels[selectedLevel];
  const pageSize = 15;
  const trace = row?.distribution.allocations || [];
  const page = Math.min(
    tracePage,
    Math.max(0, Math.ceil(trace.length / pageSize) - 1),
  );
  const choose = (level: number) => {
    setSelected(level);
    setTracePage(0);
  };
  const edit = (patch: Partial<TreeScenario>) => {
    setScenario({ ...scenario, ...patch });
    setTracePage(0);
  };
  const integer = (value: string, max: number, min = 0) =>
    Math.max(min, Math.min(max, Math.trunc(Number(value) || 0)));
  async function download(format: "excel" | "pdf") {
    if (!result) return;
    setExporting(true);
    const sheets: ExportSheet[] = [
      {
        name: "Illustration assumptions",
        headings: ["Setting", "Value"],
        rows: [
          ["Status", "Illustration only; not actual earnings"],
          ["Plan version", plan.version],
          ["Rate basis", plan.basis],
          ["Downline levels", scenario.depth],
          ["Eligible uplines above selected agent", scenario.above],
          ["Turnover per member INR", scenario.turnover / 100],
          ["Transactions per member", scenario.transactions],
          [
            "Population",
            "Full binary tree; all ancestors eligible; equal activity; one settlement per source",
          ],
          ["Selected agent total INR", result.total.observerShare / 100],
          ["Network fee INR", result.total.fee / 100],
          ["Company INR incl unallocated shares", result.total.company / 100],
        ],
      },
      {
        name: "Level commission",
        headings: [
          "Level",
          "Members",
          "Turnover INR",
          "Total fee INR",
          "Selected agent per source INR",
          "Selected agent total INR",
          "Company INR",
        ],
        rows: result.levels.map((r) => [
          r.level,
          r.count,
          r.turnover / 100,
          r.fee / 100,
          r.observerPerSource / 100,
          r.observerShare / 100,
          r.company / 100,
        ]),
      },
      {
        name: `Level ${selectedLevel} source`,
        headings: ["Recipient", "Depth from source", "Share type", "INR"],
        rows: trace.map((a) => [a.name, a.depth, a.type, a.amount / 100]),
      },
    ];
    try {
      if (format === "excel")
        await excel(sheets, "tree-commission-illustration");
      else
        await pdf(
          "Tree commission illustration",
          `Plan v${plan.version} · Equal activity; all uplines eligible · Not booked income`,
          sheets,
          "tree-commission-illustration",
        );
    } catch {
      notify("Tree export failed. Please retry.");
    } finally {
      setExporting(false);
    }
  }
  return (
    <div className="tree-calculator">
      <Panel
        title="Poore tree ka commission calculator"
        eyebrow="ILLUSTRATION · CURRENT PLAN · NO WALLET CREDIT"
        action={<Badge>Plan v{plan.version}</Badge>}
      >
        <div className="live-form-pad">
          <p className="subtle-note no-pad">
            Ek agent ko select maan kar uske left, right aur har deeper level ki
            earning dekhein. Yeh complete binary tree ka example hai: har member
            ki activity barabar aur har upper agent eligible hai. Actual team ke
            liye Member performance mein agent aur date range select karein.
          </p>
          <div className="tree-inputs form">
            <label>
              Downline levels
              <select
                value={scenario.depth}
                onChange={(e) => edit({ depth: Number(e.target.value) })}
              >
                {Array.from({ length: 20 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1} levels ·{" "}
                    {(2 ** (i + 2) - 2).toLocaleString("en-IN")} downline
                  </option>
                ))}
              </select>
            </label>
            <label>
              Turnover per member (INR)
              <input
                type="number"
                min="1"
                max="10000000"
                step="0.01"
                value={scenario.turnover / 100}
                onChange={(e) =>
                  edit({
                    turnover: Math.max(
                      100,
                      Math.min(
                        1000000000,
                        Math.round((Number(e.target.value) || 0) * 100),
                      ),
                    ),
                  })
                }
              />
            </label>
            <label>
              Transactions per member
              <input
                type="number"
                min="1"
                max="1000000"
                value={scenario.transactions}
                onChange={(e) =>
                  edit({ transactions: integer(e.target.value, 1000000, 1) })
                }
              />
            </label>
            <label>
              Eligible agents above you
              <input
                type="number"
                min="0"
                max="1000"
                value={scenario.above}
                onChange={(e) => edit({ above: integer(e.target.value, 1000) })}
              />
            </label>
          </div>
          <p className="subtle-note no-pad">
            {plan.basis === "per100"
              ? "Earning turnover se banti hai; transaction count badalne se same turnover ka commission nahi badlega."
              : "Is plan mein successful transaction count rate ko multiply karta hai."}{" "}
            Aapke upar aur eligible agents honge to wahi indirect pool unke
            saath bhi batega.
          </p>
          <div className="page-actions spaced">
            <button
              className="btn secondary small"
              disabled={!result || exporting}
              onClick={() => void download("excel")}
            >
              <Download size={15} />
              Tree Excel
            </button>
            <button
              className="btn secondary small"
              disabled={!result || exporting}
              onClick={() => void download("pdf")}
            >
              <Download size={15} />
              Tree PDF
            </button>
          </div>
          {outcome.error && <p role="alert">{outcome.error}</p>}
        </div>
      </Panel>
      {result && (
        <>
          <div className="tree-summary spaced">
            {[
              ["Aapka own share", result.own, "tree-own"],
              ["2 direct members se", result.direct, "tree-direct"],
              ["Saari indirect team se", result.indirect, "tree-indirect"],
              ["Aapka total", result.total.observerShare, "tree-total"],
            ].map(([title, amount, id]) => (
              <article key={String(id)}>
                <span>{title}</span>
                <strong data-testid={String(id)}>{inr(Number(amount))}</strong>
              </article>
            ))}
          </div>
          <Panel
            title="Left → right → deeper team"
            className="spaced"
            action={
              <Badge>
                {(result.total.members - 1).toLocaleString("en-IN")} downline
              </Badge>
            }
          >
            <div className="live-form-pad">
              <div
                className="tree-visual"
                aria-label="Illustrative binary tree, first two downline levels"
              >
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path d="M50 16V32M25 32H75M25 32V47M75 32V47M25 50V65M75 50V65M12.5 65H37.5M62.5 65H87.5M12.5 65V81M37.5 65V81M62.5 65V81M87.5 65V81" />
                </svg>
                {[0, 1, 2]
                  .filter((level) => level <= scenario.depth)
                  .map((level) => (
                    <div className="tree-visual-row" key={level}>
                      {Array.from({ length: 2 ** level }, (_, index) => (
                        <button
                          key={index}
                          className={selectedLevel === level ? "selected" : ""}
                          onClick={() => choose(level)}
                          aria-label={`Level ${level} ${index + 1} commission details`}
                        >
                          <GitBranch size={15} />
                          <span>
                            {level === 0
                              ? "AAP"
                              : level === 1
                                ? index === 0
                                  ? "LEFT"
                                  : "RIGHT"
                                : `L2 · ${index + 1}`}
                          </span>
                          <strong>
                            {inr(result.levels[level].observerPerSource)}
                          </strong>
                          <small>
                            {level === 0 ? "Own share" : "Aapko per source"}
                          </small>
                        </button>
                      ))}
                    </div>
                  ))}
              </div>
              <div className="tree-branch-totals">
                <span>
                  Poora left branch → aapko{" "}
                  <strong>{inr((result.direct + result.indirect) / 2)}</strong>
                </span>
                <span>
                  Poora right branch → aapko{" "}
                  <strong>{inr((result.direct + result.indirect) / 2)}</strong>
                </span>
              </div>
              <p className="subtle-note no-pad">
                Drawing mein pehle 2 levels hain. Neeche level table mein saare{" "}
                {scenario.depth} levels ka hisaab hai; kisi level par click
                karke ek source ka payout poori upline mein dekhein. Left/right
                totals equal hain kyunki example mein dono branches ki activity
                barabar hai.
              </p>
              <div className="table-scroll">
                <table className="tree-level-table">
                  <thead>
                    <tr>
                      <th>Source level</th>
                      <th>Members</th>
                      <th>Level turnover</th>
                      <th>Aapko / source</th>
                      <th>Aapko level total</th>
                      <th>Share type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.levels.map((r) => (
                      <tr
                        key={r.level}
                        className={selectedLevel === r.level ? "selected" : ""}
                      >
                        <td>
                          <button
                            className="btn small"
                            onClick={() => choose(r.level)}
                            aria-label={`Inspect level ${r.level}`}
                          >
                            {r.level === 0
                              ? "Own activity"
                              : `Level ${r.level}`}
                          </button>
                        </td>
                        <td>{r.count.toLocaleString("en-IN")}</td>
                        <td>{inr(r.turnover)}</td>
                        <td>{inr(r.observerPerSource)}</td>
                        <td>
                          <strong>{inr(r.observerShare)}</strong>
                        </td>
                        <td>
                          {r.level === 0
                            ? "Self"
                            : r.level === 1
                              ? "Direct"
                              : "Indirect pool"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Panel>
          {row && (
            <Panel
              title={`Level ${selectedLevel}: ek source ka paisa kahan gaya?`}
              className="spaced"
              action={
                <Badge>{row.eligibleIndirect} eligible indirect uplines</Badge>
              }
            >
              <div className="live-form-pad">
                <p>
                  Ek source ka {inr(scenario.turnover)} turnover →{" "}
                  {inr(row.distribution.budget)} fee.{" "}
                  {row.count.toLocaleString("en-IN")} aise members × aapka{" "}
                  {inr(row.observerPerSource)} share ={" "}
                  <strong>{inr(row.observerShare)}</strong> is level se.
                </p>
                <div className="table-scroll">
                  <table className="tree-trace">
                    <thead>
                      <tr>
                        <th>Recipient</th>
                        <th>Source se depth</th>
                        <th>Share</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trace
                        .slice(page * pageSize, (page + 1) * pageSize)
                        .map((a) => (
                          <tr
                            key={a.member}
                            className={
                              a.depth === selectedLevel ? "selected" : ""
                            }
                          >
                            <td>{a.name}</td>
                            <td>{a.depth}</td>
                            <td>{a.type}</td>
                            <td>{inr(a.amount)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {trace.length > pageSize && (
                  <div className="page-actions spaced">
                    <button
                      className="btn small"
                      disabled={page === 0}
                      onClick={() => setTracePage(page - 1)}
                    >
                      Previous recipients
                    </button>
                    <span>
                      {page + 1} / {Math.ceil(trace.length / pageSize)}
                    </span>
                    <button
                      className="btn small"
                      disabled={(page + 1) * pageSize >= trace.length}
                      onClick={() => setTracePage(page + 1)}
                    >
                      Next recipients
                    </button>
                  </div>
                )}
                <div className="summary-pills spaced">
                  <span>
                    Members / agents{" "}
                    <strong>{inr(row.distribution.paid)}</strong>
                  </span>
                  <span>
                    Company <strong>{inr(row.distribution.company)}</strong>
                  </span>
                  <span>
                    Reserve <strong>{inr(row.distribution.reserve)}</strong>
                  </span>
                </div>
                <p className="subtle-note no-pad">
                  Ek pool sab eligible indirect ancestors mein divide hota hai.
                  Whole paisa ka remainder nearest eligible uplines ko milta
                  hai. ₹0 allocations list mein nahi dikhte. Koi eligible
                  indirect upline na ho to us pool ka paisa company mein rehta
                  hai.
                </p>
              </div>
            </Panel>
          )}
          <Panel
            title="Company ko poora system ka hisaab"
            className="spaced"
            eyebrow="SAME ILLUSTRATED PERIOD · INCLUDES SELECTED AGENT'S OWN ACTIVITY"
          >
            <div className="live-form-pad tree-audit">
              {[
                [
                  "Total active sources",
                  result.total.members.toLocaleString("en-IN"),
                ],
                ["Total turnover", inr(result.total.turnover)],
                ["Total earned fee", inr(result.total.fee)],
                ["All source members", inr(result.total.selfPaid)],
                ["All direct agents", inr(result.total.directPaid)],
                ["All indirect agents", inr(result.total.indirectPaid)],
                ["Reward reserve", inr(result.total.reserve)],
                ["Company incl. unallocated shares", inr(result.total.company)],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
              <p className="subtle-note no-pad">
                Fee = self + direct + indirect + reserve + company. Aapka total
                upar ke member/agent shares mein already include hai; use dobara
                expense mein add nahi karna. Aapke upar agents set kiye hain to
                unko jane wala payout bhi totals mein include hai.
              </p>
              <p className="subtle-note no-pad">
                Pool mode mein payout depth ki fixed limit nahi hai; same pool
                divide hota rahega. Calculator 20 downline levels tak summarize
                karta hai. Actual earning approved activity aur eligibility par
                depend karti hai. Member performance mein day/month filters aur
                Excel/PDF se booked data reconcile karein.
              </p>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
