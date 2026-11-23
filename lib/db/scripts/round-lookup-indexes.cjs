// Run before deploying migration 0073 to a populated production database.
// This creates only non-unique indexes; it never changes rows or game rules.
const fs = require('node:fs');
const path = require('node:path');
const dbRoot = fs.existsSync('/app/lib/db/package.json') ? '/app/lib/db' : path.resolve(__dirname, '..');
const { Client } = require(require.resolve('pg', { paths: [dbRoot] }));
const definitions = [
  ['poker_round_pending_reveal_idx', `CREATE INDEX CONCURRENTLY IF NOT EXISTS poker_round_pending_reveal_idx ON poker_rounds (game, reveals_at, id) WHERE settled_at IS NULL`],
  ['table_rounds_pending_reveal_idx', `CREATE INDEX CONCURRENTLY IF NOT EXISTS table_rounds_pending_reveal_idx ON table_rounds (game_code, reveal_ends_at) WHERE phase <> 'settled'`],
  ['table_rounds_venue_end_idx', `CREATE INDEX CONCURRENTLY IF NOT EXISTS table_rounds_venue_end_idx ON table_rounds (game_code, client_seed, settle_ends_at)`],
  ['table_rounds_owner_created_idx', `CREATE INDEX CONCURRENTLY IF NOT EXISTS table_rounds_owner_created_idx ON table_rounds (game_code, (config->>'owner'), created_at DESC) WHERE config->>'owner' IS NOT NULL`],
];
const client = new Client({ connectionString: process.env.DATABASE_URL, application_name: 'round-lookup-indexes', statement_timeout: 1800000 });
async function main() {
  await client.connect();
  const lock = await client.query('SELECT pg_try_advisory_lock(73482199) AS acquired');
  if (!lock.rows[0].acquired) throw new Error('Another index maintenance job is running');
  await client.query("SET lock_timeout = '60s'");
  await client.query("SET maintenance_work_mem = '32MB'");
  await client.query('SET max_parallel_maintenance_workers = 0');
  for (const [name, ddl] of definitions) {
    const before = await client.query('SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass($1)', [name]);
    if (before.rows[0]?.indisvalid === false) throw new Error(name + ' is invalid; inspect the interrupted build before retrying');
    const start = Date.now();
    console.log(JSON.stringify({ label: 'index_start', name }));
    await client.query(ddl);
    const check = await client.query('SELECT indisvalid, pg_size_pretty(pg_relation_size(indexrelid)) AS size FROM pg_index WHERE indexrelid = to_regclass($1)', [name]);
    if (!check.rows[0]?.indisvalid) throw new Error(name + ' did not become valid');
    console.log(JSON.stringify({ label: 'index_ready', name, ms: Date.now() - start, ...check.rows[0] }));
  }
  console.log(JSON.stringify({ label: 'complete', indexes: definitions.length }));
}
main().catch(error => { console.error(JSON.stringify({ label: 'failed', message: error.message })); process.exitCode = 1; }).finally(() => client.end());
