import { useState } from "react";
import { B2cRtp } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GameControlPanel } from "./game-control";

export default function B2cRtpPage() {
  const {user} = useAuth();
  const [section, setSection] = useState("modes");
  if (user?.role !== "admin" && user?.role !== "super_admin") return <p>Only admin can manage B2C Game Control.</p>;
  return <div className="max-w-6xl space-y-6">
    <header>
      <h1 className="text-2xl font-semibold">B2C Game Control</h1>
      <p className="mt-2 text-slate-600">Manage game modes, loss budgets and B2C player RTP from one place.</p>
    </header>
    <Tabs value={section} onValueChange={setSection}>
      <TabsList aria-label="B2C controls" className="mb-4 grid h-auto w-full grid-cols-2 sm:w-fit">
        <TabsTrigger value="modes" className="whitespace-normal">Result modes &amp; budgets</TabsTrigger>
        <TabsTrigger value="rtp" className="whitespace-normal">B2C player RTP</TabsTrigger>
      </TabsList>
      <TabsContent value="modes" forceMount className="space-y-5 data-[state=inactive]:hidden">
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          Normal, Collect, Distribute, Auto and RTP are available for connected table games, including American Roulette, Mini Roulette and Fun Target.
          {" "}These settings apply to shared table rounds for both B2C and agent players.
          {" "}For Aviator / Lunar and other independent games, use the B2C player RTP tab or Game Defaults.
        </p>
        <GameControlPanel embedded initialGame="roulette-american" />
      </TabsContent>
      <TabsContent value="rtp" forceMount className="data-[state=inactive]:hidden">
        <B2cRtp embedded initialGame="lunar" />
      </TabsContent>
    </Tabs>
  </div>;
}
