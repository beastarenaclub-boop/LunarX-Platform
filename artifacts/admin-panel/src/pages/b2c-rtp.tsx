import { B2cRtp } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
export default function B2cRtpPage() {
  const {user} = useAuth();
  if (user?.role !== "admin" && user?.role !== "super_admin") return <p>Only admin can manage B2C RTP.</p>;
  return <B2cRtp />;
}
