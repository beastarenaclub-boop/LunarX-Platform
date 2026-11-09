import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Redirect } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import LoadingScreen from "@/components/game/LoadingScreen";
import { useAuth } from "@/lib/auth";

const RummyRoyale = lazy(() => import("@/games/rummy/Rummy"));

// Keep an already-funded hand reachable while withdrawing the extra kit game.
// New visitors return to the original Rummy; the API refuses new Royale deals.
export default function FinishRummyRoyale({ embedded = false }: { embedded?: boolean }) {
  const { user } = useAuth();
  const active = useQuery({
    queryKey: ["retired-rummy-royale", user?.id],
    queryFn: () => customFetch<{ round: { status: string } } | null>("/api/rummy-royale/active"),
    enabled: !!user,
    retry: false,
  });
  if (active.isPending) return <LoadingScreen />;
  if (active.isError) return <div role="alert" className="p-6">Could not check your existing hand. <button onClick={() => void active.refetch()}>Retry</button></div>;
  if (active.data?.round.status === "active") return <Suspense fallback={<LoadingScreen />}><RummyRoyale embedded={embedded} /></Suspense>;
  return embedded ? <div className="p-6">Rummy Royale is no longer available.</div> : <Redirect to="/rummy" />;
}
