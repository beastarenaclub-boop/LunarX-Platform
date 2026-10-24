import { test, expect } from '@playwright/test';
import { mockResponsiveGame } from './fixtures/responsive-game-data';

const games = {
  'roulette': '.roulette-phone-numbers, .roulette-bet-dock-controls',
  'lucky-7': '.live-bet-spots, .live-bet-actions, .live-bet-coins',
  'lucky-7-live': '.l7-main-bets, .l7-side-bets, .l7-confirm, .l7-chip-rack',
  'andar-bahar': '[data-game-bet], .andar-side-bets, .game-bottom-bar',
  'andar-bahar-live': '.ab-main-spots, .ab-range-spots, .ab-confirm, .ab-chips',
  'teen-patti': '[data-game-bet], .game-bottom-bar',
  'teen-patti-live': '.live-bet-spots, .live-bet-actions, .live-bet-coins',
  'dragon-tiger': '.dt-betting-dock',
  'dragon-tiger-one-day': '.od-match-grid, .od-betting-dock',
  'baccarat': '[data-game-bet], .bc-actions',
  'wheel-2-live': '.w20-bet, .w20-chips, .w20-confirm',
};

for (const [game, selector] of Object.entries(games)) test(`${game}: table and betting dock fit together on phones`, async ({ page }, info) => {
  const cleanup = await mockResponsiveGame(page, game);
  await page.route('**/api/network/website', r => r.fulfill({ json: null }));
  await page.route('**/api/**/history', r => r.fulfill({ json: [] }));
  if (game === 'baccarat') await page.route('**/api/baccarat/config', r => r.fulfill({ json: { enabled: true, decks: 8, maxMultiplier: 12, minStakePaise: '100', maxStakePaise: '50000000', maxBetsPerDeal: 5, payouts: { player: 1.8, banker: 1.75, tie: 8.56, playerPair: 10.91, bankerPair: 10.91 } } }));
  if (game === 'andar-bahar-live') await page.route('**/api/andar-bahar/config', r => r.fulfill({ json: { enabled: true, maxBetsPerDeal: 10, maxMultiplier: 100, maxStakePaise: '50000000', payouts: { firstSide: 1.65, secondSide: 1.75, ranges: {} } } }));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${game}`);
    await expect(page.locator(selector).filter({ visible: true }).first()).toBeVisible();
    for (const [width, height] of [[390, 844], [360, 640], [320, 568], [844, 390]]) {
      await page.setViewportSize({ width, height });
      const frame = page.locator('[data-game-viewport]');
      await expect.poll(() => frame.evaluate(el => el.clientHeight)).toBe(height);
      await frame.evaluate(el => { el.scrollTop = 0; });
      await page.screenshot({ path: info.outputPath(`${width}x${height}.png`) });
      const clipped = await page.locator(selector).evaluateAll(nodes => nodes.flatMap(el => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return [];
        return r.top < -1 || r.bottom > innerHeight + 1 || r.left < -1 || r.right > innerWidth + 1
          ? [{ element: el.getAttribute('data-testid') || el.className, top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }] : [];
      }));
      expect.soft(clipped, `${game} controls clipped at ${width}x${height}`).toEqual([]);
      expect.soft(await frame.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      const covered = await page.locator('[data-game-bet], .roulette-phone-choice, .l7-spot, .ab-main-spots button, .ab-range-spots button, .od-match-bet, .dt-bet-spots button, .live-bet-spots button, .w20-bet').evaluateAll(nodes => nodes.flatMap(el => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || (el as HTMLButtonElement).disabled) return [];
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return el.contains(hit) ? [] : [{ button: el.getAttribute('data-testid') || el.textContent?.trim(), coveredBy: hit?.className }];
      }));
      expect.soft(covered, `${game} bet buttons covered at ${width}x${height}`).toEqual([]);
      if (game === 'teen-patti') {
        const status = page.getByTestId('round-phase-banner');
        expect.soft(await status.evaluate(el => {
          const r = el.getBoundingClientRect();
          return el.contains(document.elementFromPoint(r.x + r.width / 2, r.bottom - 2));
        }), `Round status covered at ${width}x${height}`).toBe(true);
      }
      if (game === 'roulette') {
        await expect(page.locator('.roulette-phone-numbers button')).toHaveCount(37);
        for (const number of [0, 1, 18, 36]) {
          const cell = page.getByTestId(`mobile-cell-${number}`);
          const box = (await cell.boundingBox())!;
          expect.soft(box.width).toBeGreaterThanOrEqual(28);
          expect.soft(await cell.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
        }
      }
    }
    expect(errors).toEqual([]);
  } finally { cleanup(); }
});

test('roulette: phone tabs stage each bet type and preserve bets on desktop', async ({ page }) => {
  const cleanup = await mockResponsiveGame(page, 'roulette');
  await page.route('**/api/network/website', r => r.fulfill({ json: null }));
  await page.route('**/api/**/history', r => r.fulfill({ json: [] }));
  try {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/roulette');
    await page.locator('[data-game-coin]').first().click();
    const choices = [
      ['Numbers', 'cell-0', 'straight:0'],
      ['Numbers', 'cell-36', 'straight:36'],
      ['Outside', 'outside-red', 'red'],
      ['Outside', 'dozen-3', 'dozen:3'],
      ['Outside', 'column-2', 'column:2'],
      ['split', 'split-0-1', 'split:0-1'],
      ['street', 'street-1-2-3', 'street:1-2-3'],
      ['corner', 'corner-1-2-4-5', 'corner:1-2-4-5'],
      ['line', 'line-31-32-33-34-35-36', 'line:31-32-33-34-35-36'],
    ];
    for (const [tab, id, key] of choices) {
      if (['Numbers', 'Outside'].includes(tab)) {
        await page.getByRole('button', { name: tab, exact: true }).click();
      } else {
        await page.getByRole('button', { name: 'Combinations', exact: true }).click();
        await page.getByLabel('Combination bet type').selectOption(tab);
      }
      await page.getByTestId(`mobile-${id}`).click();
      await expect(page.getByTestId(`mobile-${id}`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId(`roulette-staged-${key}`)).toHaveCount(1);
    }
    await expect(page.locator('.roulette-selected-bets > span')).toHaveCount(choices.length);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('.roulette-phone-board')).toBeHidden();
    await expect(page.getByTestId('cell-36')).toBeVisible();
    await expect(page.getByTestId('roulette-staged-straight:36')).toHaveCount(1);
  } finally { cleanup(); }
});
