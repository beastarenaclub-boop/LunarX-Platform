import type { Request, Response, NextFunction } from "express";
import { getActiveSession, findUserById } from "../services/auth";
import { unauthorized, forbidden } from "../lib/errors";
import type { UserRole } from "@workspace/db";
import { requestSite, requestOperatorPanel, sessionCookie } from "./siteChannel";
import { assertNetworkActive, networkIdentity } from "../services/network";

export const SESSION_COOKIE = "sid";

export async function loadSession(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const sid = req.cookies?.[sessionCookie(req)];
  if (!sid || typeof sid !== "string") return next();
  try {
    const session = await getActiveSession(sid);
    if (!session) return next();
    const user = await findUserById(session.userId);
    if (!user) return next();
    if (user.status !== "active") return next();
    if (user.role === "player" && user.channel !== requestSite(req)) return next();
    try {
      await assertNetworkActive(user);
      const panel = requestOperatorPanel(req);
      if (panel && (await networkIdentity(user)).role !== panel) return next();
    } catch { return next(); }
    req.session = session;
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireRole(...allowed: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!allowed.includes(req.user.role)) return next(forbidden());
    next();
  };
}
