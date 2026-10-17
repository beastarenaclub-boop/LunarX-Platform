import { create } from "zustand";
import {
  CAMERA_MODES,
  RUNNERS,
  VENUES,
  makePlan,
  oddsFor,
  settle,
  venueById,
  type CameraMode,
  type Phase,
  type RacePlan,
  type RaceResult,
  type Ticket,
} from "./engine";

const KEY = "turf-club-practice-v1";
interface Saved {
  balance: number;
  tickets: Ticket[];
  history: RaceResult[];
  plan: RacePlan | null;
  venueId: string;
}
const initial: Saved = {
  balance: 10000,
  tickets: [],
  history: [],
  plan: null,
  venueId: "royal",
};
function read(): Saved {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (
      !value ||
      !Number.isSafeInteger(value.balance) ||
      value.balance < 0 ||
      !Array.isArray(value.tickets) ||
      !Array.isArray(value.history)
    )
      return initial;
    if (
      !value.tickets.every(
        (t: Ticket) =>
          RUNNERS.some((r) => r.id === t.horseId) &&
          Number.isSafeInteger(t.stake) &&
          t.stake > 0 &&
          t.odds === oddsFor(t.horseId),
      )
    )
      return initial;
    if (
      value.plan &&
      (!Array.isArray(value.plan.times) ||
        value.plan.times.length !== 8 ||
        !value.plan.times.every((t: number) => Number.isFinite(t) && t > 0) ||
        !Array.isArray(value.plan.order) ||
        new Set(value.plan.order).size !== 8 ||
        !value.plan.order.every((id: number) =>
          RUNNERS.some((r) => r.id === id),
        ) ||
        !Array.isArray(value.plan.phases) ||
        value.plan.phases.length !== 8 ||
        !value.plan.phases.every(Number.isFinite) ||
        !Number.isFinite(value.plan.startAt))
    )
      return initial;
    return {
      ...initial,
      ...value,
      history: value.history.slice(0, 12),
      venueId: venueById(value.venueId).id,
    };
  } catch {
    return initial;
  }
}
function save(s: Saved) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        balance: s.balance,
        tickets: s.tickets,
        history: s.history,
        plan: s.plan,
        venueId: s.venueId,
      }),
    );
  } catch {
    /* Private browsing: continue with the in-memory practice wallet. */
  }
}
interface State extends Saved {
  phase: Phase;
  elapsed: number;
  selected: number;
  camera: CameraMode;
  autoCamera: boolean;
  muted: boolean;
  quality: "high" | "low";
  visualMode: "cinematic" | "simulation";
  error: string | null;
  result: RaceResult | null;
  select: (id: number) => void;
  setVenue: (id: string) => void;
  addTicket: (stake: number) => boolean;
  removeTicket: (id: number) => void;
  start: () => void;
  tick: (now?: number) => void;
  next: () => void;
  setCamera: (mode: CameraMode) => void;
  toggleAuto: () => void;
  toggleSound: () => void;
  toggleQuality: () => void;
  setVisualMode: (mode: "cinematic" | "simulation") => void;
  refill: () => void;
}
const saved = read();
export const useTurf = create<State>((set, get) => ({
  ...saved,
  phase: saved.plan ? "countdown" : "betting",
  elapsed: 0,
  selected: 1,
  camera: "broadcast",
  autoCamera: true,
  muted: true,
  quality: "high",
  visualMode: "cinematic",
  error: null,
  result: null,
  select: (id) => {
    if (RUNNERS.some((r) => r.id === id)) set({ selected: id, error: null });
  },
  setVenue: (id) => {
    const s = get();
    if (
      s.phase !== "betting" ||
      !VENUES.some((v) => v.id === id) ||
      s.venueId === id
    )
      return;
    // Tickets belong to a meeting; return their reserved practice coins when switching meetings.
    const update = {
      venueId: id,
      balance: s.balance + s.tickets.reduce((n, t) => n + t.stake, 0),
      tickets: [],
      error: null,
    };
    set(update);
    save(get());
  },
  addTicket: (stake) => {
    const s = get();
    if (s.phase !== "betting") return false;
    if (!Number.isSafeInteger(stake) || stake < 10 || stake > 10000) {
      set({ error: "Enter a whole-number stake from 10 to 10,000 coins." });
      return false;
    }
    if (stake > s.balance) {
      set({
        error:
          "Not enough practice coins. Lower your stake or remove a ticket.",
      });
      return false;
    }
    const tickets = s.tickets.map((t) => ({ ...t }));
    const existing = tickets.find((t) => t.horseId === s.selected);
    if (existing) existing.stake += stake;
    else
      tickets.push({ horseId: s.selected, stake, odds: oddsFor(s.selected) });
    set({ tickets, balance: s.balance - stake, error: null });
    save(get());
    return true;
  },
  removeTicket: (id) => {
    const s = get();
    if (s.phase !== "betting") return;
    const ticket = s.tickets.find((t) => t.horseId === id);
    if (!ticket) return;
    set({
      balance: s.balance + ticket.stake,
      tickets: s.tickets.filter((t) => t.horseId !== id),
      error: null,
    });
    save(get());
  },
  start: () => {
    const s = get();
    if (s.phase !== "betting") return;
    set({
      plan: makePlan(venueById(s.venueId)),
      phase: "countdown",
      elapsed: -3,
      result: null,
      error: null,
    });
    save(get());
  },
  tick: (now = Date.now()) => {
    const s = get();
    if (!s.plan || s.phase === "finished") return;
    const elapsed = (now - s.plan.startAt) / 1000;
    if (elapsed >= Math.max(...s.plan.times) + 0.6) {
      const result = settle(s.plan, s.tickets, now);
      // Save payout and removal of the active race together: refreshing cannot settle twice.
      set({
        phase: "finished",
        elapsed,
        result,
        plan: null,
        balance: s.balance + result.payout,
        tickets: [],
        history: [result, ...s.history].slice(0, 12),
      });
      save(get());
    } else set({ elapsed, phase: elapsed < 0 ? "countdown" : "racing" });
  },
  next: () => {
    if (get().phase === "finished")
      set({
        phase: "betting",
        elapsed: 0,
        plan: null,
        result: null,
        error: null,
      });
  },
  setCamera: (camera) => {
    if (CAMERA_MODES.includes(camera)) set({ camera, autoCamera: false });
  },
  toggleAuto: () => set((s) => ({ autoCamera: !s.autoCamera })),
  toggleSound: () => set((s) => ({ muted: !s.muted })),
  setVisualMode: (visualMode) => set({ visualMode }),
  toggleQuality: () =>
    set((s) => ({ quality: s.quality === "high" ? "low" : "high" })),
  refill: () => {
    const s = get();
    if (s.phase === "betting" && s.balance < 10 && s.tickets.length === 0) {
      set({ balance: 10000, error: null });
      save(get());
    }
  },
}));
