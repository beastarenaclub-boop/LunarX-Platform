import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function browserChecks(base:string){
  const shots=resolve('../../tmp/lunar-browser'); await mkdir(shots,{recursive:true});
  const browser=await chromium.launch({headless:true});
  try {
    for(const width of [1440,390]){
      const context=await browser.newContext({viewport:{width,height:900},extraHTTPHeaders:{'x-actor':'other'},reducedMotion:'reduce'});
      const page=await context.newPage(),errors:string[]=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base+'/b2c');
      const tile=page.locator('[data-game-id="lunar"]').filter({visible:true}).first();
      try { await expect(tile).toBeVisible(); } catch(error) {
        await page.screenshot({path:resolve(shots,`failure-${width}.png`)});
        console.log({url:page.url(),errors,body:(await page.locator('body').innerText()).slice(0,2200)});
        throw error;
      }
      await expect(tile).toBeEnabled();
      await expect(tile.locator('img')).toHaveJSProperty('complete',true);
      expect(await tile.locator('img').evaluate((img:{naturalWidth:number})=>img.naturalWidth)).toBeGreaterThan(0);
      await tile.click(); await expect(page).toHaveURL(/\/aviator-pro$/);
      await expect(page.getByTestId('aviator-canvas')).toBeVisible();
      await expect(page.getByTestId('av-bet-panel-0')).toBeVisible();
      await expect(page.getByTestId('av-bet-panel-1')).toBeVisible();
      expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 2')).toBe(true);
      await page.screenshot({path:resolve(shots,`aviator-${width}.png`),fullPage:false});
      // Actual HTTP placement from the kit control, then reload recovery.
      const button=page.getByTestId('btn-bet-0');
      await expect(button).toBeEnabled({timeout:45000});
      await page.getByTestId('btn-tab-auto-0').click();
      const toggle=page.getByTestId('switch-autocash-0');
      if(await toggle.getAttribute('aria-checked')!=='true') await toggle.click();
      const auto=page.getByTestId('input-autocash-0');
      await auto.fill('1.01'); await auto.blur();
      await expect(auto).toHaveValue('1.01');
      const receipt=page.waitForResponse(r=>r.url().endsWith('/api/bets/place')&&r.request().method()==='POST');
      await button.click(); const response=await receipt; expect(response.status()).toBe(200);
      expect(response.request().postDataJSON().autoCashOut).toBe(1.01);
      const bet=await response.json(); expect(bet.gameCode).toBe('lunar');
      await expect(page.getByTestId('bet-accepted-0')).toContainText('Bet placed');
      await expect(auto).toBeDisabled(); await expect(toggle).toBeDisabled();
      await page.reload(); await expect(page.getByTestId('aviator-canvas')).toBeVisible();
      await expect(page.getByTestId('bet-accepted-0').or(page.getByTestId('btn-cashout-0'))).toBeVisible({timeout:15000});
      await page.getByTestId('btn-menu').click();
      await page.getByRole('menuitem',{name:/Provably Fair/i}).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(errors).toEqual([]);
      await context.close();
    }
  } finally {await browser.close();}
}
