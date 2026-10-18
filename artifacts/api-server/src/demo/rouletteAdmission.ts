// The isolated worker has one in-memory store, so no database connection or
// cross-process admission lock is needed. Concurrent requests still reject.
const busy = new Set<string>();
export async function withRouletteAdmission<T>(userId: string, action: () => Promise<T>): Promise<T> {
  if (busy.has(userId)) throw new Error("ROULETTE_BET_IN_PROGRESS");
  busy.add(userId);
  try { return await action(); } finally { busy.delete(userId); }
}
