import { test as base, expect, type APIRequestContext } from "@playwright/test";

// Walk the real public game protocol for unrelated account tests; no bypass key.
export async function completeEntry(request: APIRequestContext) {
  async function step(action: string, data = {}) {
    const response = await request.post("/api/entry/" + action, { data });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  }
  await step("start");
  const { walkAfter } = await step("puzzle", { angles: [0, 0, 0] });
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, walkAfter - Date.now()) + 50),
  );
  await step("arrive");
  for (let spot = 0; spot < 3; spot++)
    if ((await step("search", { spot })).found) break;
  await step("pickup");
  await step("unlock");
}

export const test = base.extend<{ entryAccess: void }>({
  entryAccess: [
    async ({ context, request }, use) => {
      await Promise.all([
        completeEntry(context.request),
        completeEntry(request),
      ]);
      await use();
    },
    { auto: true },
  ],
});
export { expect };
