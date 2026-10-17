import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";

// Express 5 error handler signature requires four params even when next is unused.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid request", details: err.issues },
    });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  if (
    err instanceof Error &&
    (err.message === "REMOTE_WALLET_NOT_CONFIGURED" ||
      err.message === "PARTNER_PLAYER_REF_REQUIRED")
  ) {
    res.status(400).json({
      error: {
        code: err.message,
        message:
          err.message === "REMOTE_WALLET_NOT_CONFIGURED"
            ? "Partner is in remote-wallet mode but no walletCallbackUrl is configured; bet voided."
            : "remote-wallet bets require partnerPlayerRef; bet voided.",
      },
    });
    return;
  }
  if (err instanceof Error && err.message === "REMOTE_WALLET_UNAVAILABLE") {
    res.status(502).json({
      error: {
        code: "REMOTE_WALLET_UNAVAILABLE",
        message:
          "Partner wallet endpoint did not respond conclusively; bet voided. " +
          "Reconcile via GET /v1/bets/{id} and retry with the same partnerBetId.",
      },
    });
    return;
  }
  if (err instanceof Error && err.message === "GAME_NOT_ALLOWED_FOR_PARTNER") {
    res.status(403).json({
      error: {
        code: "GAME_NOT_ALLOWED_FOR_PARTNER",
        message:
          "This game is not in the partner's allowedGames list. Bet voided.",
      },
    });
    return;
  }
  if (err instanceof Error && err.message === "INSUFFICIENT_FUNDS") {
    res.status(400).json({
      error: { code: "INSUFFICIENT_FUNDS", message: "Insufficient wallet balance" },
    });
    return;
  }
  logger.error({ err }, "Unhandled error");
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Internal server error" },
  });
}
