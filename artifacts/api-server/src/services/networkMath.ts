export interface NetworkTerms {
  companyFeeBps: number;
  masterShareBps: number;
  agentShareBps: number;
}

/** Percentages are of the parent's allocation. Keep signed paise, never floats. */
export function splitNetworkProfit(net: bigint, terms: NetworkTerms) {
  for (const value of Object.values(terms)) {
    if (!Number.isInteger(value) || value < 0 || value > 10000)
      throw new Error("Invalid percentage");
  }
  const fee = (net * BigInt(terms.companyFeeBps)) / 10000n;
  const masterPool = ((net - fee) * BigInt(terms.masterShareBps)) / 10000n;
  const agent = (masterPool * BigInt(terms.agentShareBps)) / 10000n;
  return { company: net - masterPool, master: masterPool - agent, agent };
}
