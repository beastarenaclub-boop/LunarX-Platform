import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createStore, Fault } from "./store.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
export function createWinGoServer({
  filename = resolve(here, "../data/wingo.sqlite"),
  publicDir = resolve(here, "../dist/wingo"),
  now,
  draw,
} = {}) {
  const store = createStore(filename, { now, draw });
  store.tick();
  const timer = setInterval(() => {
    try {
      store.tick();
    } catch (error) {
      console.error("Lunar Colour Trading settlement failed:", error);
    }
  }, 250);
  timer.unref();
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".png": "image/png",
  };
  const server = http.createServer(async (req, res) => {
    const json = (status, body) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(body));
    };
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    try {
      const url = new URL(req.url, "http://localhost");
      if (!url.pathname.startsWith("/api/wingo/")) {
        if (!["GET", "HEAD"].includes(req.method))
          throw new Fault("Method not allowed.", 405);
        const root = resolve(publicDir);
        let file = resolve(root, "." + decodeURIComponent(url.pathname));
        if (file !== root && !file.startsWith(root + sep))
          throw new Fault("Not found.", 404);
        if (["/", "/wingo", "/lunar-colour-trading"].includes(url.pathname))
          file = resolve(root, "index.html");
        if (!(await stat(file).catch(() => null))?.isFile())
          throw new Fault("Build the app first with npm run wingo:build.", 404);
        const data = await readFile(file);
        res.writeHead(200, {
          "Content-Type": mime[extname(file)] || "application/octet-stream",
          "Cache-Control":
            extname(file) === ".html" ? "no-cache" : "public, max-age=3600",
        });
        return res.end(req.method === "HEAD" ? undefined : data);
      }
      if (req.method === "GET" && url.pathname === "/api/wingo/health")
        return json(200, { ok: true, service: "wingo" });
      const token = req.headers.cookie
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("wingo_sid="))
        ?.slice(10);
      if (req.method === "GET" && url.pathname === "/api/wingo/state")
        return json(
          200,
          store.state(token, Number(url.searchParams.get("duration") || 30)),
        );
      if (req.method !== "POST") throw new Fault("Not found.", 404);
      if (
        req.headers.origin &&
        new URL(req.headers.origin).host !== req.headers.host
      )
        throw new Fault("Cross-origin requests are not allowed.", 403);
      if (req.headers["sec-fetch-site"] === "cross-site")
        throw new Fault("Cross-site requests are not allowed.", 403);
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw new Fault("Expected JSON.", 415);
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 4096) throw new Fault("Request is too large.", 413);
      }
      let input;
      try {
        input = JSON.parse(raw || "{}");
      } catch {
        throw new Fault("Invalid JSON.");
      }
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new Fault("Expected an object.");
      if (url.pathname === "/api/wingo/session") {
        const session = store.session(token);
        res.setHeader(
          "Set-Cookie",
          `wingo_sid=${session.token}; Path=/api/wingo; HttpOnly; SameSite=Strict; Max-Age=31536000${req.socket.encrypted ? "; Secure" : ""}`,
        );
        return json(200, store.state(session.token, 30));
      }
      if (url.pathname === "/api/wingo/bets")
        return json(200, store.placeBet(token, input));
      if (url.pathname === "/api/wingo/refill")
        return json(200, store.refill(token, input.duration));
      throw new Fault("Not found.", 404);
    } catch (error) {
      if (!(error instanceof Fault)) console.error(error);
      if (!res.headersSent)
        json(error instanceof Fault ? error.status : 500, {
          error:
            error instanceof Fault
              ? error.message
              : "Something went wrong. Please try again.",
        });
      else res.end();
    }
  });
  server.on("close", () => {
    clearInterval(timer);
    store.close();
  });
  return { server, store };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.WINGO_PORT || 5192);
  const { server } = createWinGoServer({ filename: process.env.WINGO_DB });
  server.listen(port, "127.0.0.1", () =>
    console.log(`Lunar Colour Trading is ready at http://localhost:${port}`),
  );
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
