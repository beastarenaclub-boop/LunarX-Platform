import { AuthLayout } from "@/components/site/SiteLayout";
import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { useRequestPasswordReset } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function Forgot() {
  const [username, setUsername] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const req = useRequestPasswordReset({
    mutation: {
      onSuccess: (data: unknown) => {
        // Dev convenience: server may echo the token in the response.
        const t =
          typeof data === "object" && data !== null && "token" in data
            ? String((data as Record<string, unknown>).token ?? "")
            : "";
        if (t) setToken(t);
        toast.success(
          "Request received. If you cannot reset it yourself, contact support with your username.",
        );
      },
      onError: (err: Error) => toast.error(err.message),
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    req.mutate({ data: { username: username.trim().toLowerCase() } });
  }

  return (
    <AuthLayout title="Reset your password">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle>Reset your password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="e.g. rahul482"
                required
                maxLength={254}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                data-testid="input-forgot-username"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Passwords are reset by our support team. Contact support with
              your username and they will set a new password for you.
            </p>
            <Button
              type="submit"
              className="w-full"
              disabled={req.isPending}
              data-testid="btn-forgot-submit"
            >
              {req.isPending ? "Sending…" : "Request reset"}
            </Button>
          </form>
          {token && (
            <div className="rounded-md border border-card-border bg-muted/40 p-3 text-xs">
              <div className="font-semibold mb-1">
                Dev token (only shown on development servers):
              </div>
              <code className="break-all" data-testid="text-reset-token">
                {token}
              </code>
              <div className="mt-2">
                <Link
                  href={`/reset?token=${encodeURIComponent(token)}`}
                  className="text-primary hover:underline"
                >
                  Continue to reset →
                </Link>
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground text-center">
            <Link href="/login" className="hover:underline">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
