import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";

const STORAGE_ROOT =
  process.env.UPI_QR_STORAGE_DIR ?? path.resolve(process.cwd(), "data", "upi-qr");

const MAX_FILENAME = 200;
const SAFE_NAME = /[^A-Za-z0-9._-]/g;
const NAMESPACE = "upi";

function sanitizeFilename(name: string): string {
  const trimmed = name.slice(0, MAX_FILENAME);
  const cleaned = trimmed.replace(SAFE_NAME, "_");
  return cleaned.length > 0 ? cleaned : "file";
}

export interface StoreUpiQrInput {
  filename: string;
  body: Buffer;
  contentType?: string | null;
}

export interface StoredUpiQr {
  key: string;
  size: number;
  contentType: string | null;
}

export async function storeUpiQrObject(
  input: StoreUpiQrInput,
): Promise<StoredUpiQr> {
  const safe = sanitizeFilename(input.filename);
  const id = nanoid();
  const key = `${NAMESPACE}/${id}-${safe}`;
  const fullPath = path.join(STORAGE_ROOT, key);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, input.body);
  if (input.contentType) {
    await fs.writeFile(`${fullPath}.meta`, input.contentType, "utf8");
  }
  return {
    key,
    size: input.body.byteLength,
    contentType: input.contentType ?? null,
  };
}

export async function readUpiQrObject(
  key: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(key)) return null;
  const fullPath = path.join(STORAGE_ROOT, key);
  const resolved = path.resolve(fullPath);
  if (!resolved.startsWith(path.resolve(STORAGE_ROOT) + path.sep)) return null;
  try {
    const body = await fs.readFile(resolved);
    let contentType = "application/octet-stream";
    try {
      contentType = (await fs.readFile(`${resolved}.meta`, "utf8")).trim();
    } catch {
      /* no sidecar */
    }
    return { body, contentType };
  } catch {
    return null;
  }
}

export async function deleteUpiQrObject(key: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(key)) return;
  const fullPath = path.join(STORAGE_ROOT, key);
  const resolved = path.resolve(fullPath);
  if (!resolved.startsWith(path.resolve(STORAGE_ROOT) + path.sep)) return;
  try {
    await fs.unlink(resolved);
  } catch {
    /* ignore */
  }
  try {
    await fs.unlink(`${resolved}.meta`);
  } catch {
    /* ignore */
  }
}
