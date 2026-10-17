export class Fault extends Error {
  status: number;
  constructor(message: string, status?: number);
}
export interface WinGoStore {
  accountSession(accountId: string): string;
  session(token?: string): { token: string; fresh: boolean };
  state(token: string, duration?: number): Record<string, unknown>;
  placeBet(
    token: string,
    input: Record<string, unknown>,
  ): Record<string, unknown>;
  refill(token: string, duration?: number): Record<string, unknown>;
  tick(): void;
  close(): void;
}
export function createStore(
  filename?: string,
  options?: { now?: () => number; draw?: () => number },
): WinGoStore;
