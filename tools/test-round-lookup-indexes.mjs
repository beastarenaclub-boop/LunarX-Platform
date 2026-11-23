import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../lib/db/package.json',import.meta.url));
const {PGlite}=require('@electric-sql/pglite');
const db=new PGlite();
const migration=await readFile(new URL('../lib/db/drizzle/0073_round_lookup_indexes.sql',import.meta.url),'utf8');
const maintenance=await readFile(new URL('../lib/db/scripts/round-lookup-indexes.cjs',import.meta.url),'utf8');
const normalize=s=>s.replace(/\s+/g,' ').trim();
const ddl=migration.replace(/--[^\n]*/g,'').split(';').filter(x=>x.trim());
for(const statement of ddl)assert(normalize(maintenance).includes(normalize(statement).replace('CREATE INDEX','CREATE INDEX CONCURRENTLY')),'online and migration index definitions must agree');
try{
 await db.exec(`CREATE TABLE table_rounds (id text PRIMARY KEY, game_code text NOT NULL, client_seed text NOT NULL, phase text NOT NULL, reveal_ends_at timestamptz NOT NULL, settle_ends_at timestamptz NOT NULL, created_at timestamptz NOT NULL, config jsonb NOT NULL);
 CREATE TABLE poker_rounds (id serial PRIMARY KEY, game text NOT NULL, reveals_at timestamptz NOT NULL, settled_at timestamptz);
 CREATE INDEX table_rounds_game_code_idx ON table_rounds(game_code);
 CREATE INDEX poker_round_game ON poker_rounds(game,id);
 INSERT INTO table_rounds SELECT 'hr3-'||n,'horse-racing','stadium','settled',now()-interval '2 days',now()-interval '1 day',now()-interval '3 days','{"version":3}'::jsonb FROM generate_series(1,20000) n;
 INSERT INTO poker_rounds (game,reveals_at,settled_at) SELECT 'poker-one-day',now()-interval '2 days',now()-interval '1 day' FROM generate_series(1,20000);
 INSERT INTO table_rounds VALUES ('hr3-active','horse-racing','stadium','betting',now()-interval '1 second',now()+interval '1 minute',now()-interval '1 minute','{"version":3}'),('crash-active','aviator','test','betting',now()+interval '1 minute',now()+interval '2 minutes',now(),'{"owner":"test-owner"}');
 INSERT INTO poker_rounds (game,reveals_at) VALUES ('poker-one-day',now()-interval '1 second');`);
 await db.exec(migration);await db.exec(migration); // Safe for prebuilt live indexes.
 await db.exec('ANALYZE table_rounds; ANALYZE poker_rounds;');
 const cases=[
  ['poker_round_pending_reveal_idx',`SELECT id FROM poker_rounds WHERE game=$1 AND settled_at IS NULL AND reveals_at<=now() ORDER BY id`,['poker-one-day']],
  ['table_rounds_pending_reveal_idx',`SELECT id FROM table_rounds WHERE game_code=$1 AND phase<>$2 AND reveal_ends_at<=now() AND config->>'version'='3' ORDER BY reveal_ends_at LIMIT 100`,['horse-racing','settled']],
  ['table_rounds_venue_end_idx',`SELECT id FROM table_rounds WHERE game_code=$1 AND client_seed=$2 AND id LIKE $3 AND created_at<=now() AND settle_ends_at>now() ORDER BY created_at DESC LIMIT 1`,['horse-racing','stadium','hr3-%']],
  ['table_rounds_owner_created_idx',`SELECT id FROM table_rounds WHERE game_code=$1 AND config->>'owner'=$2 ORDER BY created_at DESC LIMIT 1`,['aviator','test-owner']],
 ];
 for(const [index,sql,args] of cases){
  const rows=await db.query(sql,args);assert.equal(rows.rows.length,1,index+' returns the active round');
  const plan=await db.query('EXPLAIN (FORMAT JSON) '+sql,args);
  assert(JSON.stringify(plan.rows).includes(index),index+' is selected for the real parameterized query');
  console.log('PASS '+index);
 }
 console.log('PASS 4 round lookup plans and idempotent migration');
}finally{await db.close();}
