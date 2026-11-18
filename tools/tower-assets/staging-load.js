// k6 run -e BASE_URL=http://127.0.0.1:5200 -e ACCOUNTS_FILE=./test-accounts.json -e VUS=10 tools/tower-assets/staging-load.js
// Fixture: [{"sid":"disposable-staging-session"}, ...], one account per VU.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import crypto from 'k6/crypto';
import exec from 'k6/execution';

const base = (__ENV.BASE_URL || '').replace(/\/$/, '');
const host = base.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
if (!/^https?:\/\//.test(base) || /(^|\.)(crypto777\.in|lunarx\.live|lunarx-web\.onrender\.com)$/.test(host)) throw new Error('Use an isolated staging target, never the live player domains');
if (!['localhost','127.0.0.1'].includes(host) && host !== __ENV.STAGING_HOST) throw new Error('Explicit STAGING_HOST confirmation is required');
if (!__ENV.ACCOUNTS_FILE) throw new Error('Supply disposable staging accounts; no real customer sessions');
const accounts = new SharedArray('accounts', () => JSON.parse(open(__ENV.ACCOUNTS_FILE)));
const vus = Number(__ENV.VUS || 10);
if (!Number.isInteger(vus) || vus > accounts.length || vus < 1 || vus > 500) throw new Error('Provide one unique account per VU; this controlled stage is limited to 500 VUs');
const sessions = Array.from(accounts, a => a.sid);
if (sessions.some(s => typeof s !== 'string' || !s || /[;\r\n]/.test(s)) || new Set(sessions).size !== sessions.length) throw new Error('Accounts require distinct valid staging sessions');
export const options = {
  scenarios: { tower: { executor:'ramping-vus', startVUs:1, stages:[{duration:'30s',target:vus},{duration:__ENV.HOLD || '2m',target:vus},{duration:'20s',target:0}], gracefulRampDown:'30s' } },
  thresholds: { http_req_failed:['rate<0.01'], http_req_duration:['p(95)<500','p(99)<1500'] },
};
let round = null, pending = null;
function uuid() {
  const bytes = new Uint8Array(crypto.randomBytes(16)); bytes[6]=(bytes[6]&15)|64; bytes[8]=(bytes[8]&63)|128;
  const hex = Array.from(bytes, b=>b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export default function () {
  const account = accounts[__VU-1];
  const params = {headers:{'Content-Type':'application/json',Origin:base,Cookie:`sid=${account.sid}`},timeout:'15s',tags:{game:'tower-rush'}};
  if (!pending) {
    pending = !round || round.status !== 'active'
      ? {path:'/api/instant/tower-rush/place',body:{towerPayoutVersion:2,requestId:uuid(),stakeAmount:__ENV.STAKE_PAISE || '100',clientSeed:uuid().replace(/-/g,''),options:{difficulty:'easy',mines:3,choice:'heads'}}}
      : {path:`/api/instant/tower-rush/${round.id}/move`,body:{action:round.step >= 3 ? 'cashout':'reveal',expectedStep:round.step,cell:0,actionId:uuid()}};
  }
  const response = http.post(base+pending.path,JSON.stringify(pending.body),params);
  const accepted = check(response, {'accepted idempotent action':r=>r.status===200});
  if (accepted) { round=response.json(); pending=null; }
  else if (response.status===409) {
    const recovered=http.get(base+'/api/instant/tower-rush/state',params);
    if (recovered.status===200) { const state=recovered.json(); round=state.round || state.history[0] || null; pending=null; }
  } else if (response.status>=400 && response.status<500 && ![408,429].includes(response.status)) {
    exec.test.abort(`Staging fixture rejected: HTTP ${response.status}; stop instead of creating more bets`);
  }
  // Ambiguous network/5xx replies retain the exact request/action ID for retry.
  sleep(Number(__ENV.THINK_SECONDS || 3));
}
