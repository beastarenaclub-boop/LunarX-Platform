import { browserConnected } from "./location-fixture";
import { connectedAuth, browserLocation } from "./location-fixture";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { dayIST } from "../src/live/types";
import { rangeFor, totals } from "../src/live/reporting";
const rawHeaders = (id: string) => ({
  "oai-authenticated-user-id": id,
  "oai-authenticated-user-email": id + "@test.invalid",
  "oai-authenticated-user-full-name": id,
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  "cf-connecting-ip": "198.51.100.20",
});
const banks = [
  "HDFC Bank",
  "Axis Bank",
  "YES Bank",
  "AU Small Finance Bank",
  "ICICI Bank",
];
test("date boundaries and approved financial totals retain paise", () => {
  expect(rangeFor("Yesterday", "2026-03-01")).toEqual({
    from: "2026-02-28",
    to: "2026-02-28",
  });
  expect(rangeFor("Last month", "2024-03-19")).toEqual({
    from: "2024-02-01",
    to: "2024-02-29",
  });
  expect(
    totals([
      { kind: "Income", amount_paise: 100050, status: "Approved" },
      { kind: "Expense", amount_paise: 10025, status: "Approved" },
      { kind: "Turnover", amount_paise: 1000000, status: "Approved" },
      { kind: "Income", amount_paise: 900000, status: "Pending" },
    ] as any),
  ).toMatchObject({
    turnover: 1000000,
    income: 100050,
    expense: 10025,
    net: 90025,
    pending: 1,
  });
});
test("database, privacy, binary positions, KYC, roles, tasks, API imports and export UI", async ({
  request,
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const headers = (id: string) => connectedAuth(request, rawHeaders(id));
  async function get(id: string) {
    const r = await request.get("/api/state", { headers: await headers(id) });
    expect(r.status(), await r.text()).toBe(200);
    return r.json();
  }
  async function post(id: string, path: string, data: any, status = 200) {
    const r = await request.post("/api/" + path, {
      timeout: 10000,
      headers: await headers(id),
      data,
    });
    expect(r.status(), await r.text()).toBe(status);
    return r.json();
  }
  expect((await request.get("/api/state")).status()).toBe(401);
  const devAnonymous = await request.get("http://127.0.0.1:5198/api/state", {
    headers: await headers("forged-admin"),
  });
  expect(devAnonymous.status()).toBe(401);
  const admin = "qa-admin";
  let adminState = await get(admin);
  if (!adminState.me) {
    expect(adminState.setupRequired).toBe(true);
    await post(admin, "register", {
      name: "QA Administrator",
      city: "Test city",
      company: "QA Licensed Merchant Workspace",
      business: "Test payment processing records",
      license: "TEST ONLY - not a real license",
      owned: true,
    });
    adminState = await get(admin);
  }
  const tag = Date.now().toString(36),
    a = "qa-a-" + tag,
    b = "qa-b-" + tag,
    c = "qa-c-" + tag,
    d = "qa-d-" + tag,
    extra = "qa-extra-" + tag;
  const sponsor =
    adminState.members.find(
      (m: any) =>
        adminState.members.filter((n: any) => n.parent === m.id).length === 0,
    ) || adminState.me;
  for (const id of [a, b])
    await post(id, "register", {
      name: id,
      city: "Test city",
      ref: sponsor.ref,
      banks,
    });
  await post(
    extra,
    "register",
    { name: extra, city: "Test city", ref: sponsor.ref, banks },
    409,
  );
  let as = await get(a);
  for (const id of [c, d])
    await post(id, "register", {
      name: id,
      city: "Test city",
      ref: as.me.ref,
      banks,
    });
  await post(
    a,
    "tasks",
    {
      title: "Unauthorized",
      description: "Should fail",
      assignee: as.me.id,
      due: dayIST(),
    },
    403,
  );
  async function complete(id: string) {
    let s = await get(id);
    const profile = {
      firm: "Test Merchant " + id,
      gst: "27ABCDE1234F1Z5",
      contacts: [
        { label: "Registered one", last4: "1234" },
        { label: "Registered two", last4: "5678" },
      ],
      accounts: Array.from({ length: 7 }, (_, i) => ({
        id: crypto.randomUUID(),
        bank: banks[i % 5],
        type: i < 5 ? "Current" : "Savings",
        last4: String(2000 + i),
        holder: "Test Merchant",
        contact: i % 2,
        requestedLimit: i < 5 ? 5000000 : 0,
        approvedLimit: 0,
        status: "Pending",
        owned: true,
      })),
      ownership: true,
      consent: true,
    };
    await post(id, "profile", { profile, revision: s.me.revision });
    await post(id, "profile", { profile, revision: s.me.revision }, 409);
    s = await get(id);
    await post(id, "submit-profile", { revision: s.me.revision }, 400);
    for (const kind of [
      "Shop proof",
      "Firm registration",
      "Rent agreement",
      "Electricity bill",
      "Identity proof",
      "GST document",
      "Video KYC",
    ]) {
      const video = kind === "Video KYC";
      const response = await request.post("/api/documents", {
        headers: await headers(id),
        multipart: {
          kind,
          file: {
            name: video ? "test.mp4" : "test.pdf",
            mimeType: video ? "video/mp4" : "application/pdf",
            buffer: video
              ? Buffer.from([
                  0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0,
                  0,
                ])
              : Buffer.from("%PDF-1.4\n%%EOF"),
          },
        },
      });
      expect(response.status(), await response.text()).toBe(200);
    }
    await post(id, "submit-profile", { revision: s.me.revision }, 400);
    for (const account of profile.accounts) {
      const response = await request.post("/api/documents", {
        headers: await headers(id),
        multipart: {
          kind: "Bank account proof",
          accountId: account.id,
          file: {
            name: "bank-proof.pdf",
            mimeType: "application/pdf",
            buffer: Buffer.from("%PDF-1.4\n%%EOF"),
          },
        },
      });
      expect(response.status(), await response.text()).toBe(200);
    }
    s = await get(id);
    await post(id, "submit-profile", { revision: s.me.revision });
    s = await get(id);
    await post(id, "profile", { profile, revision: s.me.revision }, 409);
    await post(admin, "review-profile", {
      member: s.me.id,
      revision: s.me.revision,
      decision: "approve",
      note: "QA evidence reviewed",
      limits: Object.fromEntries(
        profile.accounts
          .filter((x) => x.type === "Current")
          .map((x) => [x.id, 5000000]),
      ),
    });
    return get(id);
  }
  as = await complete(a);
  expect(as.me.role).toBe("user");
  const cs = await complete(c),
    ds = await complete(d);
  as = await get(a);
  expect(as.me.role).toBe("agent");
  expect(
    as.members.find((m: any) => m.id === cs.me.id).profile.accounts,
  ).toBeUndefined();
  expect(as.documents.every((x: any) => x.member_id === as.me.id)).toBe(true);
  const ownDoc = as.documents[0];
  expect(
    (
      await request.get("/api/documents/" + ownDoc.id, {
        headers: await headers(b),
      })
    ).status(),
  ).toBe(403);
  const download = await request.get("/api/documents/" + ownDoc.id, {
    headers: await headers(a),
  });
  expect(download.status()).toBe(200);
  expect(download.headers()["content-disposition"]).toContain("attachment");
  await post(a, "tasks", {
    title: "Reconcile settlement " + tag,
    description: "Compare approved bank records and report any difference.",
    assignee: cs.me.id,
    due: dayIST(),
  });
  let task = (await get(c)).tasks[0];
  await post(b, "task-status", { id: task.id, status: "In progress" }, 403);
  await post(c, "task-status", { id: task.id, status: "In progress" });
  await post(c, "task-status", { id: task.id, status: "In review" });
  await post(a, "task-status", { id: task.id, status: "Complete" });
  expect((await get(c)).tasks[0].status).toBe("Complete");
  const account = as.me.profile.accounts[0].id;
  const body = {
    member: as.me.id,
    account,
    kind: "Turnover",
    amount: "10000.00",
    reference: "vol-" + tag,
    date: dayIST(),
    description: "Verified test processing volume",
  };
  const original = await post(a, "entries", body);
  expect((await post(a, "entries", body)).duplicate).toBe(true);
  await post(a, "entries", { ...body, amount: "10.00" }, 409);
  await post(
    a,
    "entries",
    { ...body, reference: "invalid-" + tag, amount: "1.001" },
    400,
  );
  await post(a, "review-entry", { id: original.id, status: "Approved" }, 403);
  await post(admin, "review-entry", { id: original.id, status: "Approved" });
  await post(
    admin,
    "review-entry",
    { id: original.id, status: "Approved" },
    409,
  );
  for (const [kind, amount] of [
    ["Income", "1000.50"],
    ["Expense", "100.25"],
  ]) {
    const entry = await post(a, "entries", {
      ...body,
      kind,
      amount,
      reference: kind + "-" + tag,
    });
    if (kind === "Expense") {
      await post(
        admin,
        "review-entry",
        { id: entry.id, status: "Approved" },
        400,
      );
      const receipt = await request.post("/api/documents", {
        headers: await headers(a),
        multipart: {
          kind: "Expense receipt",
          entryId: entry.id,
          file: {
            name: "receipt.pdf",
            mimeType: "application/pdf",
            buffer: Buffer.from("%PDF-1.4\n%%EOF"),
          },
        },
      });
      expect(receipt.status(), await receipt.text()).toBe(200);
    }
    await post(admin, "review-entry", { id: entry.id, status: "Approved" });
    if (kind === "Expense") {
      const receipt = (await get(a)).documents.find(
        (d: any) => d.kind === "Expense receipt:" + entry.id,
      );
      expect(receipt).toBeTruthy();
      expect(
        (
          await request.get("/api/documents/" + receipt.id, {
            headers: await headers(b),
          })
        ).status(),
      ).toBe(403);
      expect(
        (
          await request.get("/api/documents/" + receipt.id, {
            headers: await headers(admin),
          })
        ).status(),
      ).toBe(200);
      for (const [identity, status] of [
        [a, 409],
        [b, 403],
      ] as const) {
        const replacement = await request.post("/api/documents", {
          headers: await headers(identity),
          multipart: {
            kind: "Expense receipt",
            entryId: entry.id,
            file: {
              name: "replacement.pdf",
              mimeType: "application/pdf",
              buffer: Buffer.from("%PDF-1.4\n%%EOF"),
            },
          },
        });
        expect(replacement.status(), await replacement.text()).toBe(status);
      }
    }
  }
  expect(totals((await get(a)).entries).net).toBe(90025);
  expect((await get(b)).entries).toHaveLength(0);
  const api = await post(admin, "tokens", { name: "QA integration " + tag });
  const apiResponse = await request.post("/api/entries", {
    headers: { Authorization: "Bearer " + api.token },
    data: { ...body, reference: "api-" + tag },
  });
  expect(apiResponse.status()).toBe(200);
  const apiState = await get(admin);
  expect(
    apiState.entries.find((e: any) => e.reference === "api-" + tag).source,
  ).toBe("API");
  expect(JSON.stringify(apiState)).not.toContain(api.token);
  const token = apiState.tokens.find(
    (t: any) => t.name === "QA integration " + tag,
  );
  await post(admin, "revoke-token", { id: token.id });
  expect(
    (
      await request.post("/api/entries", {
        headers: { Authorization: "Bearer " + api.token },
        data: body,
      })
    ).status(),
  ).toBe(401);
  await post(
    a,
    "location",
    { consent: false, latitude: 20, longitude: 72 },
    400,
  );
  await post(a, "location", {
    consent: true,
    latitude: 20.123456,
    longitude: 72.456789,
    accuracy: 15,
  });
  expect(
    (await get(a)).audit.some(
      (e: any) =>
        e.action === "Location shared" &&
        JSON.parse(e.location).latitude === 20.12,
    ),
  ).toBe(true);
  expect(
    (
      await request.post("/api/entries", {
        headers: {
          ...(await headers(admin)),
          Origin: "https://unrelated.invalid",
        },
        data: body,
      })
    ).status(),
  ).toBe(403);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await browserConnected(page, await headers(a));
  await page.route("http://127.0.0.1:5201/**", async (route) =>
    route.continue({
      headers: { ...route.request().headers(), ...(await headers(a)) },
    }),
  );
  await page.goto("/agent/dashboard");
  await expect(
    page.getByRole("heading", { name: "Welcome back, " + a + "." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Wallet & ledger", exact: true })
    .click();
  await expect(page.locator(".wallet-hero strong")).toHaveText("₹900.25");
  const xlsxWait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Excel .xlsx" }).click();
  const xlsx = await xlsxWait;
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await xlsx.path())!);
  expect(workbook.getWorksheet("Summary")!.getCell("B5").value).toBe(900.25);
  const pdfWait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  const pdfDownload = await pdfWait;
  expect(
    (await readFile((await pdfDownload.path())!)).subarray(0, 5).toString(),
  ).toBe("%PDF-");
  await page.getByRole("button", { name: "Work & tasks", exact: true }).click();
  const taskWait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Task PDF", exact: true }).click();
  expect((await taskWait).suggestedFilename()).toBe("syndicate-tasks.pdf");
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.screenshot({
    path: "test-results/live-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Welcome back, " + a + "." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/live-mobile.png",
    animations: "disabled",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("button", { name: "Access & activity", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Access & audit trail" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  const memberPage = await browser.newPage(browserLocation);
  await browserConnected(memberPage, await headers(b));
  await memberPage.route("http://127.0.0.1:5201/**", async (route) =>
    route.continue({
      headers: { ...route.request().headers(), ...(await headers(b)) },
    }),
  );
  await memberPage.addInitScript(() =>
    sessionStorage.setItem("syndicate-live-entry", "1"),
  );
  await memberPage.goto("/member/dashboard");
  await memberPage
    .getByRole("button", { name: "My onboarding", exact: true })
    .click();
  await expect(
    memberPage.getByRole("heading", { name: "Five business current accounts" }),
  ).toBeVisible();
  await memberPage.screenshot({
    path: "test-results/live-onboarding.png",
    fullPage: true,
  });
  await memberPage.close();
  const allowanceBody = {
    ...body,
    kind: "Income",
    allowance: true,
    amount: "75.50",
    reference: "allowance-" + tag,
  };
  await post(a, "entries", allowanceBody, 403);
  const allowance = await post(admin, "entries", allowanceBody);
  expect(totals((await get(a)).entries).net).toBe(90025);
  await post(admin, "review-entry", { id: allowance.id, status: "Approved" });
  const finalState = await get(a);
  expect(
    finalState.entries.find((e: any) => e.id === allowance.id),
  ).toMatchObject({
    kind: "Income",
    source: "Allowance",
    amount_paise: 7550,
    status: "Approved",
  });
  expect(totals(finalState.entries).net).toBe(97575);
  const oldSettings = (await get(admin)).settings;
  const newSettings = {
    company: "QA updated " + tag,
    business: oldSettings.business,
    license: oldSettings.license,
  };
  await post(a, "workspace", newSettings, 403);
  try {
    await post(admin, "workspace", newSettings);
    expect((await get(a)).settings).toEqual(newSettings);
  } finally {
    await post(admin, "workspace", oldSettings);
  }
});
