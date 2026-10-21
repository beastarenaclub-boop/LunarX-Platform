import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { useBrowserLocation } from "wouter/use-browser-location";
import App from "./App";
import "./game/styles";
import "./index.css";
import "../../../lib/game-ui/controls.css";
import "../../../lib/game-ui/viewport.css";
import "../../../lib/game-ui/game-layouts.css";
import "./mobile.css";

// Standalone local entry for the existing game. It uses the real authentication,
// wallet and round API, without requiring the separate branch-branding service.
function useStudioLocation(): ReturnType<typeof useBrowserLocation> {
  const [location, navigate] = useBrowserLocation();
  return [
    location === "/teen-patti-2020.html" ? "/teen-patti-live" : location,
    navigate,
  ];
}
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 5000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <Router hook={useStudioLocation}>
      <App />
    </Router>
  </QueryClientProvider>,
);
