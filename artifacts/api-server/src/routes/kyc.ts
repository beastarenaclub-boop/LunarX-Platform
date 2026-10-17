import express, { Router, type IRouter } from "express";
import { db, kycSubmissionsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { SubmitKycBody } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import { kycSubmission } from "../lib/serialize";
import { recordAuditFromReq } from "../lib/audit";
import { storeKycObject, readKycObject } from "../services/kycStorage";
import { badRequest, notFound, HttpError } from "../lib/errors";

const router: IRouter = Router();

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

router.put(
  "/uploads/:filename",
  requireAuth,
  express.raw({ type: "*/*", limit: MAX_UPLOAD_BYTES }),
  async (req, res, next) => {
    try {
      const filename = String(req.params.filename ?? "");
      if (!filename) throw badRequest("filename is required");
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.byteLength === 0) {
        throw badRequest("Empty upload body");
      }
      const contentType = req.header("content-type") ?? null;
      const stored = await storeKycObject({
        userId: req.user!.id,
        filename,
        body,
        contentType,
      });
      await recordAuditFromReq(req, {
        action: "kyc.upload",
        targetType: "kyc_object",
        targetId: stored.key,
        after: { size: stored.size, contentType: stored.contentType },
      });
      res.json(stored);
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "type" in err &&
        (err as { type?: string }).type === "entity.too.large"
      ) {
        return next(new HttpError(413, "PAYLOAD_TOO_LARGE", "Upload too large"));
      }
      next(err);
    }
  },
);

router.get(
  "/uploads/:userId/:name/object",
  requireRole("admin", "super_admin", "support"),
  async (req, res, next) => {
    try {
      const key = `${req.params.userId}/${req.params.name}`;
      const obj = await readKycObject(key);
      if (!obj) throw notFound("Object not found");
      res.setHeader("Content-Type", obj.contentType);
      res.send(obj.body);
    } catch (err) {
      next(err);
    }
  },
);

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(kycSubmissionsTable)
      .where(eq(kycSubmissionsTable.userId, req.user!.id))
      .orderBy(desc(kycSubmissionsTable.submittedAt))
      .limit(1);
    res.json(rows[0] ? kycSubmission(rows[0]) : null);
  } catch (err) {
    next(err);
  }
});

router.get("/history", requireAuth, async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(kycSubmissionsTable)
      .where(eq(kycSubmissionsTable.userId, req.user!.id))
      .orderBy(desc(kycSubmissionsTable.submittedAt));
    res.json(rows.map(kycSubmission));
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const input = SubmitKycBody.parse(req.body);
    // Enforce ownership: the storage keys we issue are of the form
    // `<userId>/<name>`. Reject submissions referencing keys that don't
    // belong to the calling user — this prevents cross-user key references
    // even if a key is leaked or guessed.
    const ownerPrefix = `${req.user!.id}/`;
    for (const [field, key] of [
      ["idDocumentKey", input.idDocumentKey],
      ["selfieKey", input.selfieKey],
    ] as const) {
      if (!key.startsWith(ownerPrefix)) {
        throw badRequest(`${field} does not belong to the authenticated user`);
      }
      const obj = await readKycObject(key);
      if (!obj) throw badRequest(`${field} references a missing upload`);
    }
    const [row] = await db
      .insert(kycSubmissionsTable)
      .values({
        userId: req.user!.id,
        fullName: input.fullName,
        documentType: input.documentType,
        documentNumber: input.documentNumber,
        idDocumentKey: input.idDocumentKey,
        selfieKey: input.selfieKey,
        status: "pending",
      })
      .returning();
    await recordAuditFromReq(req, {
      action: "kyc.submit",
      targetType: "kyc_submission",
      targetId: row!.id,
      after: { status: "pending", documentType: input.documentType },
    });
    res.json(kycSubmission(row!));
  } catch (err) {
    next(err);
  }
});

export default router;
