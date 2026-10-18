import { AuthLayout } from "@/components/site/SiteLayout";
import LoginCard from "@/components/auth/LoginCard";
import { getLoginDestination } from "@/lib/loginDestination";
import { useMasterWebsite } from "@/lib/masterWebsite";

export default function Login() {
  const website = useMasterWebsite();
  return (
    <AuthLayout title={website ? `${website.name} · Sign in` : "Sign in"}>
      <LoginCard redirectTo={getLoginDestination()} />
    </AuthLayout>
  );
}
