import { z } from "zod";
import { badRequest } from "../lib/errors";

export const reportFilter = z.object({
  period: z
    .enum(["today", "yesterday", "weekly", "monthly", "custom"])
    .default("today"),
  channel: z.enum(["b2b", "b2c"]).default("b2b"),
  masterId: z.string().min(1).max(100).optional(),
  agentId: z.string().min(1).max(100).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

const DAY = 86_400_000;
const day = (date: Date) => date.toISOString().slice(0, 10);

// Fixed IST offset, independent of the API host's timezone or browser clock.
export function networkReportRange(
  input: z.infer<typeof reportFilter>,
  now = new Date(),
) {
  const today = day(new Date(now.getTime() + 330 * 60_000));
  const start = new Date(`${today}T00:00:00Z`);
  let from = today,
    to = today;
  if (input.period === "yesterday")
    from = to = day(new Date(start.getTime() - DAY));
  if (input.period === "weekly") {
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    from = day(start);
    to = day(new Date(start.getTime() + 6 * DAY));
  }
  if (input.period === "monthly") {
    from = `${today.slice(0, 7)}-01`;
    to = day(
      new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)),
    );
  }
  if (input.period === "custom") {
    if (!input.from || !input.to)
      throw badRequest("Choose both start and end dates");
    from = input.from;
    to = input.to;
  }
  if (from > to) throw badRequest("Start date must precede end date");
  if ((Date.parse(to) - Date.parse(from)) / DAY >= 366)
    throw badRequest("Choose a date range of up to 366 days");
  return { period: input.period, from, to, timezone: "Asia/Kolkata", today };
}
