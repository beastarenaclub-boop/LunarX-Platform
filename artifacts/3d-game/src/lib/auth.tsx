import { createContext, useContext, type ReactNode } from "react";
import {
  useGetMe,
  getGetMeQueryKey,
  type UserPublic,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

interface AuthCtx {
  user: UserPublic | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  isLoading: true,
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      retry: false,
      throwOnError: false,
    },
  });
  const user: UserPublic | null = me.data ?? null;

  const value: AuthCtx = {
    user,
    isLoading: me.isLoading,
    refresh: async () => {
      await qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  return useContext(Ctx);
}
