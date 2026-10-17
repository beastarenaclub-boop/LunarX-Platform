import { expect, test } from '@playwright/test';
import type { TableSnapshot } from '../src/components/dragonTiger/useDragonTiger';

for (const viewport of [{ width: 320, height: 568 }, { width: 1440, height: 900 }]) {
  for (const winner of ['dragon', 'tie'] as const) {
    test(`${winner} rates and exact winning receipt at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(() => localStorage.setItem('aviator:v1', JSON.stringify({ settings: { onboarded: true, sound: false } })));
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.routeWebSocket('**/ws', ws => ws.onMessage(() => {}));
      const now = Date.now();
      const stake = 130;
      const payout = winner === 'dragon' ? 257.4 : 1690;
      const snapshot: TableSnapshot = {
        serverNow: now, mode: 'wallet', online: 1,
        round: { id: 9001, phase: 'betting', closesAt: now + 60000, revealsAt: now + 63000, endsAt: now + 69000,
          mainProfitPaisePerRupee: 98, tieProfitPaisePerRupee: 1200 },
        player: { balance: 1000, net: 0, wins: 0, played: 0, rank: null },
        myBet: null, lastResult: null, leaderboard: [], history: [],
      };
      await page.route('**/api/**', async route => {
        expect(route.request().method()).toBe('GET');
        const path = new URL(route.request().url()).pathname;
        let body: unknown = {};
        if (path === '/api/dragon-tiger/table') body = { ...snapshot, serverNow: Date.now() };
        else if (path === '/api/auth/me') body = { id: 'payout-test', displayName: 'You', email: 'payout@example.test', role: 'player' };
        else if (path.includes('/registry')) body = [];
        else if (path.includes('/config')) body = { enabled: false };
        await route.fulfill({ json: body });
      });
      await page.goto('/dragon-tiger', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('dt-bet-dragon')).toContainText('0.98:1');
      await expect(page.getByTestId('dt-bet-tiger')).toContainText('0.98:1');
      await expect(page.getByTestId('dt-bet-tie')).toContainText('12:1');
      snapshot.round = { ...snapshot.round, phase: 'result', winner, dragon: 12, tiger: winner === 'tie' ? 25 : 0 };
      snapshot.myBet = { spots: { dragon: 0, tiger: 0, tie: 0, [winner]: stake }, stake, payout };
      snapshot.lastResult = { roundId: snapshot.round.id, stake, payout };
      snapshot.player = { balance: 1000 - stake + payout, net: Math.round((payout - stake) * 100) / 100, played: 1, wins: 1, rank: 1 };
      snapshot.leaderboard = [{ userId: 'payout-test', name: 'You', net: snapshot.player.net, played: 1, wins: 1, rank: 1 }];
      const popup = page.getByTestId('round-win-dialog');
      await expect(popup).toBeVisible();
      await expect(page.getByTestId('round-win-profit')).toHaveText(winner === 'dragon' ? '+₹127.40' : '+₹1,560.00');
      await expect(page.getByTestId('round-win-payout')).toHaveText(winner === 'dragon' ? '₹257.40' : '₹1,690.00');
      const box = await popup.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
      expect(errors).toEqual([]);
      await page.close();
    });
  }
}
