import { Profiler } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import JetXBetDock from "../../../src/components/lunar/JetXBetDock";
import { store } from "../../../src/game/store";

let commits = 0;
store.setState({ phase: "flying", roundId: "crash-performance", balance: 10000 });
const harness = {
  commits: () => commits,
  update: (patch: Parameters<typeof store.setState>[0]) => flushSync(() => store.setState(patch)),
  tick: () => {
    for (let i = 1; i <= 60; i++) {
      flushSync(() => store.setState({ flyMs: i * 16, multiplier: 1 + i / 100, countdownMs: 10000 - i * 16 }));
    }
  },
};
Object.assign(window, { performanceHarness: harness });
createRoot(document.getElementById("root")!).render(
  <Profiler id="bet-controls" onRender={() => { commits++; }}><JetXBetDock /></Profiler>,
);
