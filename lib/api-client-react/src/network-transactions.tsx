import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import {
  TransactionFilters,
  TransactionPagination,
  useTransactionFilters,
  transactionMoney,
  walletTypes,
  type TransactionPageInfo,
} from "./transaction-filters";
import type { NetworkNode } from "./network-panel";

export function NetworkTransactions({
  kind,
  role,
  nodes,
  channel = "b2b",
  userId,
}: {
  kind: "wallet" | "settlements";
  role: "admin" | "master" | "agent";
  nodes: NetworkNode[];
  channel?: string;
  userId?: string;
}) {
  const filters = useTransactionFilters(),
    [master, setMaster] = useState(""),
    [agent, setAgent] = useState("");
  const scopedNodes = kind === "settlements" && role !== "admin" ? [] : nodes;
  const params = new URLSearchParams({
    ...filters.query,
    channel,
    ...(channel === "b2b" && (agent || master)
      ? { nodeId: agent || master }
      : {}),
    ...(userId ? { userId } : {}),
  });
  const result = useQuery({
    queryKey: ["network", "filtered-transactions", kind, params.toString()],
    queryFn: ({ signal }) =>
      customFetch<
        TransactionPageInfo & {
          items: {
            id: string;
            created_at: string;
            email: string;
            name?: string;
            type?: string;
            amount: string;
            balance_after?: string;
            memo?: string;
            ref_id?: string;
            reference?: string;
          }[];
        }
      >(
        `/api/network/${kind === "wallet" ? "wallet-ledger" : "settlements"}?${params}`,
        { signal },
      ),
    refetchInterval: 30_000,
  });
  return (
    <section
      className="net-card"
      aria-label={
        kind === "wallet" ? "Wallet transactions" : "Company settlements"
      }
    >
      <h2>
        {kind === "wallet"
          ? "Wallet transactions"
          : "Recorded company settlements"}
      </h2>
      <p>
        {kind === "wallet"
          ? "Deposits, game debits, returns and downline fund transfers."
          : "Positive amounts record profit paid out; negative amounts record losses collected. These records do not move wallet funds."}
      </p>
      {channel === "b2b" && !userId && scopedNodes.length > 0 && (
        <div className="net-filters">
          {role === "admin" && (
            <label className="net-field">
              <span>Transaction master</span>
              <select
                aria-label="Transaction master"
                value={master}
                onChange={(e) => {
                  setMaster(e.target.value);
                  setAgent("");
                  filters.setOffset(0);
                }}
              >
                <option value="">All masters</option>
                {scopedNodes
                  .filter((n) => n.kind === "master")
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {role !== "agent" && (
            <label className="net-field">
              <span>Transaction agent</span>
              <select
                aria-label="Transaction agent"
                value={agent}
                onChange={(e) => {
                  setAgent(e.target.value);
                  filters.setOffset(0);
                }}
              >
                <option value="">All agents</option>
                {scopedNodes
                  .filter(
                    (n) =>
                      n.kind === "agent" && (!master || n.parent_id === master),
                  )
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>
      )}
      <TransactionFilters
        state={filters}
        types={kind === "wallet" ? walletTypes : undefined}
      />
      {result.isFetching && <p role="status">Loading transactions…</p>}
      {result.isError && (
        <p role="alert" className="net-error">
          {result.error.message}{" "}
          <button onClick={() => void result.refetch()}>
            Retry transactions
          </button>
        </p>
      )}
      {result.data && !result.isError && (
        <>
          <div className="net-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time (IST)</th>
                  <th>Account</th>
                  {kind === "wallet" && <th>Type</th>}
                  <th>Amount</th>
                  {kind === "wallet" && <th>Balance after</th>}
                  <th>Reference / memo</th>
                </tr>
              </thead>
              <tbody>
                {result.data.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {new Date(row.created_at).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                      })}
                    </td>
                    <td>
                      {row.name ?? row.email}
                      <small>{row.name ? row.email : ""}</small>
                    </td>
                    {kind === "wallet" && <td>{row.type}</td>}
                    <td
                      className={
                        BigInt(row.amount) < 0 ? "net-negative" : "net-positive"
                      }
                    >
                      {transactionMoney(row.amount)}
                    </td>
                    {kind === "wallet" && (
                      <td>{transactionMoney(row.balance_after ?? "0")}</td>
                    )}
                    <td>
                      {row.reference ?? row.memo}
                      <small>{row.ref_id}</small>
                      <small>ID {row.id}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!result.data.items.length && (
            <p className="net-empty">No transactions match these filters.</p>
          )}
        </>
      )}
      <TransactionPagination
        state={filters}
        data={result.isError ? undefined : result.data}
        loading={result.isFetching}
      />
    </section>
  );
}
