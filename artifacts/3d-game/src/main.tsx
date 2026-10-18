import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { B2C_STANDALONE } from "./components/b2c/config";
import { applyB2CBranding } from "./components/b2c/branding";
import "./game/styles";
import "./index.css";
import "../../../lib/game-ui/controls.css";
import "../../../lib/game-ui/viewport.css";
import "../../../lib/game-ui/game-layouts.css";
import "./mobile.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // ApiError instances expose a numeric `status` field. Don't retry on
        // 4xx (auth, validation, etc.) — they will not change on a re-fetch.
        const status = (error as { status?: unknown })?.status;
        if (typeof status === "number" && status >= 400 && status < 500) {
          return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
    mutations: { retry: false },
  },
});

export { queryClient };

if (B2C_STANDALONE) applyB2CBranding();

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);

