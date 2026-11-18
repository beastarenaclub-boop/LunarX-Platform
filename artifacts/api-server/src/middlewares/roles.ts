import type { Request, Response, NextFunction } from "express";
import type { UserRole } from "@workspace/db";
import { unauthorized, forbidden } from "../lib/errors";

export function requireRole(...allowed: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!allowed.includes(req.user.role)) return next(forbidden());
    next();
  };
}
