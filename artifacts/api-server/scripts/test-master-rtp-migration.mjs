// Full deployment migration chain, isolated from every persistent database.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const base = new URL("../../../lib/db/drizzle/", import.meta.url);
const journal = JSON.parse(await readFile(new URL("meta/_journal.json", base), "utf8"));
const memory = new PGlite();
try {
  for (const entry of journal.entries) {
    try { await memory.exec(await readFile(new URL(`${entry.tag}.sql`, base), "utf8")); }
    catch (cause) { throw new Error(`Migration ${entry.tag} failed`, { cause }); }
  }
  const columns = await memory.query("select table_name,column_name from information_schema.columns where (table_name='network_nodes' and column_name in ('player_rtp_bps','rtp_revision')) or (table_name='table_round_bets' and column_name='pricing_config') or (table_name='wingo_bets' and column_name in ('return_bps','pricing_version'))");
  assert.equal(columns.rows.length, 5);
  const checks = await memory.query("select conname from pg_constraint where conname in ('network_master_rtp_check','network_rtp_revision_check')");
  assert.equal(checks.rows.length,2);
  console.log(`All ${journal.entries.length} migrations applied in memory; RTP columns and constraints verified.`);
} finally { await memory.close(); }
