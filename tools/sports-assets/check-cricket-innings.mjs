import {chromium,expect} from '../../artifacts/3d-game/node_modules/@playwright/test/index.mjs';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 const page=await browser.newPage();
 // UI boundary check only; real kit changes are captured by review-unity.mjs.
 await page.route('**/unity-sports/index.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>UI fixture</title>'}));
 await page.route('**/api/virtual-sports/state',async route=>{
  const response=await route.fetch(),state=await response.json(),now=Date.now();
  const innings=r=>({...r,phase:'live',closes:now-23000,ends:now+22000,events:Array.from({length:6},(_,i)=>({at:3500*(i+1),team:0,points:0,kind:'delivery',text:'Dot ball',score:[0,0]})),score:[0,0],winner:null});
  state.matches=state.matches.map(innings);state.rounds=state.rounds.map(innings);state.serverTime=now;
  await route.fulfill({response,json:state});
 });
 await page.goto('http://127.0.0.1:5199/?sport=cricket');
 await expect(page.getByRole('combobox',{name:'Choose match'})).toHaveValue('india-pakistan');
 await page.getByRole('combobox',{name:'Player to follow'}).selectOption('0');
 await expect(page.locator('.vs-player-caption')).toContainText('Pakistan');
 await expect(page.locator('.vs-match-clock')).toHaveText('2nd innings');
 await page.getByRole('combobox',{name:'Player to follow'}).selectOption('2');
 await expect(page.locator('.vs-player-caption')).toContainText('India');
 console.log('Cricket innings break: batting/fielding roster labels and scoreboard agree after the sixth delivery.');
}finally{await browser.close();}
