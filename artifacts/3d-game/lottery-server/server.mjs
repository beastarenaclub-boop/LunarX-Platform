import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createStore, Fault, ROLES } from "./store.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
export function createLotteryServer({
  filename = resolve(here, "../data/lottery.sqlite"),
  demo = true,
  adminPassword,
  publicDir = resolve(here, "../dist/lottery"),
  now,
} = {}) {
  const store = createStore(filename, { demo, adminPassword, now });
  const attempts = new Map();
  const timer = setInterval(() => {
    try {
      store.tick();
    } catch (error) {
      console.error("Lottery settlement failed:", error.message);
    }
  }, 1000);
  timer.unref();
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
  };
  const server = http.createServer(async (req, res) => {
    const json = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    try {
      const url = new URL(req.url, "http://localhost"),
        path = url.pathname;
      if (path === "/api/lottery/health")
        return json(200, { ok: true, service: "irland-lotto" });
      if (!path.startsWith("/api/lottery/")) {
        if (req.method !== "GET" && req.method !== "HEAD")
          throw new Fault("Method not allowed.", 405);
        let file = resolve(publicDir, "." + decodeURIComponent(path));
        if (file !== publicDir && !file.startsWith(publicDir + sep))
          throw new Fault("Not found.", 404);
        try {
          if (!(await stat(file)).isFile())
            file = resolve(publicDir, "index.html");
        } catch {
          file = resolve(publicDir, "index.html");
        }
        let content;
        try {
          content = await readFile(file);
        } catch {
          throw new Fault(
            "Build the lottery app first: npm run lottery:build",
            503,
          );
        }
        res.writeHead(200, {
          "Content-Type": mime[extname(file)] ?? "application/octet-stream",
          "Cache-Control":
            extname(file) === ".html" ? "no-cache" : "public, max-age=3600",
        });
        return res.end(req.method === "HEAD" ? undefined : content);
      }
      let body = {};
      const mutation = ["POST", "PATCH", "DELETE", "PUT"].includes(req.method);
      if (mutation) {
        if (req.headers["x-lottery-request"] !== "1")
          throw new Fault("Missing request protection header.", 403);
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host)
          throw new Fault("Cross-origin writes are not allowed.", 403);
        if (!req.headers["content-type"]?.startsWith("application/json"))
          throw new Fault("JSON is required.", 415);
        let raw = "",
          size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 256000) throw new Fault("Request is too large.", 413);
          raw += chunk;
        }
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          throw new Fault("Invalid JSON.");
        }
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new Fault("Invalid request.");
      }
      const cookieOptions = `Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${process.env.LOTTERY_COOKIE_SECURE === "true" ? "; Secure" : ""}`;
      if (path === "/api/lottery/login" && req.method === "POST") {
        const ip = req.socket.remoteAddress ?? "local",
          time = Date.now();
        if (attempts.size > 2000)
          for (const [key, value] of attempts)
            if (value.until < time) attempts.delete(key);
        const prior = attempts.get(ip);
        const entry =
          prior && prior.until > time
            ? prior
            : { count: 0, until: time + 60000 };
        if (entry.count >= 12)
          throw new Fault(
            "Too many sign-in attempts. Try again in one minute.",
            429,
          );
        entry.count++;
        attempts.set(ip, entry);
        const result = store.login(body.role, body.id, body.password);
        res.setHeader(
          "Set-Cookie",
          `lottery_${body.role}=${result.token}; ${cookieOptions}`,
        );
        return json(200, { account: result.account });
      }
      const role = req.headers["x-lottery-role"];
      if (!ROLES.includes(role))
        throw new Fault("Choose a portal and sign in.", 401);
      const cookies = Object.fromEntries(
        (req.headers.cookie ?? "").split(";").map((c) => c.trim().split("=")),
      );
      const token = cookies[`lottery_${role}`],
        actor = store.authenticate(token, role);
      if (!actor)
        throw new Fault("Your session has ended. Please sign in again.", 401);
      if (path === "/api/lottery/logout" && req.method === "POST") {
        store.logout(token);
        res.setHeader(
          "Set-Cookie",
          `lottery_${role}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
        );
        return json(200, { ok: true });
      }
      if (path === "/api/lottery/bootstrap" && req.method === "GET")
        return json(200, store.bootstrap(actor));
      if (req.method === "POST") {
        // Settle overdue draws before claims; settlement remains server-authoritative.
        store.tick();
        const key = req.headers["idempotency-key"];
        if (path === "/api/lottery/tickets")
          return json(201, store.sell(actor, body, key));
        const match = path.match(
          /^\/api\/lottery\/tickets\/([A-Z0-9-]+)\/(cancel|claim|receipt)$/,
        );
        if (match) return json(200, store[match[2]](actor, match[1]));
        if (path === "/api/lottery/accounts")
          return json(201, store.createAccount(actor, body));
        const accountMatch = path.match(
          /^\/api\/lottery\/accounts\/([A-Z0-9-]+)\/status$/,
        );
        if (accountMatch)
          return json(
            200,
            store.setActive(actor, accountMatch[1], body.active),
          );
        if (path === "/api/lottery/transfers")
          return json(200, store.transfer(actor, body, key));
        if (path === "/api/lottery/settings")
          return json(200, store.updateSettings(actor, body));
        if (path === "/api/lottery/complaints")
          return json(201, store.complaint(actor, body));
        const complaintMatch = path.match(
          /^\/api\/lottery\/complaints\/([A-Z0-9-]+)\/resolve$/,
        );
        if (complaintMatch)
          return json(
            200,
            store.resolveComplaint(actor, complaintMatch[1], body.reply),
          );
        if (path === "/api/lottery/password")
          return json(200, store.changePassword(actor, body));
      }
      throw new Fault("Endpoint not found.", 404);
    } catch (error) {
      if (!(error instanceof Fault))
        console.error("Lottery request failed:", error);
      if (!res.headersSent)
        json(error instanceof Fault ? error.status : 500, {
          error:
            error instanceof Fault
              ? error.message
              : "The request could not be completed. Please try again.",
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
  const port = Number(process.env.LOTTERY_PORT ?? 5190);
  const { server } = createLotteryServer({
    filename: process.env.LOTTERY_DB,
    demo: process.env.LOTTERY_DEMO !== "false",
    adminPassword: process.env.LOTTERY_ADMIN_PASSWORD,
  });
  server.on("error", (error) => {
    console.error(
      `Cannot start Irland Lotto on port ${port}: ${error.message}. Set LOTTERY_PORT to an available port.`,
    );
    process.exit(1);
  });
  server.listen(port, process.env.LOTTERY_HOST ?? "127.0.0.1", () =>
    console.log(
      `Irland Lotto ready: http://localhost:${port}/ — ${process.env.LOTTERY_DEMO === "false" ? "local workspace" : "demo credits"}`,
    ),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close(() => process.exit(0)));
}
