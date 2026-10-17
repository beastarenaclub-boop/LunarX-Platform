import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, extname } from "node:path";
import { readFile, mkdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
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
  B2B_HOSTS: "127.0.0.1:4181",
  OPERATOR_HOSTS: "127.0.0.1:4186",
});
const { default: app } = await import(
  pathToFileURL(resolve(root, "artifacts/api-server/src/app.ts")).href
);
const { pool } = await import(
  pathToFileURL(resolve(root, "lib/db/src/index.ts")).href
);
const { attachRealtime } = await import(
  pathToFileURL(resolve(root, "artifacts/api-server/src/realtime/gateway.ts"))
    .href
);
const admin = (
  await pool.query(
    "SELECT email FROM users WHERE role='admin' AND email LIKE 'net-%-admin@example.test' ORDER BY created_at DESC LIMIT 1",
  )
).rows[0];
assert.ok(admin, "Run network integration tests first");
const servers = [];
const gateways = [];
const errors = [];
let browser;
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
};
for (const [port, artifact] of [
  [4185, "admin-panel"],
  [4186, "agent-panel"],
  [4180, "3d-game"],
  [4181, "3d-game"],
]) {
  const dir = resolve(root, `artifacts/${artifact}/dist/public`);
  const server = createServer(async (req, res) => {
    if (req.url.startsWith("/api/")) return app(req, res);
    try {
      const pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      ).replace(/^\/(admin|agent|master)(\/|$)/, "/");
      let file = resolve(dir, `.${pathname}`);
      if (!file.startsWith(dir)) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        if (!(await stat(file)).isFile()) file = resolve(dir, "index.html");
      } catch {
        file = resolve(dir, "index.html");
      }
      res.writeHead(200, {
        "content-type": mime[extname(file)] ?? "application/octet-stream",
      });
      res.end(await readFile(file));
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  gateways.push(attachRealtime(server));
  servers.push(server);
}
function walletSubscribed(page) {
  return new Promise((resolve) =>
    page.on("websocket", (socket) => {
      socket.on("framereceived", ({ payload }) => {
        const message = JSON.parse(String(payload));
        if (message.op === "subscribed" && message.topic.startsWith("wallet:"))
          resolve();
      });
    }),
  );
}
async function transfer(page, target, amount, memo) {
  await target.getByRole("button", { name: "Funds", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount (INR)").fill(amount);
  await dialog.getByLabel("Reason / reference").fill(memo);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}
try {
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const adminPage = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  adminPage.on("pageerror", (e) => errors.push(e.message));
  await adminPage.goto("http://127.0.0.1:4185/admin/network");
  await adminPage.locator('input[type="email"]').fill(admin.email);
  await adminPage.locator('input[type="password"]').fill("Network@Test123");
  await adminPage.getByRole("button", { name: "Sign in", exact: true }).click();
  await adminPage.getByRole("heading", { name: "Business network" }).waitFor();
  const suffix = Date.now();
  const masterEmail = `browser-master-${suffix}@example.test`,
    agentEmail = `browser-agent-${suffix}@example.test`;
  await adminPage.getByRole("button", { name: "Create master" }).click();
  let dialog = adminPage.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Browser Branch");
  await dialog.getByLabel("Login email").fill(masterEmail);
  await dialog
    .getByLabel("Password (10–72 characters)")
    .fill("Network@Test123");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await adminPage
    .getByRole("button", { name: "Downline", exact: true })
    .click();
  await adminPage.getByText(masterEmail, { exact: true }).waitFor();
  await mkdir(resolve(root, "tmp/network-browser"), { recursive: true });
  await adminPage.screenshot({
    path: resolve(root, "tmp/network-browser/admin.png"),
    fullPage: true,
  });
  const operatorContext = await browser.newContext({
    viewport: { width: 1365, height: 900 },
  });
  const masterPage = await operatorContext.newPage();
  const masterSubscribed = walletSubscribed(masterPage);
  masterPage.on("pageerror", (e) => errors.push(e.message));
  await masterPage.goto("http://127.0.0.1:4186/master/");
  await masterPage.getByPlaceholder("Email", { exact: true }).fill(masterEmail);
  await masterPage
    .getByPlaceholder("Password", { exact: true })
    .fill("Network@Test123");
  await masterPage
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await masterPage
    .getByRole("heading", { name: "Master panel", exact: true })
    .waitFor();
  await masterPage.getByRole("button", { name: "Create agent" }).click();
  dialog = masterPage.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Browser Agent");
  await dialog.getByLabel("Login email").fill(agentEmail);
  await dialog
    .getByLabel("Password (10–72 characters)")
    .fill("Network@Test123");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await masterPage.screenshot({
    path: resolve(root, "tmp/network-browser/master.png"),
    fullPage: true,
  });
  // Same cookie jar reproduces the original master/agent session collision.
  const agentPage = await masterPage.context().newPage();
  await agentPage.setViewportSize({ width: 390, height: 844 });
  const agentSubscribed = walletSubscribed(agentPage);
  agentPage.on("pageerror", (e) => errors.push(e.message));
  await agentPage.goto("http://127.0.0.1:4186/agent/");
  await agentPage.getByPlaceholder("Email", { exact: true }).fill(agentEmail);
  await agentPage
    .getByPlaceholder("Password", { exact: true })
    .fill("Network@Test123");
  await agentPage.getByRole("button", { name: "Sign in", exact: true }).click();
  await agentPage
    .getByRole("heading", { name: "Agent panel", exact: true })
    .waitFor();
  await agentPage.getByRole("button", { name: "Create user" }).click();
  dialog = agentPage.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Browser Player");
  await dialog
    .getByLabel("Login email")
    .fill(`browser-player-${suffix}@example.test`);
  await dialog
    .getByLabel("Password (10–72 characters)")
    .fill("Network@Test123");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await agentPage
    .getByRole("button", { name: "Total Users", exact: true })
    .click();
  await agentPage.getByText("Browser Player", { exact: true }).waitFor();
  assert.equal(
    await agentPage.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2,
    ),
    true,
    "Mobile document must not overflow",
  );
  await agentPage.screenshot({
    path: resolve(root, "tmp/network-browser/agent-mobile.png"),
    fullPage: true,
  });
  await agentPage
    .getByRole("button", { name: "Open menu", exact: true })
    .click();
  await agentPage
    .getByRole("link", { name: "Downline tree", exact: true })
    .click();
  assert.ok(agentPage.url().endsWith("/agent/downline"));
  await agentPage.getByText("Browser Player", { exact: true }).waitFor();
  await agentPage.getByText("Under Browser Branch", { exact: true }).waitFor();
  assert.equal(await agentPage.locator(".net-tree-node.master").count(), 0);
  assert.equal(
    await agentPage
      .locator(".net-tree-roots > li > article")
      .getByRole("button", { name: "Manage", exact: true })
      .count(),
    0,
  );
  await agentPage.getByLabel("Find your users").fill("no-such-user");
  await agentPage
    .getByText("No users match your search.", { exact: true })
    .waitFor();
  await agentPage.getByLabel("Find your users").fill("Browser Player");
  const ownPlayer = agentPage
    .locator("li[data-player-id]")
    .filter({ hasText: "Browser Player" });
  await ownPlayer.getByRole("button", { name: "Funds", exact: true }).click();
  await agentPage
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await ownPlayer.getByRole("button", { name: "Suspend", exact: true }).click();
  await ownPlayer
    .getByRole("button", { name: "Activate", exact: true })
    .click();
  await ownPlayer
    .getByRole("button", { name: "Suspend", exact: true })
    .waitFor();
  await agentPage.getByLabel("Find your users").fill("");
  await agentPage
    .getByRole("button", { name: "Collapse all", exact: true })
    .click();
  assert.equal(
    await agentPage.getByText("Browser Player", { exact: true }).count(),
    0,
  );
  await agentPage
    .getByRole("button", { name: "Expand all", exact: true })
    .click();
  await agentPage.getByText("Browser Player", { exact: true }).waitFor();
  await agentPage
    .getByRole("button", { name: "Table view", exact: true })
    .click();
  await agentPage.getByRole("cell", { name: /Browser Player/ }).waitFor();
  await agentPage
    .getByRole("button", { name: "Tree view", exact: true })
    .click();
  await agentPage.reload();
  await agentPage.getByText("Browser Player", { exact: true }).waitFor();
  assert.equal(
    await agentPage.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2,
    ),
    true,
    "Agent tree must fit on mobile",
  );
  await agentPage.screenshot({
    path: resolve(root, "tmp/network-browser/agent-tree-mobile.png"),
    fullPage: true,
  });
  await agentPage.setViewportSize({ width: 1365, height: 900 });
  await agentPage.screenshot({
    path: resolve(root, "tmp/network-browser/agent-tree.png"),
    fullPage: true,
  });
  await Promise.race([
    Promise.all([masterSubscribed, agentSubscribed]),
    new Promise((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Wallet subscriptions did not connect")),
        5000,
      );
      timer.unref();
    }),
  ]);
  // Credit the master while both panels are open: recipient must refresh via WS, not a reload.
  const masterCard = adminPage
    .locator("article.net-tree-node.master")
    .filter({ has: adminPage.getByText(masterEmail, { exact: true }) });
  await transfer(adminPage, masterCard, "100000", "Browser admin funding");
  await expect(masterPage.locator(".net-available strong")).toHaveText(
    "₹1,00,000.00",
    { timeout: 5000 },
  );
  await masterPage
    .getByRole("button", { name: "Downline", exact: true })
    .click();
  const agentCard = masterPage
    .locator("article.net-tree-node.agent")
    .filter({ has: masterPage.getByText(agentEmail, { exact: true }) });
  await transfer(masterPage, agentCard, "40000", "Browser agent funding");
  await expect(masterPage.locator(".net-available strong")).toHaveText(
    "₹60,000.00",
  );
  await expect(agentPage.locator(".net-available strong")).toHaveText(
    "₹40,000.00",
    { timeout: 5000 },
  );
  await transfer(agentPage, ownPlayer, "10000", "Browser user funding");
  await expect(agentPage.locator(".net-available strong")).toHaveText(
    "₹30,000.00",
  );
  await expect(ownPlayer.locator(".net-tree-player-balance strong")).toHaveText(
    "₹10,000.00",
  );
  await agentPage
    .getByRole("button", { name: "View transactions", exact: true })
    .click();
  await expect(
    agentPage.getByRole("row").filter({ hasText: "Browser agent funding" }),
  ).toHaveCount(1);
  await expect(
    agentPage.getByRole("row").filter({ hasText: "Browser user funding" }),
  ).toHaveCount(2);
  // API error details must be visible and a rejected transfer must not alter balances.
  await agentCard.getByRole("button", { name: "Funds", exact: true }).click();
  dialog = masterPage.getByRole("dialog");
  await expect(dialog).toContainText("Your available balance: ₹60,000.00");
  await dialog.getByLabel("Amount (INR)").fill("60001");
  await dialog
    .getByLabel("Reason / reference")
    .fill("Insufficient balance regression");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Insufficient wallet float",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(masterPage.locator(".net-available strong")).toHaveText(
    "₹60,000.00",
  );
  await expect(agentPage.locator(".net-available strong")).toHaveText(
    "₹30,000.00",
  );
  await masterPage.reload();
  await masterPage
    .getByRole("heading", { name: "Master panel", exact: true })
    .waitFor();
  await expect(masterPage.locator(".net-available strong")).toHaveText(
    "₹60,000.00",
  );
  await agentPage
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await agentPage.getByPlaceholder("Email", { exact: true }).fill(masterEmail);
  await agentPage
    .getByPlaceholder("Password", { exact: true })
    .fill("Network@Test123");
  await agentPage.getByRole("button", { name: "Sign in", exact: true }).click();
  await agentPage
    .getByText("This is a master account. Sign in at /master/ instead.", {
      exact: false,
    })
    .waitFor();
  await masterPage.reload();
  await masterPage
    .getByRole("heading", { name: "Master panel", exact: true })
    .waitFor();
  await expect(masterPage.locator(".net-available strong")).toHaveText(
    "₹60,000.00",
  );
  await masterPage
    .getByRole("link", { name: "Downline tree", exact: true })
    .click();
  assert.ok(masterPage.url().endsWith("/master/downline"));
  await masterPage.reload();
  await masterPage
    .getByRole("button", { name: "Expand agent Browser Agent", exact: true })
    .click();
  const agentBranch = masterPage
    .locator("li[data-node-id]")
    .filter({
      has: masterPage
        .locator("article.net-tree-node.agent")
        .getByText(agentEmail, { exact: true }),
    })
    .last();
  await agentBranch.getByText("Browser Player", { exact: true }).waitFor();
  assert.equal(
    await masterPage.getByText("North Branch", { exact: true }).count(),
    0,
    "A master must not see another branch",
  );
  assert.equal(
    await masterPage
      .locator(".net-tree-roots > li > article")
      .getByRole("button", { name: "Manage", exact: true })
      .count(),
    0,
    "A master cannot edit its own contract",
  );
  await masterPage
    .getByRole("button", { name: "Collapse all", exact: true })
    .click();
  assert.equal(
    await masterPage.getByText("Browser Player", { exact: true }).count(),
    0,
  );
  await masterPage
    .getByRole("button", { name: "Expand all", exact: true })
    .click();
  await masterPage.getByText("Browser Player", { exact: true }).waitFor();
  await masterPage.getByLabel("Find a master or agent").fill("Browser Agent");
  await masterPage.getByText("Browser Branch", { exact: true }).waitFor();
  await masterPage.getByText("Browser Player", { exact: true }).waitFor();
  await masterPage.getByLabel("Find a master or agent").fill("no-such-branch");
  await masterPage.getByText("No matching master or agent found.").waitFor();
  await masterPage.getByLabel("Find a master or agent").fill("");
  await masterPage
    .getByRole("button", { name: "Table view", exact: true })
    .click();
  await masterPage.getByRole("cell", { name: /Browser Agent/ }).waitFor();
  await masterPage
    .getByRole("button", { name: "Tree view", exact: true })
    .click();
  await masterPage
    .getByRole("button", { name: "Expand all", exact: true })
    .click();
  await masterPage.getByText("Browser Player", { exact: true }).waitFor();
  await masterPage.screenshot({
    path: resolve(root, "tmp/network-browser/master-tree.png"),
    fullPage: true,
  });
  await masterPage.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await masterPage.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2,
    ),
    true,
    "Mobile tree must fit the document",
  );
  await masterPage.screenshot({
    path: resolve(root, "tmp/network-browser/master-tree-mobile.png"),
    fullPage: true,
  });
  await adminPage.reload();
  await adminPage
    .getByRole("button", { name: "Downline", exact: true })
    .click();
  await adminPage.getByLabel("Find a master or agent").fill(masterEmail);
  await adminPage
    .getByRole("button", { name: "Expand all", exact: true })
    .click();
  await adminPage.getByText("Browser Player", { exact: true }).waitFor();
  assert.ok(await adminPage.locator(".net-tree-company").isVisible());
  await adminPage.screenshot({
    path: resolve(root, "tmp/network-browser/admin-tree.png"),
    fullPage: true,
  });
  // Separate directories: master -> agents -> only the selected agent's users.
  await masterPage.setViewportSize({ width: 1365, height: 900 });
  await masterPage
    .getByRole("link", { name: "Total Agents", exact: true })
    .click();
  assert.ok(masterPage.url().endsWith("/master/agents"));
  await masterPage.reload();
  await expect(
    masterPage.getByRole("heading", { name: "Total Agents", exact: true }),
  ).toBeVisible();
  const totalAgents = masterPage
    .locator(".net-directory-counts button")
    .filter({ hasText: "Total Agents" });
  const totalUsers = masterPage
    .locator(".net-directory-counts button")
    .filter({ hasText: "Total Users" });
  await expect(totalAgents.locator("strong")).toHaveText("1");
  await expect(totalUsers.locator("strong")).toHaveText("1");
  await masterPage.getByRole("button", { name: "Create agent" }).click();
  dialog = masterPage.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Empty Agent");
  await dialog
    .getByLabel("Login email")
    .fill(`empty-agent-${suffix}@example.test`);
  await dialog
    .getByLabel("Password (10–72 characters)")
    .fill("Network@Test123");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await expect(totalAgents.locator("strong")).toHaveText("2");
  await expect(totalUsers.locator("strong")).toHaveText("1");
  await expect(masterPage.locator("tbody tr")).toHaveCount(2);
  await masterPage
    .getByLabel("Search agents", { exact: true })
    .fill("no-match");
  await expect(
    masterPage.getByText("No agents match your search.", { exact: true }),
  ).toBeVisible();
  await masterPage.getByLabel("Search agents", { exact: true }).fill("");
  await masterPage
    .locator("tbody tr")
    .filter({ hasText: "Empty Agent" })
    .getByRole("button", { name: "Total Users (0)", exact: true })
    .click();
  await expect(
    masterPage.getByRole("heading", {
      name: "Users under Empty Agent",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    masterPage.getByText("No users under this agent yet.", { exact: true }),
  ).toBeVisible();
  await expect(masterPage.locator("tbody tr")).toHaveCount(0);
  await masterPage
    .getByRole("button", { name: "Back to agents", exact: true })
    .click();
  await masterPage
    .locator("tbody tr")
    .filter({ hasText: agentEmail })
    .getByRole("button", { name: "Total Users (1)", exact: true })
    .click();
  await expect(
    masterPage.getByRole("heading", {
      name: "Users under Browser Agent",
      exact: true,
    }),
  ).toBeVisible();
  await masterPage.reload();
  await expect(
    masterPage.getByRole("heading", {
      name: "Users under Browser Agent",
      exact: true,
    }),
  ).toBeVisible();
  await expect(masterPage.locator("tbody tr")).toHaveCount(1);
  await expect(masterPage.locator("tbody tr")).toContainText(
    `browser-player-${suffix}@example.test`,
  );
  await masterPage
    .getByLabel("Search users", { exact: true })
    .fill("missing-user");
  await expect(
    masterPage.getByText("No users match your search.", { exact: true }),
  ).toBeVisible();
  await masterPage
    .getByLabel("Users under agent")
    .selectOption("");
  await expect(masterPage.locator("tbody tr")).toHaveCount(1);
  await masterPage
    .getByRole("link", { name: "Total Users", exact: true })
    .click();
  assert.ok(masterPage.url().endsWith("/master/users"));
  await masterPage.reload();
  await expect(
    masterPage.getByRole("heading", { name: "B2B users", exact: true }),
  ).toBeVisible();
  await expect(masterPage.locator("tbody tr")).toHaveCount(1);
  await masterPage
    .getByRole("link", { name: "Total Agents", exact: true })
    .click();
  await masterPage.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await masterPage.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2,
    ),
  );
  await masterPage.screenshot({
    path: resolve(root, "tmp/network-browser/master-agent-totals-mobile.png"),
    fullPage: true,
  });
  // Admin's per-master shortcut selects that master's directory, not other branches.
  await adminPage.reload();
  await adminPage
    .getByRole("button", { name: "Downline", exact: true })
    .click();
  await adminPage.getByLabel("Find a master or agent").fill(masterEmail);
  await masterCard
    .getByRole("button", { name: "Total Agents (2)", exact: true })
    .click();
  await expect(
    adminPage.getByRole("heading", {
      name: "Agents under Browser Branch",
      exact: true,
    }),
  ).toBeVisible();
  await expect(adminPage.locator("tbody tr")).toHaveCount(2);
  await expect(
    adminPage.locator("tbody tr").filter({ hasText: agentEmail }),
  ).toHaveCount(1);
  await adminPage
    .locator("tbody tr")
    .filter({ hasText: agentEmail })
    .getByRole("button", { name: "Total Users (1)", exact: true })
    .click();
  await expect(
    adminPage.getByRole("heading", {
      name: "Users under Browser Agent",
      exact: true,
    }),
  ).toBeVisible();
  await expect(adminPage.locator("tbody tr")).toHaveCount(1);
  // Agent has only its own users option, including on a direct URL/reload.
  await agentPage.goto("http://127.0.0.1:4186/agent/users");
  await agentPage.getByPlaceholder("Email", { exact: true }).fill(agentEmail);
  await agentPage
    .getByPlaceholder("Password", { exact: true })
    .fill("Network@Test123");
  await agentPage.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    agentPage.getByRole("heading", { name: "B2B users", exact: true }),
  ).toBeVisible();
  await expect(agentPage.locator(".net-directory-counts strong")).toHaveText(
    "1",
  );
  await expect(
    agentPage.getByRole("link", { name: "Total Agents", exact: true }),
  ).toHaveCount(0);
  await agentPage.reload();
  await expect(agentPage.locator("tbody tr")).toHaveCount(1);
  await agentPage.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await agentPage.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2,
    ),
  );
  await agentPage.screenshot({
    path: resolve(root, "tmp/network-browser/agent-user-totals-mobile.png"),
    fullPage: true,
  });
  const publicPage = await browser.newPage();
  await publicPage.goto("http://127.0.0.1:4181/login");
  await publicPage.getByText("B2B Player Login", { exact: true }).waitFor();
  assert.equal(
    await publicPage.getByRole("tab", { name: "Create", exact: true }).count(),
    0,
  );
  await publicPage.goto("http://127.0.0.1:4181/signup");
  await publicPage
    .getByText("Only your agent can create a B2B account.", { exact: false })
    .waitFor();
  await publicPage.goto("http://127.0.0.1:4180/login");
  await publicPage.getByRole("tab", { name: "Create", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: separate agent/user totals, per-master and per-agent directories, zero-user agents, searches, direct URLs and reloads, same-browser session isolation, live funding, ledgers, mobile layout and B2B/B2C separation.",
  );
} finally {
  await browser?.close();
  await Promise.all(
    gateways.map(
      (gateway) =>
        new Promise((resolve) => {
          for (const client of gateway.clients) client.terminate();
          gateway.close(resolve);
        }),
    ),
  );
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  await pool.end();
}
