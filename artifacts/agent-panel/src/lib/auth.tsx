import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { customFetch, ApiError, disconnectRealtime } from "@workspace/api-client-react";
import { queryClient } from "./queryClient";

export type AgentUser = {
  id: string;
  email: string;
  role: "player" | "agent" | "support" | "admin" | "super_admin";
  status: string;
  displayName: string | null;
  referralCode: string | null;
};

type AuthContextValue = {
  user: AgentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AgentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await customFetch<AgentUser>("/api/auth/me", {
        method: "GET",
        credentials: "include",
      });
      if (data && data.role === "agent") {
        setUser(data);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await customFetch<{ user: AgentUser }>(
      "/api/auth/agent-login",
      {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      },
    );
    disconnectRealtime();
    queryClient.clear();
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await customFetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
    disconnectRealtime();
    queryClient.clear();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
