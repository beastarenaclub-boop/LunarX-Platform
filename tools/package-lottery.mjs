import { mkdirSync, cpSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const releaseName=process.argv[2]??'lottodesk-complete-2026-10-02';
if(!/^[a-z0-9-]+$/.test(releaseName))throw new Error('Release name must contain only lowercase letters, digits and hyphens.');
const destination=path.join(root,'exports',releaseName);
const app=path.join(root,'artifacts/3d-game');
if(!existsSync(path.join(app,'dist/lottery/index.html')))throw new Error('Run npm run lottery:build before packaging.');
const copy=(from,to)=>{mkdirSync(path.dirname(path.join(destination,to)),{recursive:true});cpSync(path.join(root,from),path.join(destination,to),{recursive:true});};
const write=(name,value)=>{mkdirSync(path.dirname(path.join(destination,name)),{recursive:true});writeFileSync(path.join(destination,name),value);};
copy('artifacts/3d-game/dist/lottery','dist/lottery');
copy('artifacts/3d-game/lottery-server/server.mjs','lottery-server/server.mjs');
copy('artifacts/3d-game/lottery-server/store.mjs','lottery-server/store.mjs');
copy('artifacts/3d-game/lottery-server/tests/store.test.mjs','lottery-server/tests/store.test.mjs');
copy('artifacts/3d-game/lottery-server/tests/http.test.mjs','lottery-server/tests/http.test.mjs');
copy('artifacts/3d-game/lottery/src','source/src');
copy('artifacts/3d-game/lottery/public','source/public');
copy('artifacts/3d-game/lottery/index.html','source/index.html');
copy('docs/lottery-lottodesk.md','docs/implementation.md');
for(const name of ['01-login-desktop.png','02-shop-terminal-desktop.png','03-admin-overview.png','04-agent-shops.png','06-shop-mobile.png','09-user-login-mobile.png','12-nice-paper-tickets-desktop.png','13-nice-paper-tickets-mobile.png','14-distinct-series-results.png','15-user-home-results-desktop.png','16-user-home-results-mobile.png','17-user-banknote-tickets.png','18-shop-banknote-tickets.png','19-user-desktop-fit.png','20-shop-desktop-fit.png','shop-receipt.pdf']){
  if(existsSync(path.join(root,'tmp/lottery-review',name)))copy(`tmp/lottery-review/${name}`,`preview/${name}`);
}
write('package.json',JSON.stringify({name:'lottodesk',version:'1.0.0',private:true,type:'module',engines:{node:'>=24'},scripts:{start:'node lottery-server/server.mjs',test:'node --test lottery-server/tests/*.test.mjs'}},null,2)+'\n');
write('source/package.json',JSON.stringify({name:'lottodesk-ui',version:'1.0.0',private:true,type:'module',scripts:{build:'vite build',dev:'vite',typecheck:'tsc --noEmit'},dependencies:{react:'19.1.0','react-dom':'19.1.0','lucide-react':'0.545.0','qrcode.react':'4.2.0'},devDependencies:{vite:'7.3.2','@vitejs/plugin-react':'5.0.4',typescript:'~5.9.2','@types/react':'19.2.14','@types/react-dom':'19.2.0','@types/node':'25.3.3'}},null,2)+'\n');
write('source/tsconfig.json',JSON.stringify({compilerOptions:{noEmit:true,jsx:'react-jsx',target:'ES2022',module:'ESNext',moduleResolution:'bundler',lib:['ESNext','DOM','DOM.Iterable'],types:['vite/client'],strict:true,skipLibCheck:true},include:['src']},null,2)+'\n');
write('source/vite.config.ts',"import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({plugins:[react()],build:{outDir:'../dist/lottery',emptyOutDir:true},server:{host:'127.0.0.1',port:5191,proxy:{'/api/lottery':'http://127.0.0.1:5190'}}});\n");
write('Start-LottoDesk.cmd','@echo off\r\ncd /d "%~dp0"\r\nnode lottery-server\\server.mjs\r\npause\r\n');
write('.gitignore','data/\nsource/node_modules/\n');
write('README.md',`# LottoDesk — complete local application

Four separate portals, one persistent lottery workspace. A light, colourful UI with emerald User, blue Admin, purple Agent and teal Shop accents, 2D/3D/Titli, shop receipts, automatic draws, claims, accounts, commission, reports and support. User and Shop have NICE10–NICE19 coloured paper ticket selectors above the numbers in two rows of five, with horizontal scrolling on mobile. Each card shows its fixed price and has its own distinct colour, matching across panels and results. The User panel has easy Hinglish instructions, direct number entry, All/Even/Odd selection, 25-number groups, quantity buttons and a fixed mobile bet button. Monetary amounts across panels and monochrome receipts are in INR.

User and Shop ticket cards now have a banknote-inspired paper finish: subtle fibre texture, fine engraved borders, rosette artwork, NICE watermark medallions, serial-style series labels and perforated price stubs. Desktop User and Shop workspaces fit results, two rows of tickets, number selection and a visible right-side checkout onto the screen. Long selection details scroll inside their panel; mobile keeps its separate responsive layout.

Latest completed draw results also appear directly on the User main page: all ten series, matching colours, date/time, independent 2D/3D/Titli result tabs and a link to full history. They update automatically without changing the customer's current bet.

## Start

1. Install Node.js 24 or newer.
2. Open this folder and run **npm start**, or double-click **Start-LottoDesk.cmd** on Windows.
3. Open **http://localhost:5190**.

No npm install, Docker or external database is required to RUN the included built application. Its frontend is already bundled. Database files are created in this folder's data directory. Keep that directory to preserve accounts and tickets.

| Portal | Link | ID |
| --- | --- | --- |
| Shop | http://localhost:5190/shop | SHP-3001 |
| Admin | http://localhost:5190/admin | ADM-1001 |
| Agent | http://localhost:5190/agent | AGT-2001 |
| User | http://localhost:5190/user | USR-4001 |

All initial local demo passwords: **Lottery@123**. Print/reprint is restricted to Shop accounts. Results are generated on the server, and balances/tickets persist after restart.

## Editable source

The React frontend source is in source/. To edit and rebuild it, run npm install and npm run build from that directory. Its build updates dist/lottery/. Backend source is in lottery-server/. Run npm test in the release root for backend checks.

## Defaults and scope

This release uses internal/demo balances displayed in INR, not bank deposits. Confirmed fixed ticket rates: NICE10 ₹100, NICE11 ₹200, NICE12 ₹500, NICE13 ₹1,000, NICE14 ₹2,000, NICE15 ₹3,000, NICE16 ₹4,000, NICE17 ₹5,000, NICE18 ₹7,500, NICE19 ₹10,000. Admin can edit each rate within ₹100–₹10,000. User and Shop start at quantity 1. Draw interval: 15 minutes; payouts: 2D 80x, 3D 800x, Titli 8x the winning series stake. These are editable defaults, not inferred screenshot rates. Existing databases get a one-time series-price migration for unsold future draws; sold tickets retain their original pricing. The Shop panel represents a physical counter connected to this server, including over a local network; disconnected ticket issuance is not supported.

No payment gateway, official draw service, identity-verification service or jurisdiction-specific commercial setup is connected. Browser/PDF printing has been checked; thermal printer hardware has not been tested.

Configuration and workflows: [implementation guide](docs/implementation.md). The guide's repository-specific commands apply to the original repository; this portable package uses npm start and npm test as described above. To use another port set LOTTERY_PORT. To allow LAN access set LOTTERY_HOST to the intended interface.

Screenshots and receipt preview: preview/. The package contains no operational database, personal records or live secrets; it creates its own fresh demo workspace on first launch.
`);
console.log(destination);
