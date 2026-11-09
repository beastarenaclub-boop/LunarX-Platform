import {test,expect,type Page} from "@playwright/test";
async function mock(page:Page,admin=true){
 const requests:{path:string;body:any}[]=[];let reserved=false,distributed=false;
 await page.route('**/api/network/bank-floor**',async route=>{
  const p=new URL(route.request().url()).pathname;
  if(route.request().method()==='POST'){
   requests.push({path:p,body:route.request().postDataJSON()});if(p.endsWith('/reserve'))reserved=true;if(p.endsWith('/distribute'))distributed=true;
   return route.fulfill({json:{id:'entry',kind:p.split('/').at(-1)}});
  }
  if(p.endsWith('/preview'))return route.fulfill({json:{amountPaise:'10000000',cutoffAt:new Date().toISOString(),previewHash:'a'.repeat(64),recipientCount:2,eligibleCount:2,totalStakePaise:'50000000',recipients:[{userId:'p1',name:'Player One',stakePaise:'12500000',amountPaise:'2500000'},{userId:'p2',name:'Player Two',stakePaise:'37500000',amountPaise:'7500000'}]}});
  if(p.endsWith('/bank-floor'))return route.fulfill({json:{canDistribute:admin,masters:[{id:'master-a',name:'Master A'}]}});
  return route.fulfill({json:{master:{id:'master-a',name:'Master A',playerRtpBps:7000},canDistribute:admin,totals:{settledStakePaise:'50000000',playerPayoutPaise:'25000000',branchProfitPaise:'25000000',masterEarnedPaise:'20000000',availableProfitPaise:reserved?'10000000':'20000000',bankBalancePaise:reserved&&!distributed?'10000000':'0',distributedPaise:distributed?'10000000':'0',actualMarginPercent:'50.00',unallocatedProfitPaise:'10000000'},history:[]}});
 });return requests;
}
test('admin reserves actual profit, reviews proportional amounts, then distributes once',async({page},info)=>{
 const requests=await mock(page);await page.goto('/tests/bank-floor-panel.html');
 await page.getByLabel('Reserve profit amount').fill('100000');await page.getByRole('button',{name:'Add to bank floor',exact:true}).click();
 await expect(page.getByText('Profit reserved in the bank floor.',{exact:true})).toBeVisible();expect(requests[0].body.amountPaise).toBe('10000000');
 await page.getByLabel('Distribution amount').fill('100000');await page.getByRole('button',{name:'Preview distribution',exact:true}).click();
 await expect(page.getByRole('region',{name:'Distribution preview'})).toContainText('₹1,00,000.00');
 await expect(page.getByRole('row').filter({hasText:'Player One'})).toContainText('₹25,000.00');await expect(page.getByRole('row').filter({hasText:'Player Two'})).toContainText('₹75,000.00');
 expect(requests.filter(r=>r.path.endsWith('/distribute')).length).toBe(0);
 await page.screenshot({path:info.outputPath('admin-preview.png'),fullPage:true});
 await page.getByRole('button',{name:'Distribute ₹1,00,000.00 now',exact:true}).click();
 await expect(page.getByText('Profit bonuses credited.',{exact:false})).toBeVisible();
 const sent=requests.filter(r=>r.path.endsWith('/distribute'));expect(sent).toHaveLength(1);expect(sent[0].body.previewHash).toBe('a'.repeat(64));expect(sent[0].body.amountPaise).toBe('10000000');
});
test('master can see only balances with no distribution controls',async({page},info)=>{
 const requests=await mock(page,false);await page.setViewportSize({width:390,height:844});await page.goto('/tests/bank-floor-panel.html');
 await expect(page.getByText('View only.',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Add to bank floor',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Preview distribution',exact:true})).toHaveCount(0);expect(requests).toHaveLength(0);
 await page.screenshot({path:info.outputPath('master-view.png'),fullPage:true});
});
test('unknown network result retries the same request instead of paying twice',async({page})=>{
 const requests=await mock(page);let calls=0;const ids:string[]=[];
 await page.route('**/api/network/bank-floor/master-a/reserve',async route=>{calls++;ids.push(route.request().postDataJSON().requestId);if(calls===1)return route.abort();return route.fulfill({json:{id:'same-entry'}});});
 await page.goto('/tests/bank-floor-panel.html');await page.getByLabel('Reserve profit amount').fill('1000');await page.getByRole('button',{name:'Add to bank floor',exact:true}).click();
 await expect(page.getByRole('button',{name:'Check / retry last request',exact:true})).toBeVisible();await page.reload();await page.getByRole('button',{name:'Check / retry last request',exact:true}).click();
 await expect(page.getByText('Profit reserved in the bank floor.',{exact:true})).toBeVisible();expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);expect(requests).toHaveLength(0);
});
