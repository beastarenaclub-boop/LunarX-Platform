import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const DEV_DEFAULT_EMAIL =
  (import.meta.env.VITE_DEV_ADMIN_EMAIL as string | undefined) ??
  "admin@aviator.dev";
const DEV_DEFAULT_PASSWORD =
  (import.meta.env.VITE_DEV_ADMIN_PASSWORD as string | undefined) ??
  "ChangeMe123!";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState(
    import.meta.env.DEV ? DEV_DEFAULT_EMAIL : "",
  );
  const [password, setPassword] = useState(
    import.meta.env.DEV ? DEV_DEFAULT_PASSWORD : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      const apiError = err instanceof ApiError
        ? (err.data as { error?: { message?: unknown } } | null)?.error?.message
        : undefined;
      setError(typeof apiError === "string"
        ? apiError
        : err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Admin sign in</CardTitle>
          <CardDescription>
            Admin, super admin and support accounts only. Master and agent
            accounts use their own panels.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                data-testid="input-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  data-testid="input-password"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? "Hide" : "Show"}
                </Button>
              </div>
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-600" data-testid="text-login-error">
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={submitting}
              data-testid="button-login"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          {import.meta.env.DEV && (
            <p
              className="mt-4 text-xs text-slate-500"
              data-testid="text-dev-autofill-hint"
            >
              Dev mode: credentials are pre-filled with the default super-admin
              account. Edit them to sign in as a different operator.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
