import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  VISITOR_CONSENT,
  VISITOR_CONSENT_VERSION,
} from "../src/live/visitor-types";

// Give synthetic fixtures a clean quota in the dedicated test database only.
// Localhost user data and the application's rate limit remain unchanged.
async function resetVisitorTestQuota() {
  if (test.info().project.use.baseURL !== "http://127.0.0.1:5201") return;
  const directory = new URL(
    "../.wrangler/qa-state/v3/d1/miniflare-D1DatabaseObject/",
    import.meta.url,
  );
  const name = (await readdir(directory)).find((name) =>
    /^[a-f0-9]{64}\.sqlite$/.test(name),
  );
  if (!name) throw Error("Initialize the isolated QA database before testing.");
  const db = new DatabaseSync(fileURLToPath(new URL(name, directory)));
  try {
    db.exec("PRAGMA busy_timeout=5000");
    db.prepare("DELETE FROM login_limits WHERE key=?").run(
      "visitor:" + createHash("sha256").update("127.0.0.1").digest("hex"),
    );
  } finally {
    db.close();
  }
}

declare global {
  interface Window {
    visitorCameraTest: {
      calls: number;
      tracks: MediaStreamTrack[];
      deny: boolean;
      late: boolean;
      release?: () => void;
    };
  }
}
export async function cameraFixture(page: Page) {
  await resetVisitorTestQuota();
  await page.addInitScript(() => {
    window.visitorCameraTest = {
      calls: 0,
      tracks: [],
      deny: false,
      late: false,
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        const test = window.visitorCameraTest;
        test.calls++;
        if (test.deny)
          throw new DOMException("Denied for test", "NotAllowedError");
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 240;
        const drawing = canvas.getContext("2d")!;
        drawing.fillStyle = "#284232";
        drawing.fillRect(0, 0, 320, 240);
        drawing.fillStyle = "#d2ba7a";
        drawing.font = "24px sans-serif";
        drawing.fillText("SYNTHETIC QA PHOTO", 18, 120);
        const stream = canvas.captureStream(5);
        test.tracks.push(...stream.getTracks());
        if (test.late)
          await new Promise<void>((resolve) => {
            test.release = resolve;
          });
        return stream;
      },
    });
  });
}
export async function solveTriangle(page: Page) {
  for (const [part, turns] of [
    ["upper", 2],
    ["left", 1],
    ["right", 2],
  ] as const)
    for (let i = 0; i < turns; i++)
      await page
        .getByRole("button", { name: `Rotate ${part} triangle fragment` })
        .click();
}
export async function openCamera(page: Page) {
  const eye = page.getByRole("button", {
    name: "Open visitor camera check-in",
  });
  await eye.click();
  await expect(
    page.getByRole("dialog", { name: "Visitor camera check-in" }),
  ).toBeVisible();
}
export async function capture(page: Page) {
  await page.getByRole("checkbox", { name: VISITOR_CONSENT }).check();
  await page.getByRole("button", { name: "Enable camera & location" }).click();
  await expect(
    page.getByRole("button", { name: "Capture photo", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Capture photo", exact: true })
    .click();
  await expect(
    page.getByAltText("Your captured photo, not yet saved"),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.visitorCameraTest.tracks.every(
        (track) => track.readyState === "ended",
      ),
    ),
  ).toBe(true);
}
export async function saveVisitor(request: APIRequestContext) {
  if ((await (await request.get("/api/visitors/mine")).json()).saved) return;
  await resetVisitorTestQuota();
  const start = await request.post("/api/visitors/start", {
    data: { consent: true, version: VISITOR_CONSENT_VERSION },
  });
  expect(start.status(), await start.text()).toBe(200);
  const response = await request.post("/api/visitors/check-in", {
    multipart: {
      name: "SYNTHETIC ENTRY QA",
      consent: "true",
      version: VISITOR_CONSENT_VERSION,
      location: JSON.stringify({
        latitude: 26.9124,
        longitude: 75.7873,
        accuracy: 80,
        capturedAt: Date.now(),
        consent: true,
      }),
      photo: {
        name: "visitor-test.jpg",
        mimeType: "image/jpeg",
        buffer: await readFile(
          new URL("./fixtures/visitor-test.jpg", import.meta.url),
        ),
      },
    },
  });
  expect(response.status(), await response.text()).toBe(200);
}
export async function removeVisitor(request: APIRequestContext) {
  if ((await (await request.get("/api/visitors/mine")).json()).saved) {
    const response = await request.post("/api/visitors/withdraw", { data: {} });
    expect(response.status(), await response.text()).toBe(200);
  }
}
