import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NetworkRtp } from "../../../lib/api-client-react/src/network-rtp";
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient()}><NetworkRtp /></QueryClientProvider>);
