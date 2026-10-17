import { browserConnected } from "./location-fixture";
import { connectedAuth, browserLocation } from "./location-fixture";
import { test, expect } from "@playwright/test";
import { accountProofKind } from "../src/live/types";

test("signed-in member saves individual bank accounts, uploads private proofs and sees persistent counts", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const auth = (id: string) =>
    connectedAuth(request, {
      "oai-authenticated-user-id": id,
      "oai-authenticated-user-email": id + "@test.invalid",
    });
  const state = async (id: string) => {
    const response = await request.get("/api/state", {
      headers: await auth(id),
    });
    expect(response.status()).toBe(200);
    return response.json();
  };
  const admin = await state("qa-admin");
  const sponsor = admin.members.find(
    (m: any) => !admin.members.some((other: any) => other.parent === m.id),
  );
  expect(
    sponsor,
    "live.spec.ts creates the isolated QA workspace",
  ).toBeTruthy();
  const identity = "qa-accounts-" + Date.now().toString(36);
  const registered = await request.post("/api/register", {
    headers: await auth(identity),
    data: {
      name: identity,
      city: "QA city",
      ref: sponsor.ref,
      banks: [
        "IDFC FIRST Bank",
        "Axis Bank",
        "YES Bank",
        "AU Small Finance Bank",
        "ICICI Bank",
      ],
    },
  });
  expect(registered.status(), await registered.text()).toBe(200);
  await browserConnected(page, await auth(identity));
  await page.route("http://127.0.0.1:5201/**", async (route) =>
    route.continue({
      headers: { ...route.request().headers(), ...(await auth(identity)) },
    }),
  );
  await page.addInitScript(() =>
    sessionStorage.setItem("syndicate-live-entry", "1"),
  );
  await page.goto("/member/dashboard");
  const count = (label: string) => page.getByLabel(label, { exact: true });
  await expect(count("Current accounts saved")).toContainText("0 / 5");
  await page.getByRole("button", { name: "Add accounts & upload" }).click();
  const first = page.getByRole("region", {
    name: "Current account 1",
    exact: true,
  });
  await expect(
    page.getByLabel("Bank for account 1", { exact: true }),
  ).toHaveValue("IDFC FIRST Bank");
  for (const bank of [
    "HDFC Bank",
    "Axis Bank",
    "YES Bank",
    "AU Small Finance Bank",
    "ICICI Bank",
  ])
    await expect(
      first.locator("option", { hasText: bank }).first(),
    ).toHaveCount(1);
  await expect(
    page.getByLabel("Upload bank proof for account 1", { exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Bank for account 1", { exact: true })
    .selectOption("Axis Bank");
  await first.getByLabel("Last four account digits").fill("4198");
  await first.getByLabel("Owner / authorized signatory confirmed").check();
  await page
    .getByLabel("I am the owner or authorized business signatory.", {
      exact: false,
    })
    .check();
  await page
    .getByLabel("I consent to storing masked references", { exact: false })
    .check();
  await first.getByRole("button", { name: "Save account details" }).click();
  await expect(count("Current accounts saved")).toContainText("1 / 5");
  await expect(count("Savings accounts saved")).toContainText("0 / 2");
  await expect(
    page.getByLabel("Bank for account 2", { exact: true }),
  ).toHaveValue("Axis Bank");
  await expect(
    page.getByLabel("Bank for account 7", { exact: true }),
  ).toBeVisible();
  let member = await state(identity);
  expect(member.me.profile.accounts).toHaveLength(1);
  expect(member.me.profile.accounts[0].bank).toBe("Axis Bank");
  expect(member.me.profile.gst).toBe("");
  const proofInput = page.getByLabel("Upload bank proof for account 1", {
    exact: true,
  });
  await expect(proofInput).toBeEnabled();
  await proofInput.setInputFiles({
    name: "axis-current-4198.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nQA redacted bank evidence\n%%EOF"),
  });
  await expect(count("Bank proofs uploaded")).toContainText("1 / 7");
  await expect(first.getByText("axis-current-4198.pdf")).toBeVisible();
  await first.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "test-results/member-account-upload.png",
    animations: "disabled",
  });
  member = await state(identity);
  const proof = member.documents.find(
    (d: any) => d.kind === accountProofKind(member.me.profile.accounts[0]),
  );
  expect(proof).toBeTruthy();
  for (const id of [identity, "qa-admin"])
    expect(
      (
        await request.get("/api/documents/" + proof.id, {
          headers: await auth(id),
        })
      ).status(),
    ).toBe(200);
  const other = admin.members.find(
    (m: any) => m.role !== "admin" && m.profile.accounts?.length,
  );
  expect(
    (
      await request.get("/api/documents/" + proof.id, {
        headers: await auth(other.name),
      })
    ).status(),
  ).toBe(403);
  const foreign = await request.post("/api/documents", {
    headers: await auth(identity),
    multipart: {
      kind: "Bank account proof",
      accountId: other.profile.accounts[0].id,
      file: {
        name: "foreign.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4\n%%EOF"),
      },
    },
  });
  expect(foreign.status()).toBe(400);
  expect(
    (
      await request.post("/api/submit-profile", {
        headers: await auth(identity),
        data: { revision: member.me.revision },
      })
    ).status(),
  ).toBe(400);
  // A changed bank cannot inherit evidence from the previous bank, even with the same account ID.
  await page
    .getByLabel("Bank for account 1", { exact: true })
    .selectOption("HDFC Bank");
  await expect(proofInput).toBeDisabled();
  await first.getByRole("button", { name: "Save account details" }).click();
  await expect(count("Bank proofs uploaded")).toContainText("0 / 7");
  await expect(first.getByText("axis-current-4198.pdf")).toHaveCount(0);
  await page.reload();
  await expect(count("Current accounts saved")).toContainText("1 / 5");
  await page
    .getByRole("button", { name: "My bank accounts", exact: true })
    .click();
  await expect(
    page.getByLabel("Bank for account 1", { exact: true }),
  ).toHaveValue("HDFC Bank");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/member-accounts-mobile.png",
    animations: "disabled",
  });
});
