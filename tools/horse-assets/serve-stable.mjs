// Read-only local preview: compiled betting UI plus the latest Unity runtime.
// Keeping this separate from Vite prevents unrelated source edits reloading a race.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const ui = path.join(workspace, 'artifacts/3d-game/dist/horse-unity-v3-review');
const publicRoot = path.join(workspace, 'artifacts/3d-game/public');
const port = Number(process.env.HORSE_PREVIEW_PORT || 5293);
const upstream = new URL(process.env.API_PROXY_TARGET || 'http://127.0.0.1:5200');
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.wasm':'application/wasm', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2', '.glb':'model/gltf-binary', '.webp':'image/webp' };

await stat(path.join(ui, 'index.html'));
await stat(path.join(publicRoot, 'unity-horse/ready.json'));

function proxyOptions(req) {
  return { hostname:upstream.hostname, port:upstream.port || 80, path:req.url, method:req.method, headers:{...req.headers, host:upstream.host} };
}

const server = http.createServer(async (req, res) => {
  if (/^\/(api|ws)(\/|\?|$)/.test(req.url)) {
    const outgoing = http.request(proxyOptions(req), incoming => {
      res.writeHead(incoming.statusCode, incoming.headers);
      incoming.pipe(res);
    });
    outgoing.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Game API on port 5200 is unavailable.'); });
    req.pipe(outgoing);
    return;
  }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const root = pathname.startsWith('/unity-horse/') || pathname.startsWith('/assets/horse-racing/advertising/') ? publicRoot : ui;
    const filename = path.resolve(root, '.' + pathname);
    if (!filename.startsWith(root + path.sep) && filename !== root) { res.writeHead(403); res.end(); return; }
    let target = filename;
    let info;
    try { info = await stat(target); } catch {
      const publicFile = path.resolve(publicRoot, '.' + pathname);
      if (!publicFile.startsWith(publicRoot + path.sep)) throw new Error('invalid');
      try { info = await stat(publicFile); target = publicFile; } catch {
        if (path.extname(pathname) || root === publicRoot) throw new Error('missing');
        target = path.join(ui, 'index.html'); info = await stat(target);
      }
    }
    if (info.isDirectory()) { target = path.join(target, 'index.html'); info = await stat(target); }
    res.writeHead(200, { 'Content-Type':mime[path.extname(target)] || 'application/octet-stream', 'Content-Length':info.size, 'Cache-Control':'no-cache', 'X-Horse-Preview':'stable-v3' });
    if (req.method === 'HEAD') res.end();
    else createReadStream(target).on('error', () => res.destroy()).pipe(res);
  } catch { res.writeHead(404); res.end('Not found'); }
});

server.on('upgrade', (req, socket, head) => {
  if (!/^\/ws(\/|\?|$)/.test(req.url)) { socket.destroy(); return; }
  const outgoing = http.request(proxyOptions(req));
  outgoing.on('upgrade', (incoming, remote, remoteHead) => {
    socket.write(`HTTP/1.1 ${incoming.statusCode} ${incoming.statusMessage}\r\n` + Object.entries(incoming.headers).map(([key,value]) => `${key}: ${value}\r\n`).join('') + '\r\n');
    if (remoteHead.length) socket.write(remoteHead);
    if (head.length) remote.write(head);
    remote.on('error', () => socket.destroy());
    socket.on('error', () => remote.destroy());
    remote.pipe(socket).pipe(remote);
  });
  outgoing.on('response', () => socket.destroy());
  outgoing.on('error', () => socket.destroy());
  outgoing.end();
});
server.listen(port, '127.0.0.1', () => console.log(`Horse betting game: http://127.0.0.1:${port}/horse-racing (Unity visual revision 3)`));
