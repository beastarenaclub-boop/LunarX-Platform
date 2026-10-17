// Read-only browser benchmark. All account/race endpoints are locally mocked.
const fs = require('node:fs/promises');
const { chromium } = require('../../artifacts/3d-game/node_modules/@playwright/test');
// Node 22.18+ can load the shared TypeScript contract directly.
const { makeHorsePlan, HORSE_RACE_SPEED, RACING_HORSES, horseOdds } = require('../../lib/api-zod/src/horse-racing-game.ts');
const origin = process.env.HORSE_GAME_URL || 'http://127.0.0.1:5174/horse-racing';
const label = process.env.BENCH_LABEL || 'baseline';
(async () => {
  const config = { enabled: true, raceSpeed: HORSE_RACE_SPEED, minStakePaise: '100', maxStakePaise: '50000000', horses: RACING_HORSES.map(h => ({ id: h.id, multiplier: horseOdds(h.probability, .03) })) };
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const results = [];
  try {
    for (const phone of [false, true]) {
      const page = await browser.newPage({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, deviceScaleFactor: phone ? 2 : 1 });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.routeWebSocket('**/ws', ws => ws.onMessage(() => {}));
      await page.addInitScript(() => {
        localStorage.setItem('aviator:v1', JSON.stringify({ settings: { onboarded: true, sound: false } }));
        localStorage.setItem('horse-racing:camera:v2', 'rail');
        window.raceBench = { active: false, frames: [], callbacks: [] };
        const targets = new WeakMap();
        const proto = WebGL2RenderingContext.prototype;
        const bind = proto.bindFramebuffer, clear = proto.clear;
        proto.bindFramebuffer = function(target, buffer) {
          if (target === this.FRAMEBUFFER || target === this.DRAW_FRAMEBUFFER) targets.set(this, buffer);
          return bind.call(this, target, buffer);
        };
        proto.clear = function(mask) {
          if (window.raceBench.active && !targets.get(this) && this.canvas.dataset.testid === 'horse-race-canvas') window.raceBench.frames.push(performance.now());
          return clear.call(this, mask);
        };
        const raf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = callback => raf(time => {
          const start = performance.now();
          callback(time);
          const ms = performance.now() - start;
          if (window.raceBench.active && ms > 1) window.raceBench.callbacks.push(ms);
        });
      });
      // A constant server start time advances naturally during each measurement.
      let startedAt = Date.now();
      await page.route('**/api/**', route => {
        if (route.request().method() !== 'GET') throw Error('Benchmark attempted a write');
        const url = new URL(route.request().url()), now = Date.now();
        let body = {};
        if (url.pathname === '/api/auth/me') body = { id: 'performance-review', displayName: 'Racer', role: 'player' };
        else if (url.pathname.endsWith('/horse-racing/game/config')) body = config;
        else if (url.pathname.endsWith('/horse-racing/game/live')) {
          const venueId = url.searchParams.get('venueId') || 'royal', plan = makeHorsePlan('stadium-review', venueId, HORSE_RACE_SPEED);
          body = { serverNow: now, balance: '0', myBet: null, history: [], race: { id: 'benchmark', venueId, phase: 'racing', startedAt, bettingOpensAt: startedAt - 20000, endsAt: startedAt + plan.duration * 1000, nextRoundAt: startedAt + (plan.duration + 5) * 1000, config, plan, winnerId: null, serverSeedHash: 'preview' } };
        } else if (url.pathname.includes('/wallet/')) body = { balance: '0', currency: 'INR', scope: 'lunar' };
        else if (url.pathname === '/api/game/registry') body = [];
        return route.fulfill({ json: body });
      });
      await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const canvas = page.getByTestId('horse-race-canvas');
      await canvas.waitFor();
      await page.waitForFunction(() => document.querySelector('canvas[data-renderer="webgl-3d"]'), null, { timeout: 60000 });
      for (const [mode, button] of [['rail', 'Rail-side'], ['closeup', 'Close-up']]) {
        startedAt = Date.now() - 2000;
        await page.getByRole('button', { name: button + ' camera', exact: true }).click();
        await page.waitForTimeout(3500);
        // Restart after shader warmup so the complete sample contains racing.
        startedAt = Date.now() - 2000;
        await page.waitForTimeout(1500);
        await page.evaluate(() => { window.raceBench.frames = []; window.raceBench.callbacks = []; window.raceBench.active = true; });
        await page.waitForTimeout(8000);
        const metrics = await canvas.evaluate(c => {
          window.raceBench.active = false;
          const b = window.raceBench;
          const intervals = b.frames.slice(1).map((t, i) => t - b.frames[i]).sort((a, b) => a - b);
          const percentile = (list, fraction) => +(list[Math.floor((list.length - 1) * fraction)] || 0).toFixed(2);
          const gl = c.getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info');
          return { frames: b.frames.length, fps: +((b.frames.length - 1) * 1000 / (b.frames.at(-1) - b.frames[0])).toFixed(1), frameMedianMs: percentile(intervals, .5), frameP95Ms: percentile(intervals, .95), callbackP95Ms: percentile(b.callbacks.sort((a, b) => a - b), .95), slowFrames: intervals.filter(n => n > 50).length, gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown', data: { ...c.dataset } };
        });
        await page.getByTestId('horse-race-stage').screenshot({ path: `test-results/horse-${label}-${phone ? 'mobile' : 'desktop'}-${mode}.png` });
        results.push({ device: phone ? 'mobile' : 'desktop', mode, ...metrics, errors });
        console.log(JSON.stringify(results.at(-1)));
      }
      await page.close();
    }
    await fs.writeFile(`test-results/horse-${label}-performance.json`, JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
