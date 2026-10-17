import { createRoot } from "react-dom/client";
import TradingTerminal from "../../src/components/forex/TradingTerminal";
createRoot(document.getElementById("root")!).render(
  <TradingTerminal standalone />,
);
