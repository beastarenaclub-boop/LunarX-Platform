import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import v1Router from "./routes/v1";
import launchHtmlRouter from "./routes/launchHtml";
import { logger } from "./lib/logger";
import { loadSession } from "./middlewares/auth";
import { csrfProtect } from "./middlewares/csrf";
import { errorHandler } from "./middlewares/error";
import { demoGateway } from "./demo/bridge";

const app: Express = express();

// Proxy trust must match the deployment topology — trusting hop counts when
// the server is *not* behind a known reverse proxy lets clients spoof
// `X-Forwarded-For`, defeating IP-based rate limiting and audit IP
// attribution. Default to disabled; opt in explicitly via TRUST_PROXY.
//   TRUST_PROXY="1"          → trust 1 proxy hop (e.g. one ALB/CDN in front)
//   TRUST_PROXY="loopback"   → trust loopback addresses
//   TRUST_PROXY="false"|""   → no trust (default, safe)
const trustProxy = (process.env.TRUST_PROXY ?? "").trim();
if (trustProxy && trustProxy !== "false" && trustProxy !== "0") {
  const asInt = Number.parseInt(trustProxy, 10);
  app.set("trust proxy", Number.isFinite(asInt) ? asInt : trustProxy);
} else {
  app.set("trust proxy", false);
}

app.use(
  pinoHttp({
    logger,
    autoLogging: { ignore: (req) => /(?:^|;\s*)sid=demo_/.test(req.headers.cookie ?? "") ||
      /^\/api\/auth\/demo-(login|heartbeat)(?:\?|$)/.test(req.url ?? "") },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
const corsAllowlist = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    credentials: true,
    origin: (origin, cb) => {
      // Allow same-origin / non-browser (no Origin header).
      if (!origin) return cb(null, true);
      if (corsAllowlist.length === 0) {
        // No allowlist configured: in non-production reflect the request
        // origin so local dev works; in production refuse credentialed CORS.
        if (process.env.NODE_ENV !== "production") return cb(null, true);
        return cb(null, false);
      }
      if (corsAllowlist.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
  }),
);
app.use("/api/webhooks", express.raw({ type: "application/json" }), (req, _res, next) => {
  if (Buffer.isBuffer(req.body)) {
    (req as unknown as Record<string, unknown>).rawBody = req.body.toString("utf-8");
    req.body = JSON.parse((req as unknown as Record<string, unknown>).rawBody as string);
  }
  next();
});
app.use(
  express.json({
    // Capture raw body so partner HMAC verification can re-hash exact bytes.
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody?: string }).rawBody = buf.toString("utf-8");
    },
  }),
);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(loadSession);
app.use(csrfProtect);
app.use(demoGateway);

app.use("/api", router);
app.use("/v1", v1Router);
// Public iframe entry point — must be mounted at root, NOT under /api,
// because partners embed it directly: <iframe src=".../launch?...">.
app.use(launchHtmlRouter);

app.use(errorHandler);

export default app;
