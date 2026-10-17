import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth, hasRole } from "@/lib/auth";

export default function NotificationsPage() {
  const { user } = useAuth();
  const canSend = hasRole(user, "admin", "super_admin");
  const [kind, setKind] = useState<"user" | "segment">("user");
  const [userId, setUserId] = useState("");
  const [segment, setSegment] = useState("all_active");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  const send = useMutation({
    mutationFn: () =>
      customFetch<{ sent: number }>("/api/notifications/send", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target:
            kind === "user"
              ? { kind: "user", userId }
              : { kind: "segment", segment },
          title,
          message,
          linkUrl: linkUrl || undefined,
        }),
      }),
  });

  if (!canSend) {
    return (
      <p className="text-sm text-slate-500">
        Only admins can send notifications.
      </p>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">Send Notification</h1>
        <p className="text-sm text-slate-500">
          Send in-app notifications to users
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New notification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Target</Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as "user" | "segment")}
            >
              <SelectTrigger data-testid="select-notif-target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">Single user</SelectItem>
                <SelectItem value="segment">Segment</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {kind === "user" ? (
            <div className="space-y-1">
              <Label htmlFor="notif-uid">User ID</Label>
              <Input
                id="notif-uid"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                data-testid="input-notif-user"
              />
            </div>
          ) : (
            <div className="space-y-1">
              <Label>Segment</Label>
              <Select value={segment} onValueChange={setSegment}>
                <SelectTrigger data-testid="select-notif-segment">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new_last_7_days">New users (last 7 days)</SelectItem>
                  <SelectItem value="new_last_30_days">New users (last 30 days)</SelectItem>
                  <SelectItem value="all_active">All active users</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="notif-title">Title</Label>
            <Input
              id="notif-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Notification title"
              data-testid="input-notif-title"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="notif-msg">Message</Label>
            <Textarea
              id="notif-msg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Notification body"
              data-testid="input-notif-message"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="notif-link">Link URL (optional)</Label>
            <Input
              id="notif-link"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="/wallet"
              data-testid="input-notif-link"
            />
          </div>
          <Button
            disabled={
              send.isPending ||
              !title ||
              !message ||
              (kind === "user" && !userId)
            }
            data-testid="btn-send-notif"
            onClick={() => send.mutate()}
          >
            {send.isPending ? "Sending…" : "Send notification"}
          </Button>
          {send.isSuccess && send.data && (
            <p className="text-sm text-emerald-700" data-testid="text-notif-result">
              Sent to {send.data.sent} user(s).
            </p>
          )}
          {send.isError && (
            <p className="text-sm text-red-600">
              {(send.error as Error)?.message ?? "Failed to send"}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
