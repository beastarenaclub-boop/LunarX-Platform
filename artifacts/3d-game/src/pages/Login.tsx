import { AuthLayout } from "@/components/site/SiteLayout";
import LoginCard from "@/components/auth/LoginCard";

export default function Login() {
  return (
    <AuthLayout title="Sign in">
      <LoginCard />
    </AuthLayout>
  );
}
