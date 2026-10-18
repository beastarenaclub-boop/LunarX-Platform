import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Router } from "wouter";

type MasterWebsite = {
  masterId: string;
  name: string;
  url: string;
  loginUrl: string;
};
const Context = createContext<MasterWebsite | null>(null);
export const useMasterWebsite = () => useContext(Context);

// The branch base keeps navigation, game links and login inside this website.
const branchBase = window.location.pathname.match(
  /^\/branch\/([A-Za-z0-9_-]{1,100})(?:\/|$)/,
);

export function MasterWebsiteRoot({ children }: { children: ReactNode }) {
  if (!branchBase) return <>{children}</>;
  return <BranchWebsite id={branchBase[1]!}>{children}</BranchWebsite>;
}

function BranchWebsite({ id, children }: { id: string; children: ReactNode }) {
  const website = useQuery({
    queryKey: ["master-website", id],
    queryFn: () =>
      customFetch<MasterWebsite>(
        `/api/network/website/${encodeURIComponent(id)}`,
      ),
    retry: false,
  });
  if (website.isPending)
    return (
      <div className="min-h-screen grid place-items-center" role="status">
        Loading website…
      </div>
    );
  if (website.isError)
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-bold">Branch website unavailable</h1>
        <p>
          This link may be invalid or the branch may be inactive. Contact your
          agent for the correct website.
        </p>
        <button
          type="button"
          onClick={() => void website.refetch()}
          className="rounded border px-5 py-2"
        >
          Try again
        </button>
      </main>
    );
  return (
    <Context.Provider value={website.data}>
      <Router base={`/branch/${id}`}>{children}</Router>
    </Context.Provider>
  );
}
