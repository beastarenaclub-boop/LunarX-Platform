import {chromium,expect} from '../../artifacts/3d-game/node_modules/@playwright/test/index.mjs';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1050}});
 await page.route('**/api/virtual-sports/state',async route=>{
  const response=await route.fetch(),s=await response.json(),now=Date.now();
  const hold=r=>({...r,phase:'betting',starts:now-5000,closes:now+15000,ends:now+60000,next:now+70000,events:[],score:[0,0],winner:null});
  s.serverTime=now;s.rounds=s.rounds.map(hold);s.matches=s.matches?.map(hold);await route.fulfill({response,json:s});
 });
 await page.goto('http://127.0.0.1:5199');const scene=page.getByTestId('sports-scene');await expect(scene).toHaveAttribute('data-ready','true',{timeout:180000});
 await page.getByRole('combobox',{name:'Graphics quality'}).selectOption('high');
 for(const [sport,angle] of [['Football','35'],['Cricket','145']]){
  await page.getByRole('tab',{name:new RegExp(sport)}).click();await expect(scene).toHaveAttribute('data-ready','true');
  await page.getByRole('combobox',{name:'Player to follow'}).selectOption('0');
  await page.getByRole('slider',{name:'Camera zoom'}).fill('1.6');await page.getByRole('slider',{name:'Camera angle'}).fill(angle);
  await page.waitForTimeout(3000);await scene.screenshot({path:`tmp/unity-sports/review/human-${sport.toLowerCase()}.png`});
 }
 console.log('Actual Unity human portraits captured for football and cricket.');
}finally{await browser.close();}
