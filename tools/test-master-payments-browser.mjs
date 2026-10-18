import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, extname, sep } from "node:path";
import { readFile, mkdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(resolve(root, "artifacts/3d-game/package.json"));
const { chromium, expect } = require("@playwright/test");
process.env.DATABASE_URL =
  process.env.NETWORK_TEST_DATABASE_URL ??
  "postgresql://aviator:aviator_local@127.0.0.1:5449/aviator_network_test";
assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith("_network_test"));
Object.assign(process.env, {
  COOKIE_SECURE: "false",
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  B2B_HOSTS: "127.0.0.1:4191",
  OPERATOR_HOSTS: "127.0.0.1:4196",
});
const load = (path) => import(pathToFileURL(resolve(root, path)).href);
const { build } = await load(
  "artifacts/3d-game/node_modules/vite/dist/node/index.js",
);
const output = resolve(root, "tmp/master-manual-browser");
await mkdir(output, { recursive: true });
for (const artifact of process.env.MASTER_QR_SKIP_BUILD === "1"
  ? []
  : ["agent-panel", "admin-panel", "3d-game"]) {
  await build({
    configFile: resolve(root, `artifacts/${artifact}/vite.config.ts`),
    logLevel: "error",
    build: { outDir: resolve(output, artifact), copyPublicDir: false },
  });
}
const { default: app } = await load("artifacts/api-server/src/app.ts");
const { db, pool, usersTable, networkNodesTable } = await load(
  "lib/db/src/index.ts",
);
const { createSession } = await load(
  "artifacts/api-server/src/services/auth.ts",
);
const { postEntry, getBalanceByUser } = await load(
  "artifacts/api-server/src/services/wallet.ts",
);
const { attachRealtime } = await load(
  "artifacts/api-server/src/realtime/gateway.ts",
);
const servers = [],
  gateways = [],
  contexts = [],
  errors = [];
