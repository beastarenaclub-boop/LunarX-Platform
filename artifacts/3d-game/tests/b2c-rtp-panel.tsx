import React from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {B2cRtp} from "../../../lib/api-client-react/src/b2c-rtp";
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient()}><B2cRtp/></QueryClientProvider>);
