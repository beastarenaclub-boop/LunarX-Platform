import {
  customFetch,
  useRealtimeTopic,
  useRealtimeResync,
} from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Info, AlertTriangle, Tag } from "lucide-react";

type Banner = {
  id: string;
  type: string;
  title: string;
  message: string;
  linkUrl: string | null;
  sticky: boolean;
  active: boolean;
  startsAt: string;
  endsAt: string | null;
};

const TYPE_CONFIG: Record<string, { icon: typeof Info; bg: string; border: string; text: string }> = {
  info: {
    icon: Info,
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    text: "text-blue-300",
  },
  warning: {
    icon: AlertTriangle,
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    text: "text-amber-300",
  },
  promo: {
    icon: Tag,
    bg: "bg-purple-500/10",
    border: "border-purple-500/20",
    text: "text-purple-300",
  },
};

export default function BannerStrip() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["active-banners"],
    queryFn: () =>
      customFetch<Banner[]>("/api/banners/active", {
        method: "GET",
        credentials: "include",
      }),
    // Realtime push invalidates this on banner changes; long poll is a fallback.
    refetchInterval: 300_000,
  });

  useRealtimeTopic<{ type: string }>("banners:active", (ev) => {
    if (ev?.type === "changed") {
      qc.invalidateQueries({ queryKey: ["active-banners"] });
    }
  });
  useRealtimeResync(() => {
    qc.invalidateQueries({ queryKey: ["active-banners"] });
  });

  const dismiss = useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/banners/dismiss/${id}`, {
        method: "POST",
        credentials: "include",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["active-banners"] });
    },
  });

  const banners = query.data;
  if (!banners || banners.length === 0) return null;

  return (
    <div className="space-y-0.5">
      {banners.map((b) => {
        const cfg = TYPE_CONFIG[b.type] ?? TYPE_CONFIG.info;
        const Icon = cfg.icon;
        return (
          <div
            key={b.id}
            className={`flex items-center gap-2 px-3 py-1.5 max-[499px]:px-2 max-[499px]:py-1 ${cfg.bg} border-b ${cfg.border} text-xs max-[499px]:text-[11px] ${cfg.text}`}
            data-testid={`banner-${b.id}`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0 max-[499px]:h-3 max-[499px]:w-3" />
            <span className="font-medium shrink-0">{b.title}</span>
            <span className="truncate opacity-80 max-[499px]:hidden">{b.message}</span>
            {b.linkUrl && (
              <a
                href={b.linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline shrink-0 ml-auto inline-flex items-center max-[499px]:min-h-[44px] max-[499px]:px-2"
              >
                Learn more
              </a>
            )}
            {!b.sticky && (
              <button
                onClick={() => dismiss.mutate(b.id)}
                className="ml-auto shrink-0 hover:opacity-70 p-1 max-[499px]:min-h-[44px] max-[499px]:min-w-[44px] flex items-center justify-center"
                aria-label="Dismiss"
                data-testid={`dismiss-banner-${b.id}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
