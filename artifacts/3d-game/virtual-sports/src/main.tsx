import React from "react";
import { createRoot } from "react-dom/client";
import VirtualSports from "../../src/components/virtual-sports/VirtualSports";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <VirtualSports standalone />
  </React.StrictMode>,
);
