import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import {
  ensureWallet,
  getBalance,
  getBalanceByUser,
  getAllScopeBalances,
  listEntries,
  toWalletScope,
} from "../services/wallet";
import { ledgerEntry } from "../lib/serialize";

const router: IRouter = Router();

// Every legacy `?game=` alias resolves to the same shared account wallet.
router.get("/balance", requireAuth, async (req, res, next) => {
  try {
    const scope = toWalletScope(
      typeof req.query.game === "string" ? req.query.game : null,
    );
    const { walletId, currency, balance } = await getBalanceByUser(
      req.user!.id,
      scope,
    );
    res.json({
      walletId,
      currency,
      scope,
      balance: balance.toString(),
    });
  } catch (err) {
    next(err);
  }
});

// Compatibility aliases of one balance. Clients must never sum these values.
router.get("/balances", requireAuth, async (req, res, next) => {
  try {
    const balances = await getAllScopeBalances(req.user!.id);
    res.json({ currency: "INR", balances });
  } catch (err) {
    next(err);
  }
});

router.get("/transactions", requireAuth, async (req, res, next) => {
  try {
    const scope = toWalletScope(
      typeof req.query.game === "string" ? req.query.game : null,
    );
    const wallet = await ensureWallet(req.user!.id, scope);
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
      200,
    );
    const cursor =
      typeof req.query.cursor === "string" ? req.query.cursor : null;
    const { entries, nextCursor } = await listEntries({
      walletId: wallet.id,
      limit,
      cursor,
    });
    res.json({
      scope,
      entries: entries.map(ledgerEntry),
      nextCursor,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
