import {test,expect,type Page} from "@playwright/test";
async function mock(page:Page){
 let policies=[{gameCode:'jetx',playerRtpBps:3000 as number|null,revision:1},{gameCode:'coin-flip',playerRtpBps:null as number|null,revision:0}];
 const puts:any[]=[];
 await page.route('**/api/game/b2c-rtp**',async route=>{
  if(route.request().method()==='PUT'){
   const body=route.request().postDataJSON(), code=new URL(route.request().url()).pathname.split('/').at(-1)!;
   puts.push({code,body});
   if(route.request().headers()['x-confirm-password']!=='test-confirmation')return route.fulfill({status:403,json:{detail:'Invalid confirmation password'}});
   const policy=policies.find(p=>p.gameCode===code)!;
   if(body.revision!==policy.revision)return route.fulfill({status:409,json:{detail:'B2C RTP changed. Reload policy.'}});
   Object.assign(policy,{playerRtpBps:body.playerRtpBps,revision:policy.revision+1});
   return route.fulfill({json:policy});
  }
  return route.fulfill({json:{policies}});
 });
 return {puts,change:(bps:number)=>{policies[0]={...policies[0],playerRtpBps:bps,revision:policies[0].revision+1};}};
}
const fillPassword=(page:Page)=>page.getByLabel('Confirm admin password').fill('test-confirmation');
test('B2C 30 to 5 percent persists across Save, Reload and page reload on mobile',async({page},info)=>{
 const server=await mock(page);await page.setViewportSize({width:390,height:844});await page.goto('/tests/b2c-rtp-panel.html');
 await expect(page.getByLabel('B2C player RTP')).toHaveValue('30');
 await page.getByLabel('B2C player RTP').fill('5');await fillPassword(page);await page.getByRole('button',{name:'Save RTP',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Saved player RTP: 5.00%');
 expect(server.puts).toEqual([{code:'jetx',body:{playerRtpBps:500,revision:1}}]);
 await expect(page.getByTestId('b2c-saved-rtp')).toContainText('5.00% / theoretical house edge 95.00%');
 await expect(page.getByLabel('Confirm admin password')).toHaveValue('');
 await page.screenshot({path:info.outputPath('b2c-saved-five.png'),fullPage:true});
 await page.getByRole('button',{name:'Reload policy',exact:true}).click();await expect(page.getByLabel('B2C player RTP')).toHaveValue('5');
 await page.reload();await expect(page.getByLabel('B2C player RTP')).toHaveValue('5');
 await page.getByLabel('B2C game').selectOption('coin-flip');await expect(page.getByTestId('b2c-saved-rtp')).toContainText('Original game rules');
});
test('fixed game supports custom RTP and restoring its original rules',async({page})=>{
 const server=await mock(page);await page.goto('/tests/b2c-rtp-panel.html');await page.getByLabel('B2C game').selectOption('coin-flip');
 await page.getByLabel('B2C RTP policy').selectOption('custom');await page.getByLabel('B2C player RTP').fill('82.5');await fillPassword(page);await page.getByRole('button',{name:'Save RTP',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('82.50%');
 await page.getByLabel('B2C RTP policy').selectOption('original');await fillPassword(page);await page.getByRole('button',{name:'Save RTP',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Saved original game rules');
 expect(server.puts.at(-1)).toEqual({code:'coin-flip',body:{playerRtpBps:null,revision:1}});
});
test('Reload resets unsaved edits; other admin edits cannot silently replace a draft',async({page})=>{
 const server=await mock(page);await page.goto('/tests/b2c-rtp-panel.html');await page.getByLabel('B2C player RTP').fill('5');
 await page.getByRole('button',{name:'Reload policy',exact:true}).click();await expect(page.getByLabel('B2C player RTP')).toHaveValue('30');
 server.change(8500);await expect(page.getByLabel('B2C player RTP')).toHaveValue('85',{timeout:12000});
 await page.getByLabel('B2C player RTP').fill('50');server.change(7500);
 await expect(page.getByRole('alert')).toContainText('changed in another panel',{timeout:12000});await expect(page.getByLabel('B2C player RTP')).toHaveValue('50');
 await fillPassword(page);await expect(page.getByRole('button',{name:'Save RTP',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Reload policy',exact:true}).click();await expect(page.getByLabel('B2C player RTP')).toHaveValue('75');
});
test('failed password confirmation leaves the saved policy unchanged',async({page})=>{
 await mock(page);await page.goto('/tests/b2c-rtp-panel.html');await page.getByLabel('B2C player RTP').fill('5');await page.getByLabel('Confirm admin password').fill('wrong');
 await page.getByRole('button',{name:'Save RTP',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Invalid confirmation password');
 await expect(page.getByTestId('b2c-saved-rtp')).toContainText('30.00%');await expect(page.getByRole('status')).toHaveCount(0);
});
