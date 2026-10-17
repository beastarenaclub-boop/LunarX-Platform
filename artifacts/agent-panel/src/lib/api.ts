import { customFetch } from "@workspace/api-client-react";

export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  return customFetch<T>(url, {
    ...options,
    credentials: "include",
  });
}

export function formatPaise(paise: string | number): string {
  const val = typeof paise === "string" ? parseInt(paise, 10) : paise;
  if (isNaN(val)) return "0.00";
  return (val / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
