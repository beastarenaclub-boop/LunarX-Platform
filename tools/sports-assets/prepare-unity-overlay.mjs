import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, copyFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join, relative, dirname } from "node:path";

const root=resolve("artifacts/3d-game/dist/public"),target=resolve("tmp/unity-sports-web-overlay");
const baseImage=process.env.SPORTS_BASE_IMAGE||'aviator-game-web:latest';
if(!existsSync(join(root,"unity-sports/ready.json")))throw new Error("A completed Unity WebGL build is required before preparing deployment.");
const existing=new Set(execFileSync("docker",["run","--rm","--entrypoint","find",baseImage,"/usr/share/nginx/html","-type","f"],{encoding:"utf8",maxBuffer:8*1024*1024}).split(/\r?\n/).map(p=>p.replace("/usr/share/nginx/html/","")));
let count=0;
function copy(file,rel=relative(root,file)){const destination=join(target,"public",rel);mkdirSync(dirname(destination),{recursive:true});copyFileSync(file,destination);count++;}
function walk(folder,overwrite=false){for(const e of readdirSync(folder,{withFileTypes:true})){const p=join(folder,e.name);if(e.isDirectory())walk(p,overwrite);else if(e.isFile()&&(overwrite||!existing.has(relative(root,p).replaceAll("\\","/"))))copy(p);}}
walk(join(root,"assets"));walk(join(root,"unity-sports"),true);walk(join(root,"virtual-sports/audio"),true);copy(join(root,"index.html"));
copyFileSync(resolve("artifacts/3d-game/nginx.conf"),join(target,"nginx.conf"));
writeFileSync(join(target,"Dockerfile"),`FROM ${baseImage}\nCOPY public/ /usr/share/nginx/html/\nCOPY nginx.conf /etc/nginx/conf.d/default.conf\n`);
console.log(`Prepared ${count} website files and Unity-specific static serving configuration in ${target}.`);
