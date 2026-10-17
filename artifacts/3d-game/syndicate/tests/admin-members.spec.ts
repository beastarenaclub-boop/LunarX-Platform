import { browserConnected } from "./location-fixture";
import {
  connectedAuth,
  fixtureLocation,
  browserLocation,
} from "./location-fixture";
import { test, expect } from "@playwright/test";
import { completeEntry } from "./entry-fixture";
import { QUICK_BANKS } from "../src/live/banks";

test("admin sees unfinished signup, complete draft details, missing files and protected previews", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(90000);
  const adminHeaders = await connectedAuth(request, {
    "oai-authenticated-user-id": "qa-admin",
    "oai-authenticated-user-email": "qa-admin@test.invalid",
  });
  let admin = await (
    await request.get("/api/state", { headers: adminHeaders })
  ).json();
  if (!admin.me) {
    expect(
      (
        await request.post("/api/register", {
          headers: adminHeaders,
          data: {
            name: "QA Administrator",
            city: "Test city",
            company: "QA Workspace",
            business: "QA processing records",
            license: "TEST ONLY",
            owned: true,
          },
        })
      ).status(),
    ).toBe(200);
    admin = await (
      await request.get("/api/state", { headers: adminHeaders })
    ).json();
  }
  const sponsor = admin.members.find(
    (m: any) => !admin.members.some((c: any) => c.parent === m.id),
  );
  const suffix = crypto.randomUUID().slice(0, 8),
    name = "Review QA " + suffix,
    email = `review-${suffix}@test.invalid`;
  const customer = await browser.newContext({
    ...browserLocation,
    baseURL: "http://127.0.0.1:5201",
    extraHTTPHeaders: {
      "cf-connecting-ip": `2001:db8:1:2:3:4:${suffix.slice(0, 4)}:${suffix.slice(4)}`,
    },
  });
  try {
    await completeEntry(customer.request);
    const signup = await customer.request.post("/api/auth/signup", {
      data: {
        location: fixtureLocation(),
        name,
        email,
        password: "Review-" + crypto.randomUUID(),
      },
    });
    expect(signup.status(), await signup.text()).toBe(200);
    admin = await (
      await request.get("/api/state", { headers: adminHeaders })
    ).json();
    expect(admin.registrations.some((r: any) => r.email === email)).toBe(true);
    expect(JSON.stringify(admin.registrations)).not.toMatch(
      /password_hash|recovery_hash|email:/,
    );
    await browserConnected(page, adminHeaders);
    await page.route("http://127.0.0.1:5201/**", (route) =>
      route.continue({
        headers: { ...route.request().headers(), ...adminHeaders },
      }),
    );
    await page.goto("/login");
    await page
      .getByRole("button", { name: "Members & documents", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Signup started — profile not completed",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: email, exact: true }),
    ).toBeVisible();
    const create = await customer.request.post("/api/register", {
      data: {
        name,
        email,
        city: "QA Jaipur",
        ref: sponsor.ref,
        banks: QUICK_BANKS,
      },
    });
    expect(create.status(), await create.text()).toBe(200);
    let member = await (await customer.request.get("/api/state")).json();
    expect(member.registrations).toEqual([]);
    const account = {
      id: crypto.randomUUID(),
      bank: "YES Bank",
      type: "Current",
      last4: "9216",
      holder: "QA Trading",
      contact: 0,
      requestedLimit: 5000000,
      approvedLimit: 0,
      status: "Pending",
      owned: true,
    };
    const profile = {
      firm: "QA Trading",
      gst: "27ABCDE1234F1Z5",
      contacts: [
        { label: "Owner SIM", last4: "3489" },
        { label: "Office SIM", last4: "5690" },
      ],
      accounts: [account],
      ownership: true,
      consent: true,
    };
    expect(
      (
        await customer.request.post("/api/profile", {
          data: { profile, draft: true, revision: member.me.revision },
        })
      ).status(),
    ).toBe(200);
    const file = {
      name: "shop-evidence.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6p8AAAAASUVORK5CYII=",
        "base64",
      ),
    };
    for (const kind of ["Shop proof", "Bank account proof"]) {
      const upload = await customer.request.post("/api/documents", {
        multipart: { kind, accountId: account.id, file },
      });
      expect(upload.status(), await upload.text()).toBe(200);
    }
    member = await (await customer.request.get("/api/state")).json();
    await page
      .getByRole("button", { name: "Refresh workspace", exact: true })
      .click();
    await page.getByLabel("Search members").fill(email);
    await expect(
      page.getByText("1/5 current · 0/2 savings", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("1/7 proofs · 1/7 KYC", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: `View complete profile for ${name}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Member & business details",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("27ABCDE1234F1Z5", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Owner SIM · •••• 3489", { exact: false }).first(),
    ).toBeVisible();
    await expect(page.getByText("•••• 9216", { exact: true })).toBeVisible();
    const missing = page
      .locator(".admin-file-card")
      .filter({ hasText: "Video KYC" });
    await expect(missing.getByText("Missing", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Preview Shop proof", exact: true })
      .click();
    const preview = page.getByRole("dialog", { name: "Document preview" });
    await expect(
      preview.getByRole("img", { name: "Shop proof", exact: true }),
    ).toBeVisible();
    const doc = member.documents.find((d: any) => d.kind === "Shop proof");
    const response = await request.get(`/api/documents/${doc.id}?view=1`, {
      headers: adminHeaders,
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-disposition"]).toMatch(/^inline;/);
    expect(
      (await request.get(`/api/documents/${doc.id}?view=1`)).status(),
    ).toBe(401);
    const other = await browser.newContext({
      ...browserLocation,
      baseURL: "http://127.0.0.1:5201",
    });
    try {
      const peerHeaders = await connectedAuth(other.request, {
        "oai-authenticated-user-id": "qa-peer-" + suffix,
        "oai-authenticated-user-email": `peer-${suffix}@test.invalid`,
      });
      expect(
        (
          await other.request.post("/api/register", {
            headers: peerHeaders,
            data: {
              name: "QA Peer " + suffix,
              city: "QA city",
              ref: sponsor.ref,
              banks: QUICK_BANKS,
            },
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await other.request.get(`/api/documents/${doc.id}?view=1`, {
            headers: peerHeaders,
          })
        ).status(),
      ).toBe(403);
    } finally {
      await other.close();
    }
    await preview
      .getByRole("button", { name: "Close document preview" })
      .click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: "test-results/admin-member-dossier.png",
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/admin-member-mobile.png",
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Back to all members" }).click();
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .getByRole("button", { name: "New member signup", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "Open new signup" }),
    ).toHaveAttribute("href", /^\/member\/signup\?ref=SYN-/);
  } finally {
    await customer.close();
  }
});
