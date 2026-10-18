import { useSyncExternalStore } from "react";
import { useAuth } from "./auth";

export const DEFAULT_BUTTON_VALUES = [100, 500, 1000, 2000, 5000, 10000];
const eventName = "account-button-values";
const key = (id: string) => `account:${id}:button-values:v1`;
export function validButtonValues(values: unknown): values is number[] {
  return (
    Array.isArray(values) &&
    values.length === 6 &&
    new Set(values).size === 6 &&
    values.every((v) => Number.isSafeInteger(v) && v >= 1 && v <= 1000000)
  );
}
function read(id?: string) {
  try {
    return id ? localStorage.getItem(key(id)) : null;
  } catch {
    return null;
  }
}
export function saveButtonValues(id: string, values: number[] | null) {
  if (values && !validButtonValues(values))
    throw new Error("Enter six different whole amounts from 1 to 10,00,000.");
  if (values)
    localStorage.setItem(
      key(id),
      JSON.stringify([...values].sort((a, b) => a - b)),
    );
  else localStorage.removeItem(key(id));
  window.dispatchEvent(new Event(eventName));
}
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(eventName, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(eventName, callback);
  };
}
export function useButtonValues() {
  const { user } = useAuth();
  const raw = useSyncExternalStore(
    subscribe,
    () => read(user && !user.isDemo ? user.id : undefined),
    () => null,
  );
  try {
    const parsed: unknown = JSON.parse(raw || "null");
    return validButtonValues(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
