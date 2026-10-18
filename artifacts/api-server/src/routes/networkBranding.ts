import { Router, type IRouter, type Request } from "express";
import rateLimit from "express-rate-limit";
import { db, auditLogTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { networkIdentity } from "../services/network";
import { masterWebsite } from "../services/networkWebsite";
import {
  cleanDomain,
  domainTarget,
  verifyOwnership,
  provisionDomain,
  domainTlsReady,
  domainProvider,
} from "../services/masterDomains";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";

const router: IRouter = Router();
const verifyLimit = rateLimit({
  windowMs: 60_000,
  limit: 2,
  standardHeaders: true,
  legacyHeaders: false,
});
async function authorize(req: Request) {
  const actor = await networkIdentity(req.user!);
  const id = String(req.params.masterId);
  if (
    actor.role !== "admin" &&
    !(actor.role === "master" && actor.node.id === id)
  )
    throw forbidden(
      "Only the master or platform administrator can change this website",
    );
  if (!(await masterWebsite(id))) throw notFound();
  await db.execute(
    sql`INSERT INTO network_websites(master_id,domain_token) VALUES(${id},${nanoid(32)}) ON CONFLICT DO NOTHING`,
  );
  return id;
}
router.get("/:masterId", async (req, res, next) => {
  try {
    const id = await authorize(req);
    const result = await db.execute(
      sql`SELECT brand_name,logo_data,custom_domain,domain_token,domain_status FROM network_websites WHERE master_id=${id}`,
    );
    res
      .set("Cache-Control", "no-store")
      .json({
        ...result.rows[0],
        cnameTarget: domainTarget(),
        website: await masterWebsite(id),
      });
  } catch (e) {
    next(e);
  }
});
function validLogo(data: string | null) {
  if (data === null) return;
  const match = data.match(
    /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/,
  );
  if (!match) throw badRequest("Upload a PNG, JPEG or WebP logo");
  const buffer = Buffer.from(match[2]!, "base64");
  const valid =
    match[1] === "png"
      ? buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
      : match[1] === "jpeg"
        ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
        : buffer.toString("ascii", 0, 4) === "RIFF" &&
          buffer.toString("ascii", 8, 12) === "WEBP";
  if (!valid || buffer.length > 64000)
    throw badRequest("Logo must be a valid image under 64 KB");
}
router.patch("/:masterId", async (req, res, next) => {
  try {
    const id = await authorize(req);
    const input = z
      .object({
        brandName: z.string().trim().min(2).max(80),
        logoData: z.string().max(90000).nullable(),
      })
      .strict()
      .parse(req.body);
    validLogo(input.logoData);
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`UPDATE network_websites SET brand_name=${input.brandName},logo_data=${input.logoData},updated_at=now() WHERE master_id=${id}`,
      );
      await tx
        .insert(auditLogTable)
        .values({
          actorId: req.user!.id,
          actorRole: req.user!.role,
          action: "network.website.brand",
          targetType: "network",
          targetId: id,
          after: { brandName: input.brandName, hasLogo: !!input.logoData },
        });
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
router.put("/:masterId/domain", async (req, res, next) => {
  try {
    const id = await authorize(req);
    const domain = cleanDomain(
      z
        .object({ domain: z.string().max(300) })
        .strict()
        .parse(req.body).domain,
    );
    await db.transaction(async (tx) => {
      const paired=domain.startsWith('www.')?domain.slice(4):`www.${domain}`;
      const domainKey=domain.replace(/^www\./,'');
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`network-domain:${domainKey}`},0))`);
      const assigned=await tx.execute(sql`SELECT master_id FROM network_websites WHERE custom_domain IN (${domain},${paired}) AND master_id<>${id}`);
      if(assigned.rows.length)throw conflict('This domain or its www alias is already assigned');
      const result = await tx.execute(
        sql`SELECT * FROM network_websites WHERE master_id=${id} FOR UPDATE`,
      );
      const row = result.rows[0]!;
      if (row.custom_domain === domain) return;
      if (row.provider_domain_id)
        throw badRequest(
          "Disconnect the existing domain before adding another",
        );
      await tx.execute(
        sql`UPDATE network_websites SET custom_domain=${domain},domain_token=${nanoid(32)},domain_status='pending',updated_at=now() WHERE master_id=${id}`,
      );
      await tx
        .insert(auditLogTable)
        .values({
          actorId: req.user!.id,
          actorRole: req.user!.role,
          action: "network.website.domain",
          targetType: "network",
          targetId: id,
          after: { domain },
        });
    });
    res.json({ ok: true });
  } catch (e) {
    if ((e as any)?.cause?.code === "23505" || (e as any)?.code === "23505")
      return next(conflict("This domain is already assigned"));
    next(e);
  }
});
router.post("/:masterId/domain/verify", verifyLimit, async (req, res, next) => {
  try {
    const id = await authorize(req);
    const result = await db.transaction(async (tx) => {
      const rows = await tx.execute(
        sql`SELECT * FROM network_websites WHERE master_id=${id} FOR UPDATE`,
      );
      const w = rows.rows[0]!;
      if (!w.custom_domain) throw badRequest("Save your domain first");
      if (w.domain_status === "active") return { status: "active" };
      const domain = String(w.custom_domain);
      await verifyOwnership(domain, String(w.domain_token));
      const provision = await provisionDomain(
        domain,
        w.provider_domain_id ? String(w.provider_domain_id) : null,
      );
      const active = provision.verified && (await domainTlsReady(domain));
      const status = active ? "active" : "provisioning";
      await tx.execute(
        sql`UPDATE network_websites SET provider_domain_id=${provision.id},domain_status=${status},updated_at=now() WHERE master_id=${id}`,
      );
      await tx
        .insert(auditLogTable)
        .values({
          actorId: req.user!.id,
          actorRole: req.user!.role,
          action: "network.website.verify",
          targetType: "network",
          targetId: id,
          after: { domain, status },
        });
      return { status };
    });
    res.json(result);
  } catch (e) {
    next(e);
  }
});
router.delete("/:masterId/domain", async (req, res, next) => {
  try {
    const id = await authorize(req);
    await db.transaction(async (tx) => {
      const rows = await tx.execute(
        sql`SELECT * FROM network_websites WHERE master_id=${id} FOR UPDATE`,
      );
      const w = rows.rows[0]!;
      if (w.provider_domain_id)
        await domainProvider(
          `/${encodeURIComponent(String(w.provider_domain_id))}`,
          "DELETE",
        );
      await tx.execute(
        sql`UPDATE network_websites SET custom_domain=NULL,domain_status='pending',provider_domain_id=NULL,domain_token=${nanoid(32)},updated_at=now() WHERE master_id=${id}`,
      );
      await tx
        .insert(auditLogTable)
        .values({
          actorId: req.user!.id,
          actorRole: req.user!.role,
          action: "network.website.disconnect",
          targetType: "network",
          targetId: id,
          after: { domain: w.custom_domain },
        });
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
export default router;
