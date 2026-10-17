import { AuthLayout } from "@/components/site/SiteLayout";
import { useState, type FormEvent } from "react";
import { useLocation, Link } from "wouter";
import { useConfirmPasswordReset } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function Reset() {
  const [, navigate] = useLocation();
  const initialToken =
    typeof window !== "undefined"
      ? (new URLSearchParams(window.location.search).get("token") ?? "")
      : "";
  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState("");
  const reset = useConfirmPasswordReset({
    mutation: {
      onSuccess: () => {
        toast.success("Password reset. Sign in with your new password.");
        navigate("/login");
      },
      onError: (err: Error) => toast.error(err.message),
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    reset.mutate({ data: { token, password } });
  }

  return (
    <AuthLayout title="Set a new password">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>Set a new password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="token">Reset token</Label>
              <Input
                id="token"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                data-testid="input-reset-token"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="input-reset-password"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={reset.isPending}
              data-testid="btn-reset-submit"
            >
              {reset.isPending ? "Resetting…" : "Reset password"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              <Link href="/login" className="hover:underline">
                Back to sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
