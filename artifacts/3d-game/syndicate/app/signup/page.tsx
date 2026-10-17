import LiveApp from "../../src/live/LiveApp";
import { guardEntryPage } from "../../lib/entry-page";
export const dynamic = "force-dynamic";
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await guardEntryPage("/signup", await searchParams);
  return <LiveApp portal="member" accessMode="signup" />;
}
