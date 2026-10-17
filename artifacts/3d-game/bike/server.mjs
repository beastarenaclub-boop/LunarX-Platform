import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';

const root=fileURLToPath(existsSync(new URL('./site/',import.meta.url))?new URL('./site/',import.meta.url):new URL('../dist/bike/',import.meta.url));
const port=Number(process.env.PORT||5193);
// Old repository launch links now lead to the integrated coin-betting game.
// Historical standalone exports keep their own embedded site.
const integrated=existsSync(new URL('../src/pages/BikeRacing.tsx',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.glb':'model/gltf-binary','.hdr':'application/octet-stream','.ttf':'font/ttf','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
if(!integrated&&!existsSync(resolve(root,'index.html'))) {console.error('Build the arcade prototype first.');process.exit(1);}
const server=createServer(async(req,res)=>{
  if(integrated){res.writeHead(302,{'Location':'http://localhost:5174/bike-racing','Cache-Control':'no-store'});res.end();return;}
  try {
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(resolve(root)+sep)){res.writeHead(403);res.end();return;}
    const info=await stat(file);if(!info.isFile()){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Content-Length':info.size,'X-Content-Type-Options':'nosniff','Cache-Control':pathname.includes('/assets/')?'public, max-age=31536000, immutable':'no-cache'});
    res.end(req.method==='HEAD'?undefined:await readFile(file));
  }catch(error){res.writeHead(error instanceof URIError?400:404);res.end('File not found.');}
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is already in use. Open http://localhost:${port} or choose another PORT.`:error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`APEX Superbike Racing is ready: http://localhost:${port}\nKeep this window open while playing. Press Ctrl+C to stop.`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
