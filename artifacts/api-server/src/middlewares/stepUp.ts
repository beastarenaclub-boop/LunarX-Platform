import type { Request, Response, NextFunction } from "express";
import { forbidden } from "../lib/errors";
import { verifyPassword } from "../lib/password";
import { findUserById } from "../services/auth";

export function requireStepUp(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const confirmPassword = req.headers["x-confirm-password"];
  if (!confirmPassword || typeof confirmPassword !== "string") {
    return next(
      forbidden("Step-up confirmation required. Provide X-Confirm-Password header."),
    );
  }
  if (!req.user) {
    return next(forbidden("Authentication required"));
  }

  findUserById(req.user.id)
    .then(async (user) => {
      if (!user) return next(forbidden("User not found"));
      const valid = await verifyPassword(confirmPassword, user.passwordHash);
      if (!valid) return next(forbidden("Invalid confirmation password"));
      next();
    })
    .catch(next);
}
