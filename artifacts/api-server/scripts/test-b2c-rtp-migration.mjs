import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const base=new URL("../../../lib/db/drizzle/",import.meta.url);
const journal=JSON.parse(await readFile(new URL("meta/_journal.json",base),"utf8"));
const memory=new PGlite();
try {
 for(const entry of journal.entries)await memory.exec(await readFile(new URL(`${entry.tag}.sql`,base),"utf8"));
 assert.equal((await memory.query('SELECT * FROM b2c_rtp_policies')).rows.length,0,'migration does not change live RTP');
 await memory.exec("INSERT INTO b2c_rtp_policies (game_code) VALUES ('mines')");
 const row=(await memory.query("SELECT * FROM b2c_rtp_policies WHERE game_code='mines'")).rows[0];assert.equal(row.player_rtp_bps,null);assert.equal(row.revision,0);
 for(const sql of ["UPDATE b2c_rtp_policies SET player_rtp_bps=0","UPDATE b2c_rtp_policies SET player_rtp_bps=10001","UPDATE b2c_rtp_policies SET revision=-1"])await assert.rejects(memory.exec(sql));
 console.log(`All ${journal.entries.length} migrations applied; B2C defaults and RTP constraints verified.`);
} finally {await memory.close();}
