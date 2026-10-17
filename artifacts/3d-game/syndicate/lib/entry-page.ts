import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { entryComplete, ENTRY_COOKIE } from "./entry-access";

export async function guardEntryPage(
  path: string,
  query: Record<string, string | string[] | undefined> = {},
) {
  const jar = await cookies();
  if (await entryComplete(jar.get(ENTRY_COOKIE)?.value || "")) return;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) value.forEach((item) => search.append(key, item));
    else if (value !== undefined) search.set(key, value);
  }
  const next = path + (search.size ? "?" + search.toString() : "");
  redirect("/?next=" + encodeURIComponent(next));
}
