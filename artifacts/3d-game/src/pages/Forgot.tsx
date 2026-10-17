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
  const [email, setEmail] = useState("");
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
        toast.success("If the email is registered, a reset link was sent.");
      },
      onError: (err: Error) => toast.error(err.message),
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    req.mutate({ data: { email } });
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
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-forgot-email"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={req.isPending}
              data-testid="btn-forgot-submit"
            >
              {req.isPending ? "Sending…" : "Send reset link"}
            </Button>
          </form>
          {token && (
            <div className="rounded-md border border-card-border bg-muted/40 p-3 text-xs">
              <div className="font-semibold mb-1">
                Dev token (visible because email is not configured):
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
