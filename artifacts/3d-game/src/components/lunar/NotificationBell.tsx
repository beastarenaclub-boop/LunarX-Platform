import { useState } from "react";
import {
  customFetch,
  useRealtimeTopic,
  useRealtimeResync,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Bell, Check, CheckCheck } from "lucide-react";

type Notification = {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  linkUrl: string | null;
  createdAt: string;
};

export default function NotificationBell() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  const countQuery = useQuery({
    queryKey: ["notifications-unread-count"],
    queryFn: () =>
      customFetch<{ count: number }>("/api/notifications/unread-count", {
        method: "GET",
        credentials: "include",
      }),
    // Realtime push updates the count; long poll is a fallback only.
    refetchInterval: 300_000,
  });

  const listQuery = useQuery({
    queryKey: ["notifications-list"],
    queryFn: () =>
      customFetch<Notification[]>("/api/notifications/my?limit=20", {
        method: "GET",
        credentials: "include",
      }),
    enabled: open,
  });

  // Push: bump the badge immediately when a new notification arrives.
  useRealtimeTopic<{ type: string }>(
    user ? `notifications:${user.id}` : null,
    (ev) => {
      if (ev?.type === "new") {
        qc.setQueryData(["notifications-unread-count"], (prev: unknown) => {
          const cur = (prev as { count?: number } | undefined)?.count ?? 0;
          return { count: cur + 1 };
        });
        if (open) {
          qc.invalidateQueries({ queryKey: ["notifications-list"] });
        }
      }
    },
  );
  useRealtimeResync(() => {
    qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
    if (open) qc.invalidateQueries({ queryKey: ["notifications-list"] });
  });

  const markRead = useMutation({
    mutationFn: (ids: string[]) =>
      customFetch("/api/notifications/mark-read", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
      qc.invalidateQueries({ queryKey: ["notifications-list"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () =>
      customFetch("/api/notifications/mark-all-read", {
        method: "POST",
        credentials: "include",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] });
      qc.invalidateQueries({ queryKey: ["notifications-list"] });
    },
  });

  const unread = countQuery.data?.count ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 relative"
          aria-label="Notifications"
          data-testid="btn-notifications"
        >
          <Bell className="w-4 h-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        collisionPadding={8}
        className="w-80 max-w-[calc(100vw-1rem)] p-0 max-h-[min(70dvh,500px)] overflow-auto"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-card-border">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => markAllRead.mutate()}
              data-testid="btn-mark-all-read"
            >
              <CheckCheck className="h-3 w-3 mr-1" /> Mark all read
            </Button>
          )}
        </div>

        {listQuery.isLoading && (
          <p className="text-xs text-muted-foreground text-center py-6">
            Loading…
          </p>
        )}

        {listQuery.data?.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-6">
            No notifications
          </p>
        )}

        <div className="divide-y divide-card-border">
          {listQuery.data?.map((n) => (
            <div
              key={n.id}
              className={`px-3 py-2.5 text-sm ${
                n.read ? "opacity-60" : "bg-primary/5"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-xs leading-tight">
                    {n.title}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {n.message}
                  </p>
                  <p className="text-[10px] text-muted-foreground/50 mt-1">
                    {new Date(n.createdAt).toLocaleString()}
                  </p>
                </div>
                {!n.read && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      markRead.mutate([n.id]);
                    }}
                    data-testid={`btn-mark-read-${n.id}`}
                  >
                    <Check className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
