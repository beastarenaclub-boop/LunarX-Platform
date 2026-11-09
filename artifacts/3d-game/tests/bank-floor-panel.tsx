import React from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {NetworkBankFloor} from "../../../lib/api-client-react/src/network-bank-floor";
import panelSource from "../../../lib/api-client-react/src/network-panel.tsx?raw";
const styles=panelSource.match(/const styles = `([^`]+)`;/)?.[1]??"";
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><style>{styles}</style><div className="net-panel" style={{maxWidth:1200,margin:"20px auto"}}><NetworkBankFloor/></div></QueryClientProvider>);
