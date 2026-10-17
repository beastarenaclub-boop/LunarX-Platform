import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createForexStore, ForexFault } from "../../../lib/forex/store.mjs";
import { createQuoteFeed } from "../../../lib/forex/quotes.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
export function createForexServer({
  filename = resolve(here, "../data/forex.sqlite"),
  publicDir = resolve(here, "../dist/forex"),
  now,
  quoteFeed = createQuoteFeed(),
} = {}) {
  const store = createForexStore(filename, { now });
  const timer = setInterval(() => {
    try {
      store.tick();
    } catch (error) {
      console.error("Forex round error:", error);
    }
  }, 500);
  timer.unref();
  const server = http.createServer(async (req, res) => {
    const json = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    try {
      const url = new URL(req.url, "http://localhost");
      if (!url.pathname.startsWith("/api/forex/")) {
        if (!["GET", "HEAD"].includes(req.method))
          throw new ForexFault("Method not allowed.", 405);
        const root = resolve(publicDir);
        const path = ["/", "/forex-trading"].includes(url.pathname)
          ? "/index.html"
          : decodeURIComponent(url.pathname);
        const file = resolve(root, "." + path);
        if (
          !file.startsWith(root + sep) ||
          !(await stat(file).catch(() => null))?.isFile()
        )
          throw new ForexFault(
            "Not found. Run npm run forex:build first.",
            404,
          );
        const data = await readFile(file);
        const mime = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".woff2": "font/woff2",
        };
        res.writeHead(200, {
          "Content-Type": mime[extname(file)] || "application/octet-stream",
          "Cache-Control":
            extname(file) === ".html" ? "no-cache" : "public, max-age=3600",
        });
        return res.end(req.method === "HEAD" ? undefined : data);
      }
      if (req.method === "GET" && url.pathname === "/api/forex/health")
        return json(200, { ok: true });
      if (req.method === "GET" && url.pathname === "/api/forex/quotes")
        return json(200, await quoteFeed.read());
      const token = req.headers.cookie
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("forex_sid="))
        ?.slice(10);
      const id = store.session(token);
      if (req.method === "GET" && url.pathname === "/api/forex/state")
        return json(200, store.state(id));
      if (req.method !== "POST") throw new ForexFault("Not found.", 404);
      if (
        (req.headers.origin &&
          new URL(req.headers.origin).host !== req.headers.host) ||
        req.headers["sec-fetch-site"] === "cross-site"
      )
        throw new ForexFault("Cross-origin request blocked.", 403);
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw new ForexFault("Expected JSON.", 415);
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 2048) throw new ForexFault("Request too large.", 413);
      }
      let input;
      try {
        input = JSON.parse(raw || "{}");
      } catch {
        throw new ForexFault("Invalid JSON.");
      }
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new ForexFault("Expected a JSON object.");
      if (url.pathname === "/api/forex/session") {
        if (id) return json(200, store.state(id));
        const session = store.createSession();
        res.setHeader(
          "Set-Cookie",
          `forex_sid=${session.token}; Path=/api/forex; HttpOnly; SameSite=Strict; Max-Age=2592000`,
        );
        return json(200, store.state(session.id));
      }
      if (!id) throw new ForexFault("Start a practice session first.", 401);
      if (url.pathname === "/api/forex/trades")
        return json(200, store.place(id, input));
      if (url.pathname === "/api/forex/refill")
        return json(200, store.refill(id));
      throw new ForexFault("Not found.", 404);
    } catch (error) {
      if (!(error instanceof ForexFault)) console.error(error);
      json(error instanceof ForexFault ? error.status : 500, {
        error:
          error instanceof ForexFault
            ? error.message
            : "The practice server could not complete this request.",
      });
    }
  });
  server.on("close", () => {
    clearInterval(timer);
    store.close();
  });
  return server;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.FOREX_PORT || 5196);
  const server = createForexServer({ filename: process.env.FOREX_DB });
  server.listen(port, "127.0.0.1", () =>
    console.log(`Aurum practice trading: http://127.0.0.1:${port}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close());
}
