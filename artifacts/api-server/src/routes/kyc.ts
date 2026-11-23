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

// Only document/image formats are accepted. Anything else (HTML, SVG, ...)
// would be served back to staff on the admin origin and could run script
// with their session (stored XSS → admin account takeover).
const KYC_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

function sniffType(body: Buffer): string | null {
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "image/jpeg";
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (body.length >= 12 && body.toString("latin1", 0, 4) === "RIFF" && body.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (body.length >= 5 && body.toString("latin1", 0, 5) === "%PDF-") return "application/pdf";
  if (body.length >= 12 && body.toString("latin1", 4, 8) === "ftyp") {
    const brand = body.toString("latin1", 8, 12);
    if (["heic", "heix", "hevc", "heim", "heis"].includes(brand)) return "image/heic";
    if (["mif1", "msf1"].includes(brand)) return "image/heif";
  }
  return null;
}

// Light per-user cap so uploads cannot be used to fill the disk.
const uploadCounts = new Map<string, { count: number; resetAt: number }>();
function assertUploadBudget(userId: string) {
  const now = Date.now();
  const entry = uploadCounts.get(userId);
  if (!entry || entry.resetAt < now) {
    if (uploadCounts.size > 10_000) uploadCounts.clear();
    uploadCounts.set(userId, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return;
  }
  entry.count += 1;
  if (entry.count > 20)
    throw new HttpError(429, "TOO_MANY_REQUESTS", "Too many uploads. Try again later.");
}

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
      assertUploadBudget(req.user!.id);
      const declared = (req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      const sniffed = sniffType(body);
      if (!sniffed || !KYC_TYPES.has(sniffed)) {
        throw badRequest("Upload a JPEG, PNG, WebP, HEIC image or a PDF document");
      }
      // Trust the file's real format, not the client header (declared is only
      // used to tell HEIC from HEIF where both are valid).
      const contentType = declared === "image/heif" && sniffed === "image/heic" ? declared : sniffed;
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
      // Files stored before type checks existed may be anything: only serve
      // known document types inline, never as HTML/SVG on the admin origin.
      const type = obj.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
      const safe = KYC_TYPES.has(type);
      res.setHeader("Content-Type", safe ? type : "application/octet-stream");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'");
      res.setHeader("Content-Disposition", safe && type.startsWith("image/") ? "inline" : "attachment");
      res.setHeader("Cache-Control", "private, no-store");
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
