import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd=fileURLToPath(new URL('../',import.meta.url));
const result=spawnSync('docker',['compose','up','-d','api','web'],{cwd,stdio:'inherit',windowsHide:true});
if(result.error){console.error('Start Docker Desktop first. '+result.error.message);process.exit(1);}
if(result.status){process.exit(result.status);}
console.log('\nGame lobby: http://127.0.0.1:5200/\nBike Racing: http://127.0.0.1:5200/bike-racing\nLog in with your existing Lucky 7 account.');
