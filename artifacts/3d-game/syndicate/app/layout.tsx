import type { Metadata } from "next";
import EntryAudioLifecycle from "../src/live/EntryAudioLifecycle";
import "../src/styles.css";
import "../src/live/live.css";
import "../src/live/entry-game.css";
import "../src/live/agent-journey.css";
import "../src/live/cyber-backdrop.css";
import "../src/live/earnings-scene.css";
import "../src/live/visitor-checkin.css";
import "../src/live/performance.css";
import "../src/live/tree-commission.css";

export const metadata: Metadata = {
  title: "SYNDICATE — Merchant Operations",
  description:
    "Merchant onboarding, team tasks, transaction reporting and accountable reviews.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <EntryAudioLifecycle />
        {children}
      </body>
    </html>
  );
}
