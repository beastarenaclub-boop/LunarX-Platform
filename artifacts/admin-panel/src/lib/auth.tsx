import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { customFetch, ApiError } from "@workspace/api-client-react";

export type AdminUser = {
  id: string;
  email: string;
  role: "player" | "agent" | "support" | "admin" | "super_admin";
  status: string;
  displayName: string | null;
};

type AuthContextValue = {
  user: AdminUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const ADMIN_ROLES = new Set(["admin", "super_admin", "support"]);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await customFetch<AdminUser>("/api/auth/me", {
        method: "GET",
        credentials: "include",
      });
      if (data && ADMIN_ROLES.has(data.role)) {
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

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await customFetch<{ user: AdminUser }>("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!ADMIN_ROLES.has(data.user.role)) {
        throw new Error("This account does not have operator access.");
      }
      setUser(data.user);
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await customFetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
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

export function hasRole(
  user: AdminUser | null,
  ...roles: AdminUser["role"][]
): boolean {
  if (!user) return false;
  return roles.includes(user.role);
}
