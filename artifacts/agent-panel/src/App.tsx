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
import { NetworkPanel, getOperatorPanel, type NetworkSection } from "@workspace/api-client-react";

const sectionRoutes: Record<NetworkSection, string> = {
  Overview: "/", Downline: "/downline", Agents: "/agents", Players: "/users",
  Ledger: "/ledger", Settlements: "/settlements", "Wallet ledger": "/transactions", Website: "/website",
  "Weekly account":"/weekly",
  "Payment history":"/payments",
  "Manual payments":"/manual-payments",
  "Collection report":"/collections",
};

function PanelPage({
  tab,
}: {
  tab: NetworkSection;
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
      onTabChange={section => navigate(sectionRoutes[section])}
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
        <Route path="/ledger"><PanelPage tab="Ledger" /></Route>
        <Route path="/settlements"><PanelPage tab="Settlements" /></Route>
        <Route path="/transactions"><PanelPage tab="Wallet ledger" /></Route>
        <Route path="/payments"><PanelPage tab="Payment history" /></Route>
        <Route path="/manual-payments"><PanelPage tab="Manual payments" /></Route>
        <Route path="/collections"><PanelPage tab="Collection report" /></Route>
        <Route path="/website"><PanelPage tab="Website" /></Route>
        <Route path="/weekly"><PanelPage tab="Weekly account" /></Route>
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
