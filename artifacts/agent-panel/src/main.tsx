import { createRoot } from "react-dom/client";
import { setOperatorPanel } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

setOperatorPanel(/^\/master(?:\/|$)/.test(window.location.pathname) ? "master" : "agent");
createRoot(document.getElementById("root")!).render(<App />);
