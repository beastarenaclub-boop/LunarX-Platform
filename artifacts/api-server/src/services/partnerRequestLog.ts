import { db, partnerRequestLogsTable } from "@workspace/db";
import { logger } from "../lib/logger";

export interface PartnerRequestLogInput {
  partnerId: string | null;
  apiKeyId: string | null;
  requestId: string | null;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  ip: string | null;
  errorCode: string | null;
}

export async function logPartnerRequest(
  input: PartnerRequestLogInput,
): Promise<void> {
  try {
    await db.insert(partnerRequestLogsTable).values({
      partnerId: input.partnerId,
      apiKeyId: input.apiKeyId,
      requestId: input.requestId,
      method: input.method,
      path: input.path.slice(0, 256),
      statusCode: input.statusCode,
      latencyMs: input.latencyMs,
      ip: input.ip,
      errorCode: input.errorCode,
    });
  } catch (err) {
    logger.warn({ err }, "partner request log insert failed");
  }
}
