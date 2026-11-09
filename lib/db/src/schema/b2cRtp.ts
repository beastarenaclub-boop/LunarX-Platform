import { pgTable, text, integer, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

export const b2cRtpPoliciesTable = pgTable("b2c_rtp_policies", {
  gameCode: text("game_code").primaryKey(),
  playerRtpBps: integer("player_rtp_bps"),
  revision: integer("revision").notNull().default(0),
  updatedBy: text("updated_by").references(() => usersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  check("b2c_rtp_range_check", sql`${t.playerRtpBps} IS NULL OR ${t.playerRtpBps} BETWEEN 100 AND 10000`),
  check("b2c_rtp_revision_check", sql`${t.revision} >= 0`),
]);
