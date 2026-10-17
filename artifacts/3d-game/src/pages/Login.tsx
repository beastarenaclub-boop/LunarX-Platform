import { AuthLayout } from "@/components/site/SiteLayout";
import LoginCard from "@/components/auth/LoginCard";
import { getLoginDestination } from "@/lib/loginDestination";

export default function Login() {
  return (
    <AuthLayout title="Sign in">
      <LoginCard redirectTo={getLoginDestination()} />
    </AuthLayout>
  );
}
