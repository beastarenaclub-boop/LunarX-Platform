import { AuthLayout } from "@/components/site/SiteLayout";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { useSignup, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Rocket } from "lucide-react";
import { useSiteChannel } from "@/lib/siteChannel";
import { announceNewUsername } from "@/components/auth/NewUsernameDialog";

export default function Signup() {
  const site = useSiteChannel();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const signup = useSignup({
    mutation: {
      onSuccess: async (data) => {
        announceNewUsername(data.username ?? data.user.username);
        await qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
        try {
          sessionStorage.removeItem("lunar:referral-code");
        } catch {}
        toast.success("Account created");
        navigate("/");
      },
      onError: (err: Error) => toast.error(err.message),
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();

    signup.mutate({
      data: {
        password,
        displayName: displayName.trim() || undefined,
      },
    });
  }

  if (!site.data?.signupEnabled) return <AuthLayout title="Player accounts"><Card className="w-full max-w-sm"><CardContent className="p-6"><p>{site.isPending ? "Loading account options…" : site.isError ? "Account options unavailable. Please refresh." : "Contact your account manager for a player account and login details."}</p><Link href="/login">Sign in</Link></CardContent></Card></AuthLayout>;
  return (
    <AuthLayout title="Create your account">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-primary/15 text-primary flex items-center justify-center mb-2">
            <Rocket className="w-6 h-6" />
          </div>
          <CardTitle>Create your account</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Your username is made from the first 5 letters of your name + 3
              random numbers (like <strong>rahul482</strong>). You will use it
              to sign in.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="displayName">Name</Label>
              <Input
                id="displayName"
                type="text"
                autoComplete="name"
                required
                maxLength={50}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                data-testid="input-signup-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={72}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="input-signup-password"
              />
              <p className="text-[10px] text-muted-foreground">
                At least 8 characters with a letter and a number.
              </p>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={signup.isPending}
              data-testid="btn-signup-submit"
            >
              {signup.isPending ? "Creating…" : "Create account"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Already have an account?{" "}
              <Link href="/login" className="hover:underline">
                Sign in
              </Link>
            </p>
            <p className="text-xs text-muted-foreground">For account security, we record your IP address, approximate IP location and browser/device details. Exact GPS location is not collected.</p>
          </form>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
