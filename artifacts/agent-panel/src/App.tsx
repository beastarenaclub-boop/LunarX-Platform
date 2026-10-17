import {
  Switch,
  Route,
  Router as WouterRouter,
  useLocation,
  useSearch,
} from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Layout } from "@/components/Layout";
import Login from "@/pages/login";
import { NetworkPanel, getOperatorPanel } from "@workspace/api-client-react";

function PanelPage({
  tab,
}: {
  tab: "Overview" | "Downline" | "Agents" | "Players";
}) {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  return (
    <NetworkPanel
      key={`${tab}:${search}`}
      initialTab={tab}
      initialAgentId={tab === "Players" ? (params.get("agent") ?? "") : ""}
      initialMasterId={tab === "Agents" ? (params.get("master") ?? "") : ""}
      onBrowse={(section, nodeId) =>
        navigate(
          `${section === "Agents" ? "/agents" : "/users"}${nodeId ? `?${section === "Agents" ? "master" : "agent"}=${encodeURIComponent(nodeId)}` : ""}`,
        )
      }
    />
  );
}

function DownlinePage() {
  return <PanelPage tab="Downline" />;
}

function OverviewPage() {
  return <PanelPage tab="Overview" />;
}

function AgentsPage() {
  return (
    <PanelPage tab={getOperatorPanel() === "master" ? "Agents" : "Players"} />
  );
}

function UsersPage() {
  return <PanelPage tab="Players" />;
}

function ProtectedRoutes() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Loading…
      </div>
    );
  }
  if (!user) return <Login />;
  return (
    <Layout>
      <Switch>
        <Route path="/downline" component={DownlinePage} />
        <Route path="/agents" component={AgentsPage} />
        <Route path="/users" component={UsersPage} />
        <Route path="/" component={OverviewPage} />
        <Route component={OverviewPage} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter
            base={
              window.location.pathname.startsWith("/master")
                ? "/master"
                : import.meta.env.BASE_URL.replace(/\/$/, "")
            }
          >
            <ProtectedRoutes />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
