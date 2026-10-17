import {chromium} from '../../artifacts/3d-game/node_modules/@playwright/test/index.mjs';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 const page=await browser.newPage({acceptDownloads:true});
 await page.goto('https://literock-studios.itch.io/warhorse-lite');
 await page.getByRole('link',{name:'Download Now',exact:true}).first().click();
 await page.getByText('No thanks, just take me to the downloads').click();
 await page.waitForLoadState();
 console.log(await page.locator('body').innerText());
 const download=page.waitForEvent('download',{timeout:60000});
 await page.getByRole('link',{name:'Download',exact:true}).first().click();
 const file=await download;await file.saveAs('.cache/horse-realism-v3/warhorse.zip');
 console.log('DOWNLOADED',file.suggestedFilename());
}finally{await browser.close()}
