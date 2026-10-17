import { notFound } from "next/navigation";
import { guardEntryPage } from "../../../lib/entry-page";
import LiveApp from "../../../src/live/LiveApp";
import { PORTALS, type Portal } from "../../../src/live/portals";

export const dynamic = "force-dynamic";
export default async function PortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ portal: string; screen: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { portal, screen } = await params;
  if (
    !PORTALS.includes(portal as Portal) ||
    !["login", "signup", "dashboard"].includes(screen) ||
    (screen === "signup" && portal !== "member")
  )
    notFound();
  await guardEntryPage(`/${portal}/${screen}`, await searchParams);
  return (
    <LiveApp
      portal={portal as Portal}
      accessMode={
        screen === "dashboard" ? undefined : (screen as "login" | "signup")
      }
    />
  );
}
