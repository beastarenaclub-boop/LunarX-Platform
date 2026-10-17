import LiveApp from "../../src/live/LiveApp";
import { guardEntryPage } from "../../lib/entry-page";
export const dynamic = "force-dynamic";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await guardEntryPage("/login", await searchParams);
  return <LiveApp accessMode="login" />;
}
