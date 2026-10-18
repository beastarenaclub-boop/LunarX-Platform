import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import {
  useLogin,
  useSignup,
  useRequestPasswordReset,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Rocket } from "lucide-react";
import { unlockAudio } from "@/game/audio";
import { useSiteChannel } from "@/lib/siteChannel";

interface Props {
  /** Where to navigate after a successful sign-in/signup. Defaults to "/". */
  redirectTo?: string;
  /** Hide the outer card chrome (used when embedded inline on the lobby). */
  flat?: boolean;
}

type Mode = "login" | "signup" | "forgot";

export default function LoginCard({ redirectTo = "/", flat = false }: Props) {
  const site = useSiteChannel();
  const canSignup = site.data?.signupEnabled === true;
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>("login");

  // login state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  // signup state
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupName, setSignupName] = useState("");
  // forgot state
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetToken, setResetToken] = useState<string | null>(null);

  const login = useLogin({
    mutation: {
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
        toast.success("Welcome back");
        navigate(redirectTo);
      },
      onError: (err: Error) => toast.error(err.message),
    },
  });
  const signup = useSignup({
    mutation: {
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
        toast.success("Account created");
        navigate(redirectTo);
      },
      onError: (err: Error) => toast.error(err.message),
    },
  });
  const reset = useRequestPasswordReset({
    mutation: {
      onSuccess: (data: unknown) => {
        const token =
          typeof data === "object" && data !== null && "token" in data
            ? String((data as Record<string, unknown>).token ?? "")
            : "";
        if (token) setResetToken(token);
        toast.success("If the email is registered, a reset link was sent.");
      },
      onError: (err: Error) => toast.error(err.message),
    },
  });

  const pending = login.isPending || signup.isPending || reset.isPending;

  function onLoginSubmit(e: FormEvent) {
    e.preventDefault();
    unlockAudio();
    login.mutate({ data: { email: loginEmail, password: loginPassword } });
  }
  function onSignupSubmit(e: FormEvent) {
    e.preventDefault();
    unlockAudio();
    signup.mutate({
      data: {
        email: signupEmail,
        password: signupPassword,
        displayName: signupName || undefined,
      },
    });
  }
  function onForgotSubmit(e: FormEvent) {
    e.preventDefault();
    unlockAudio();
    reset.mutate({ data: { email: forgotEmail } });
  }

  const inner = (
    <div className="space-y-4">
      <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
        <TabsList className={`grid ${canSignup ? "grid-cols-3" : "grid-cols-2"} w-full`}>
          <TabsTrigger value="login" data-testid="tab-login">
            Sign in
          </TabsTrigger>
          {canSignup && <TabsTrigger value="signup" data-testid="tab-signup">
            Create
          </TabsTrigger>}
          <TabsTrigger value="forgot" data-testid="tab-forgot">
            Forgot
          </TabsTrigger>
        </TabsList>

        <TabsContent value="login" className="mt-3">
          <form onSubmit={onLoginSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="hp-login-email">Email</Label>
              <Input
                id="hp-login-email"
                name="email"
                type="email"
                autoComplete="username"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                data-testid="input-login-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hp-login-password">Password</Label>
              <Input
                id="hp-login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                data-testid="input-login-password"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={pending}
              data-testid="btn-login-submit"
            >
              {login.isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="signup" className="mt-3">
          <form onSubmit={onSignupSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="hp-signup-email">Email</Label>
              <Input
                id="hp-signup-email"
                type="email"
                autoComplete="email"
                required
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
                data-testid="input-signup-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hp-signup-name">Display name (optional)</Label>
              <Input
                id="hp-signup-name"
                type="text"
                value={signupName}
                onChange={(e) => setSignupName(e.target.value)}
                data-testid="input-signup-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hp-signup-password">Password</Label>
              <Input
                id="hp-signup-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={signupPassword}
                onChange={(e) => setSignupPassword(e.target.value)}
                data-testid="input-signup-password"
              />
              <p className="text-[10px] text-muted-foreground">
                At least 8 characters.
              </p>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={pending}
              data-testid="btn-signup-submit"
            >
              {signup.isPending ? "Creating…" : "Create account"}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="forgot" className="mt-3">
          <form onSubmit={onForgotSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="hp-forgot-email">Email</Label>
              <Input
                id="hp-forgot-email"
                type="email"
                required
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                data-testid="input-forgot-email"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={pending}
              data-testid="btn-forgot-submit"
            >
              {reset.isPending ? "Sending…" : "Send reset link"}
            </Button>
            {resetToken && (
              <div className="rounded-md border border-card-border bg-muted/40 p-3 text-xs">
                <div className="font-semibold mb-1">
                  Dev token (visible because email is not configured):
                </div>
                <code className="break-all" data-testid="text-reset-token">
                  {resetToken}
                </code>
                <div className="mt-2">
                  <Link
                    href={`/reset?token=${encodeURIComponent(resetToken)}`}
                    className="text-primary hover:underline"
                  >
                    Continue to reset →
                  </Link>
                </div>
              </div>
            )}
          </form>
        </TabsContent>
      </Tabs>
      <p className="mt-4 text-xs text-muted-foreground">For account security, we record your IP address, approximate IP location and browser/device details. Exact GPS location is not collected.</p>
    </div>
  );

  if (flat) {
    return <div className="w-full max-w-sm">{inner}</div>;
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <div className="mx-auto w-12 h-12 rounded-xl bg-primary/15 text-primary flex items-center justify-center mb-2">
          <Rocket className="w-6 h-6" />
        </div>
        <CardTitle>{site.data?.channel === "b2b" ? "Player Login" : "Sign in to Lunar"}</CardTitle>
        {site.data?.channel === "b2b" && <p className="text-sm text-muted-foreground">Use the account created by your agent. Contact your agent for a new account.</p>}
      </CardHeader>
      <CardContent>{inner}</CardContent>
    </Card>
  );
}
