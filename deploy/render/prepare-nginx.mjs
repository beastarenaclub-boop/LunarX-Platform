import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = process.argv[2];
if (!output) throw new Error("Usage: node deploy/render/prepare-nginx.mjs <output>");

// Reuse the existing asset, SPA, Unity and media routes rather than maintaining
// a separate list of game URLs for the hosted deployment.
const panels = [
  { artifact: "3d-game", directory: "web", hosts: "lunarx.live www.lunarx.live play.lunarx.live crypto777.in www.crypto777.in play.crypto777.in", primary: true },
  { artifact: "admin-panel", directory: "admin", hosts: "admin.lunarx.live" },
  { artifact: "agent-panel", directory: "operator", hosts: "panel.lunarx.live" },
];

const configurations = [];
for (const panel of panels) {
  let conf = (await readFile(path.join(repo, "artifacts", panel.artifact, "nginx.conf"), "utf8")).replaceAll("\r\n", "\n");
  if (!conf.includes("http://api:4000") || !conf.includes("listen 80;")) {
    throw new Error(`Review the Render transformation for ${panel.artifact}/nginx.conf`);
  }
  conf = conf
    .replace(/^\s*server_name _;\r?\n/gm, "")
    .replace("listen 80;", `listen \${PORT}${panel.primary ? " default_server" : ""};\n    server_name ${panel.hosts};`)
    .replaceAll("/usr/share/nginx/html", `/srv/lunarx/${panel.directory}`)
    .replaceAll("http://api:4000", "http://lunarx_api")
    .replace(/^\s*proxy_set_header X-Forwarded-(?:For|Proto).*;\r?\n/gm, "")
    .replaceAll("proxy_set_header Host $http_host;", [
      "proxy_set_header Host $http_host;",
      "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
      // HTTPS terminates at Render; Nginx receives HTTP on the private side.
      "        proxy_set_header X-Forwarded-Proto https;",
    ].join("\n"))
    .replace("index index.html;", [
      "index index.html;",
      "    server_tokens off;",
      "    access_log /dev/stdout lunarx;",
      "    client_max_body_size 10m;",
      "    proxy_read_timeout 300s;",
      "    location ~ (^|/)\\. { return 404; }",
    ].join("\n"));
  configurations.push(conf);
}

// Launch URLs may carry access tokens. Log paths without query strings.
const logFormat = `log_format lunarx '$remote_addr - $request_method $uri $server_protocol $status $body_bytes_sent';\n`;
const upstream = `upstream lunarx_api {\n zone lunarx_api 64k;\n resolver \${NGINX_RESOLVERS} valid=10s ipv6=off;\n server \${API_DNS_UPSTREAM} resolve;\n}\n`;
const legacy = `server { listen \${PORT}; server_name b2b.lunarx.live; return 308 https://play.lunarx.live$request_uri; }\n`;
await mkdir(path.dirname(path.resolve(output)), { recursive: true });
await writeFile(output, logFormat + upstream + legacy + configurations.join("\n"));
console.log(`Prepared Render gateway: ${output}`);
