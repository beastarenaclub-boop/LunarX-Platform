import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";
import {
  createSportsStore,
  SportsError,
} from "../../../lib/virtual-sports/store.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const port = Number(process.env.SPORTS_PORT ?? 5198);
const store = createSportsStore(
  process.env.VIRTUAL_SPORTS_DB ??
    resolve(root, "data/virtual-sports-preview.sqlite"),
);
const production = process.argv.includes("--production");
const webRoot = resolve(root, "artifacts/3d-game/dist/virtual-sports");
const vite = production
  ? null
  : await (
      await import("vite")
    ).createServer({
      configFile: resolve(
        root,
        "artifacts/3d-game/vite.virtual-sports.config.ts",
      ),
      server: { middlewareMode: true },
      appType: "spa",
    });
const mime = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".data": "application/octet-stream",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!url.pathname.startsWith("/api/virtual-sports/")) {
    if (vite) return vite.middlewares(req, res);
    const candidate = resolve(webRoot, "." + decodeURIComponent(url.pathname));
    if (candidate !== webRoot && !candidate.startsWith(webRoot + sep)) {
      res.writeHead(403).end();
      return;
    }
    if ((url.pathname.startsWith("/unity-sports/") || url.pathname.startsWith('/virtual-sports/audio/')) && !existsSync(candidate)) {
      res.writeHead(404).end("Sports asset not found");
      return;
    }
    const file =
      existsSync(candidate) && extname(candidate)
        ? candidate
        : resolve(webRoot, "index.html");
    try {
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] ?? "application/octet-stream",
        ...(extname(file) === ".html" || extname(file) === ".json"
          ? { "Cache-Control": "no-store" }
          : {}),
      });
      res.end(readFileSync(file));
    } catch {
      res
        .writeHead(404)
        .end("Build the sports app first: npm run sports:build");
    }
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  try {
    if (
      req.method !== "GET" &&
      (req.headers["x-sports-client"] !== "1" ||
        !req.headers["content-type"]?.includes("application/json") ||
        (req.headers.origin &&
          new URL(req.headers.origin).host !== req.headers.host))
    )
      throw new SportsError("Invalid request origin or content type.", 403);
    const token = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("vsid="))
      ?.slice(5);
    const session = store.session(token);
    res.setHeader(
      "Set-Cookie",
      `vsid=${session.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`,
    );
    if (req.method === "GET" && url.pathname.endsWith("/state")) {
      res.end(JSON.stringify(store.state(session.accountId)));
      return;
    }
    if (
      req.method !== "POST" ||
      !["/api/virtual-sports/bets", "/api/virtual-sports/refill"].includes(
        url.pathname,
      )
    ) {
      res.writeHead(404).end(JSON.stringify({ error: "Not found" }));
      return;
    }
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 4096) throw new SportsError("Request too large.", 413);
    }
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      throw new SportsError("Invalid JSON.");
    }
    const state = url.pathname.endsWith("/bets")
      ? store.place(session.accountId, input)
      : store.refill(session.accountId);
    res.end(JSON.stringify(state));
  } catch (error) {
    res.statusCode = error instanceof SportsError ? error.status : 500;
    res.end(
      JSON.stringify({
        error:
          error instanceof SportsError
            ? error.message
            : "Sports service unavailable.",
      }),
    );
    if (!(error instanceof SportsError)) console.error(error);
  }
});
const timer = setInterval(() => {
  try {
    store.tick();
  } catch (e) {
    console.error(e);
  }
}, 1000).unref();
server.listen(port, "127.0.0.1", () =>
  console.log(`Virtual Sports: http://127.0.0.1:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearInterval(timer);
    server.close();
    void vite?.close();
    store.close();
    process.exit(0);
  });
