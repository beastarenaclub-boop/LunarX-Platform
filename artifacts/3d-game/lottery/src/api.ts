import type { Role } from "./types";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  role: Role,
  path: string,
  body?: unknown,
  key?: string,
): Promise<T> {
  const response = await fetch(`/api/lottery${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Lottery-Role": role,
      "X-Lottery-Request": "1",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(data.error ?? "Request failed.", response.status);
  return data;
}
const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
export const money = (n: number) => rupees.format(n);
export const time = (n: number, timezone = "Asia/Kolkata") =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  })
    .format(n)
    .toUpperCase();
export const date = (n: number, timezone = "Asia/Kolkata") =>
  new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: timezone,
  }).format(n);
export const SERIES = Array.from({ length: 10 }, (_, i) => `JP${10 + i}`);
// Display names are separate from the immutable series keys on existing draws.
export const seriesName = (series: string) =>
  series.replace(/^JP(?=1\d$)/, "Irland Lotto ");
export const TITLI = [
  "Butterfly",
  "Rose",
  "Sun",
  "Moon",
  "Star",
  "Leaf",
  "Diamond",
  "Crown",
  "Heart",
  "Bell",
];
export function csvDownload(name: string, rows: (string | number)[][]) {
  const escaped = rows
    .map((row) =>
      row
        .map(
          (cell) =>
            `"${String(cell)
              .replace(/^[=+@\-\t\r]/, "'$&")
              .replaceAll('"', '""')}"`,
        )
        .join(","),
    )
    .join("\r\n");
  const href = URL.createObjectURL(
    new Blob(["\uFEFF" + escaped], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
