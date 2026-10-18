import { Router, type IRouter } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db, auditLogTable, masterPaymentAccountsTable } from "@workspace/db";
import {
  authorizeCollection,
  masterAccount,
  listMasterDeposits,
  decideMasterDeposit,
} from "../services/masterManualPayments";
import { assertBranchOperations } from "../services/networkWeekly";
import { paymentRequest } from "../lib/serialize";
import { badRequest } from "../lib/errors";

const router: IRouter = Router();
const settingsInput = z
  .object({
    label: z.string().trim().min(2).max(80),
    upiId: z
      .string()
      .trim()
      .regex(
        /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/,
        "Enter a valid UPI ID",
      ),
    qrData: z.string().max(90000).nullable(),
    active: z.boolean(),
  })
  .strict();

function validateQr(data: string | null) {
  if (!data) return;
  const match = data.match(
    /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/,
  );
  if (!match) throw badRequest("Upload a PNG, JPEG or WebP QR image");
  const bytes = Buffer.from(match[2]!, "base64");
  const valid =
    match[1] === "png"
      ? bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
      : match[1] === "jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 12) === "WEBP";
  if (!valid || bytes.length > 64000)
    throw badRequest("QR must be a valid image under 64 KB");
}

router.get("/:masterId", async (req, res, next) => {
  try {
    const id = String(req.params.masterId);
    await authorizeCollection(req.user!, id);
    res.set("Cache-Control", "no-store").json(await masterAccount(id));
  } catch (e) {
    next(e);
  }
});
router.put("/:masterId", async (req, res, next) => {
  try {
    const masterId = String(req.params.masterId);
    await authorizeCollection(req.user!, masterId);
    if (req.user!.role === "agent") await assertBranchOperations(req.user!.id);
    const input = settingsInput.parse(req.body);
    validateQr(input.qrData);
    const result = await db.transaction(async (tx) => {
      await authorizeCollection(req.user!, masterId, tx);
      const [account] = await tx
        .insert(masterPaymentAccountsTable)
        .values({ masterId, ...input })
        .onConflictDoUpdate({
          target: masterPaymentAccountsTable.masterId,
          set: {
            ...input,
            version: sql`${masterPaymentAccountsTable.version} + 1`,
            updatedAt: new Date(),
          },
        })
        .returning();
      await tx
        .insert(auditLogTable)
        .values({
          actorId: req.user!.id,
          actorRole: req.user!.role,
          action: "network.payment_account.update",
          targetType: "network",
          targetId: masterId,
          after: {
            label: input.label,
            upiId: input.upiId,
            active: input.active,
            hasQr: !!input.qrData,
            version: account!.version,
          },
        });
      return account;
    });
    res.json(result);
  } catch (e) {
    next(e);
  }
});
router.get("/:masterId/deposits", async (req, res, next) => {
  try {
    const id = String(req.params.masterId);
    await authorizeCollection(req.user!, id);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(25),
        offset: z.coerce.number().int().min(0).default(0),
        status: z.enum(["pending", "approved", "rejected"]).optional(),
      })
      .parse(req.query);
    const rows = await listMasterDeposits(
      id,
      query.limit + 1,
      query.offset,
      query.status,
    );
    res
      .set("Cache-Control", "no-store")
      .json({
        items: rows
          .slice(0, query.limit)
          .map((r) => ({ ...paymentRequest(r.deposit), customer: r.customer })),
        hasMore: rows.length > query.limit,
      });
  } catch (e) {
    next(e);
  }
});
router.post("/:masterId/deposits/:id/decision", async (req, res, next) => {
  try {
    const input = z
      .object({
        decision: z.enum(["approve", "reject"]),
        reason: z.string().trim().max(500).optional(),
      })
      .strict()
      .parse(req.body);
    res.json(
      paymentRequest(
        await decideMasterDeposit(
          req.user!,
          String(req.params.masterId),
          String(req.params.id),
          input.decision,
          input.reason,
        ),
      ),
    );
  } catch (e) {
    next(e);
  }
});
export default router;
