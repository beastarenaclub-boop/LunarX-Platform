import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Layout } from "@/components/Layout";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import UsersPage from "@/pages/users";
import UserDetail from "@/pages/user-detail";
import AccessHistoryPage from "@/pages/access-history";
import KycPage from "@/pages/kyc";
import BetsPage from "@/pages/bets";
import RoundProfitPage from "@/pages/round-profit";
import DepositsPage from "@/pages/deposits";
import WithdrawalsPage from "@/pages/withdrawals";
import ReconciliationPage from "@/pages/reconciliation";
import BonusPage from "@/pages/bonus";
import FreeBetsPage from "@/pages/free-bets";
import PromotionsPage from "@/pages/promotions";
import FraudPage from "@/pages/fraud";
import AuditPage from "@/pages/audit";
import LogsPage from "@/pages/logs";
import RtpConfigPage from "@/pages/rtp-config";
import GamesPage from "@/pages/games";
import LotteryPage from "@/pages/lottery";
import PrizeLottoAdmin from "@/pages/prize-lotto";
import SupportPage from "@/pages/support";
import BannersPage from "@/pages/banners";
import NotificationsPage from "@/pages/notifications";
import DemoNudgePage from "@/pages/demo-nudge";
import AgentsPage from "@/pages/agents";
import NetworkPage from "@/pages/network";
import PartnersPage from "@/pages/partners";
import PartnerDetailPage from "@/pages/partner-detail";
import DeveloperDocsPage from "@/pages/developer-docs";
import IntegrationDemoPage from "@/pages/integration-demo";
import NotFound from "@/pages/not-found";
import B2CWebsite from "@/pages/b2c-website";

function ProtectedRoutes() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Loading...
      </div>
    );
  }
  if (!user) return <Login />;
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/users" component={UsersPage} />
        <Route path="/access" component={AccessHistoryPage} />
        <Route path="/users/:id" component={UserDetail} />
        <Route path="/kyc" component={KycPage} />
        <Route path="/bets" component={BetsPage} />
        <Route path="/round-profit" component={RoundProfitPage} />
        <Route path="/deposits" component={DepositsPage} />
        <Route path="/withdrawals" component={WithdrawalsPage} />
        <Route path="/reconciliation" component={ReconciliationPage} />
        <Route path="/bonus" component={BonusPage} />
        <Route path="/free-bets" component={FreeBetsPage} />
        <Route path="/promotions" component={PromotionsPage} />
        <Route path="/support" component={SupportPage} />
        <Route path="/banners" component={BannersPage} />
        <Route path="/notifications" component={NotificationsPage} />
        <Route path="/demo-nudge" component={DemoNudgePage} />
        <Route path="/fraud" component={FraudPage} />
        <Route path="/agents" component={AgentsPage} />
        <Route path="/network" component={NetworkPage} />
        <Route path="/b2c-website" component={B2CWebsite} />
        <Route path="/partners/:id" component={PartnerDetailPage} />
        <Route path="/partners" component={PartnersPage} />
        <Route path="/developer-docs" component={DeveloperDocsPage} />
        <Route path="/integration-demo" component={IntegrationDemoPage} />
        <Route path="/audit" component={AuditPage} />
        <Route path="/logs" component={LogsPage} />
        <Route path="/rtp" component={RtpConfigPage} />
        <Route path="/games" component={GamesPage} />
        <Route path="/lottery" component={LotteryPage} />
        <Route path="/prize-lotto" component={PrizeLottoAdmin} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <ProtectedRoutes />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
