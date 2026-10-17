import { useSyncExternalStore } from "react";
import { store, type CrashPanelIndex } from "@/game/store";
import { setAutoBet } from "@/game/engine";

export type JetXPanelCount = 1 | 2 | 4;
type Preferences = { panelCount: JetXPanelCount; sidebar: boolean; animations: boolean; topWinner: boolean };
const defaults: Preferences = { panelCount: 4, sidebar: true, animations: true, topWinner: true };
const key = "jetx:display:v1";
let preferences = defaults;
try {
  const saved = JSON.parse(localStorage.getItem(key) || "{}");
  preferences = { ...defaults, ...Object.fromEntries(["sidebar", "animations", "topWinner"].filter(k => typeof saved[k] === "boolean").map(k => [k, saved[k]])), panelCount: [1, 2, 4].includes(saved.panelCount) ? saved.panelCount : 4 };
} catch { /* Private browsing and older saves use the default layout. */ }
const listeners = new Set<() => void>();
export const getJetXPreferences = () => preferences;
export function setJetXPreferences(patch: Partial<Preferences>) {
  preferences = { ...preferences, ...patch };
  try { localStorage.setItem(key, JSON.stringify(preferences)); } catch { /* Keep this session usable when storage is unavailable. */ }
  listeners.forEach(listener => listener());
}
export function useJetXPreferences() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getJetXPreferences);
}
export function canSetJetXPanelCount(count: JetXPanelCount) {
  return store.getState().panels.slice(count).every(panel => !panel.pendingBet && !panel.activeBetId);
}
export function setJetXPanelCount(panelCount: JetXPanelCount) {
  if (!canSetJetXPanelCount(panelCount)) return;
  // A display change never submits or cancels a bet. Stop hidden future repeats.
  ([0, 1, 2, 3] as CrashPanelIndex[]).filter(i => i >= panelCount).forEach(i => setAutoBet(i, { enabled: false }));
  setJetXPreferences({ panelCount });
}
