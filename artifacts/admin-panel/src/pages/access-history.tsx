import { AccountAccessHistory } from "@/components/AccountAccessHistory";
import { useAuth } from "@/lib/auth";
export default function AccessHistoryPage() {
  const { user } = useAuth();
  if (!user || !["admin", "super_admin"].includes(user.role))
    return <p>Administrator access is required.</p>;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Login activity</h1>
      <AccountAccessHistory key={user.id} />
    </div>
  );
}
