export const API_BASE = '/api';

export async function fetcher(url: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include',
  });
  
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error?.message || errorData.message || 'API Error');
  }
  
  return res.json();
}

export function fetchAuthMe() {
  return fetcher('/auth/me');
}

export function login(credentials: any) {
  return fetcher('/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
}

export function signup(credentials: any) {
  return fetcher('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
}

export function logout() {
  return fetcher('/auth/logout', { method: 'POST' });
}

export function fetchWalletBalance() {
  return fetcher('/wallet/balance?game=horse-racing');
}

export function fetchRacingConfig() {
  return fetcher('/horse-racing/config');
}

export function createRacingRound() {
  return fetcher('/horse-racing/round', { method: 'POST', body: '{}' });
}

export async function playRacingBet(
  stakeAmount: string,
  horseId: number,
  stateId: string,
) {
  // Provably-fair lifecycle: get a committed round (server seed hash issued
  // BEFORE the stake), then place the bet against that round. The play
  // response reveals the seed so the outcome can be verified.
  const round = await createRacingRound();
  return fetcher('/horse-racing/play', {
    method: 'POST',
    body: JSON.stringify({ stakeAmount, horseId, stateId, roundId: round.roundId }),
  });
}