let browser;
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
try {
  for (const [port, artifact] of [
    [4196, "agent-panel"],
    [4195, "admin-panel"],
    [4191, "3d-game"],
  ]) {
    const dir = resolve(output, artifact);
    const server = createServer(async (req, res) => {
      if (req.url.startsWith("/api/")) return app(req, res);
      try {
        const pathname = decodeURIComponent(
          new URL(req.url, "http://localhost").pathname,
        ).replace(/^\/(agent|master|admin)(\/|$)/, "/");
        let file = resolve(dir, `.${pathname}`);
        if (!file.startsWith(`${dir}${sep}`) && file !== dir) {
          res.writeHead(403);
          res.end();
          return;
        }
        try {
          if (!(await stat(file)).isFile()) file = resolve(dir, "index.html");
        } catch {
          file = resolve(dir, "index.html");
        }
        const body = await readFile(file);
        res.writeHead(200, {
          "content-type": mime[extname(file)] ?? "application/octet-stream",
        });
        res.end(body);
      } catch (e) {
        res.writeHead(500);
        res.end(String(e));
      }
    });
    await new Promise((r) => server.listen(port, "127.0.0.1", r));
    servers.push(server);
    gateways.push(attachRealtime(server));
  }
  const suffix = randomUUID();
  async function user(name, role, b2bAgentId) {
    const email = `qr-browser-${name}-${suffix}@example.test`;
    const [u] = await db
      .insert(usersTable)
      .values({
        email,
        emailNormalized: email,
        displayName: name,
        passwordHash: "browser-test-session",
        role,
        channel: b2bAgentId ? "b2b" : "b2c",
        b2bAgentId,
      })
      .returning();
    const session = await createSession(u.id, null, null);
    return { ...u, sid: session.id };
  }
  const admin = await user("Admin", "admin");
  const master = await user("Master", "agent");
  const [node] = await db
    .insert(networkNodesTable)
    .values({
      userId: master.id,
      kind: "master",
      name: "QR Browser Branch",
      createdBy: admin.id,
    })
    .returning();
  const agent = await user("Agent", "agent");
  const [agentNode] = await db
    .insert(networkNodesTable)
    .values({
      userId: agent.id,
      kind: "agent",
      parentId: node.id,
      name: "QR Browser Agent",
      createdBy: master.id,
    })
    .returning();
  const player = await user("Customer", "player", agentNode.id);
  await postEntry({
    userId: agent.id,
    type: "adjustment",
    amount: 100000n,
    refType: "manual_qr_browser_test",
  });
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  async function pageFor(user, cookie, port) {
    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
    });
    contexts.push(context);
    await context.addCookies([
      {
        name: cookie,
        value: user.sid,
        url: `http://127.0.0.1:${port}`,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    return page;
  }
  const masterPage = await pageFor(master, "sid_master", 4196);
  await masterPage.goto("http://127.0.0.1:4196/master/manual-payments");
  await expect(masterPage.getByText("Manual payment access has not been assigned by admin.")).toBeVisible();
  await expect(masterPage.getByRole("link", { name: "Manual payments", exact: true })).toHaveCount(0);
  await expect(masterPage.getByRole("button", { name: "Manual payments", exact: true })).toHaveCount(0);
  await expect(masterPage.getByLabel("UPI ID", { exact: true })).toHaveCount(0);
  const adminPage = await pageFor(admin, "sid", 4195);
  await adminPage.goto("http://127.0.0.1:4195/admin/network");
  await adminPage.getByRole("button", { name: "Manual payments", exact: true }).click();
  await adminPage.getByLabel("Master payment account").selectOption(node.id);
  await adminPage.getByRole("button", { name: "Assign manual payment access", exact: true }).click();
  await expect(adminPage.getByRole("button", { name: "Revoke manual payment access", exact: true })).toBeVisible();
  await masterPage.reload();
  await expect(masterPage.getByRole("link", { name: "Manual payments", exact: true })).toBeVisible();
  await masterPage
    .getByLabel("Payment receiver name", { exact: true })
    .fill("Master QR Receiver");
  await masterPage
    .getByLabel("UPI ID", { exact: true })
    .fill("browser.master@upi");
  // Upload a valid, scannable raster QR and verify the customer sees that image.
  const { QRCodeSVG } = require("qrcode.react");
  const { createElement } = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const qrPage = await browser.newPage();
  await qrPage.setContent(
    renderToStaticMarkup(
      createElement(QRCodeSVG, {
        value:
          "upi://pay?pa=browser.master%40upi&pn=Master%20QR%20Receiver&cu=INR",
        size: 256,
        marginSize: 4,
      }),
    ),
  );
  const qrBuffer = await qrPage.locator("svg").screenshot();
  await qrPage.close();
  await masterPage
    .getByLabel("Upload your payment QR (optional)")
    .setInputFiles({ name: "qr.png", mimeType: "image/png", buffer: qrBuffer });
  await expect(masterPage.getByAltText("Payment QR preview")).toBeVisible();
  await masterPage
    .getByRole("button", { name: "Save payment details", exact: true })
    .click();
  await expect(masterPage.getByRole("status")).toHaveText(
    "Payment details saved.",
  );
  await masterPage.reload();
  await expect(masterPage.getByLabel("UPI ID", { exact: true })).toHaveValue(
    "browser.master@upi",
  );
  await masterPage.screenshot({
    path: resolve(output, "master-desktop.png"),
    fullPage: true,
  });
  const customerPage = await pageFor(player, "sid_b2b", 4191);
  await customerPage.goto("http://127.0.0.1:4191/wallet");
  await expect(customerPage.getByTestId("text-upi-id")).toHaveText(
    "browser.master@upi",
  );
  await expect(customerPage.getByTestId("img-upi-qr")).toHaveAttribute(
    "src",
    /^data:image\/png;base64,/,
  );
  await customerPage.getByTestId("input-deposit-amount").fill("200");
  await customerPage.getByTestId("input-deposit-ref").fill("123456789012");
  await customerPage.getByTestId("btn-deposit-submit").click();
  await expect(customerPage.getByTestId("list-deposits")).toContainText(
    "123456789012",
  );
  assert.equal((await getBalanceByUser(player.id)).balance, 0n);
  await masterPage
    .getByRole("button", { name: "Refresh requests", exact: true })
    .click();
  await masterPage
    .getByRole("button", { name: "Review & approve", exact: true })
    .click();
  const review = masterPage.getByRole("region", {
    name: "Review deposit",
    exact: true,
  });
  await expect(
    review.getByRole("button", { name: "Confirm received & credit" }),
  ).toBeDisabled();
  await review.getByRole("checkbox").check();
  await review
    .getByRole("button", { name: "Confirm received & credit" })
    .click();
  await expect(masterPage.getByRole("status")).toHaveText(
    "Deposit approved and customer wallet credited.",
  );
  assert.equal((await getBalanceByUser(player.id)).balance, 20000n);
  assert.equal((await getBalanceByUser(agent.id)).balance, 80000n);
  assert.equal((await getBalanceByUser(master.id)).balance, 0n);
  await customerPage.reload();
  await expect(customerPage.getByTestId("list-deposits")).toContainText(
    "approved",
  );
  await masterPage.getByLabel("Deposit status").selectOption("approved");
  await expect(
    masterPage.getByRole("region", { name: "Manual deposit requests" }),
  ).toContainText("123456789012");
  for (const [name, page] of [
    ["master", masterPage],
    ["customer", customerPage],
  ]) {
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
      true,
      `${name} mobile overflow`,
    );
    await page.screenshot({
      path: resolve(output, `${name}-mobile.png`),
      fullPage: true,
    });
  }
  await adminPage.getByRole("button", { name: "Revoke manual payment access", exact: true }).click();
  await expect(adminPage.getByRole("button", { name: "Assign manual payment access", exact: true })).toBeVisible();
  await masterPage.reload();
  await expect(masterPage.getByText("Manual payment access has not been assigned by admin.")).toBeVisible();
  await expect(masterPage.getByRole("link", { name: "Manual payments", exact: true })).toHaveCount(0);
  await expect(masterPage.getByRole("button", { name: "Manual payments", exact: true })).toHaveCount(0);
  await expect(masterPage.getByLabel("UPI ID", { exact: true })).toHaveCount(0);
  await customerPage.reload();
  await expect(customerPage.getByTestId("img-upi-qr")).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: admin assignment/revocation, hidden unauthorized navigation, QR upload, branch wallet, UTR submission, funded approval and mobile layout",
  );
} finally {
  for (const context of contexts) await context.close();
  await browser?.close();
  for (const gateway of gateways) gateway.close();
  for (const server of servers) await new Promise((r) => server.close(r));
  await pool.end();
}
