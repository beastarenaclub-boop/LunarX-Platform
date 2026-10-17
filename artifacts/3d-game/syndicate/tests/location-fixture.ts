import { completeEntry } from "./entry-fixture";
import type { APIRequestContext, Page } from "@playwright/test";

// Synthetic coordinates for QA only; no real device position is used by tests.
export const geolocation = {
  latitude: 26.9124,
  longitude: 75.7873,
  accuracy: 80,
};
export const fixtureLocation = () => ({
  ...geolocation,
  capturedAt: Date.now(),
  consent: true,
});
export const browserLocation = { geolocation, permissions: ["geolocation"] };
export async function browserConnected(
  page: Page,
  headers: Record<string, string>,
) {
  await completeEntry(page.context().request);
  const [name, value] = headers.Cookie.split("=");
  await page.context().addCookies([
    {
      name,
      value,
      url: "http://127.0.0.1:5201",
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
}
const grants = new WeakMap<
  APIRequestContext,
  Map<string, Promise<Record<string, string>>>
>();

export function connectedAuth(
  request: APIRequestContext,
  headers: Record<string, string>,
) {
  let accounts = grants.get(request);
  if (!accounts) {
    accounts = new Map();
    grants.set(request, accounts);
  }
  const identity = headers["oai-authenticated-user-id"];
  if (!accounts.has(identity))
    accounts.set(
      identity,
      (async () => {
        const response = await request.post("/api/auth/connected-location", {
          headers: { ...headers, Cookie: "" },
          data: { location: fixtureLocation() },
        });
        if (!response.ok()) throw Error(await response.text());
        return {
          ...headers,
          Cookie: response.headers()["set-cookie"].split(";")[0],
        };
      })(),
    );
  return accounts.get(identity)!;
}
