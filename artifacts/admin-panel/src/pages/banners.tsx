import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Trash2, Pencil, Info, AlertTriangle, Tag } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { useAuth, hasRole } from "@/lib/auth";

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
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

const TYPE_ICONS: Record<string, typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  promo: Tag,
};

const TYPE_COLORS: Record<string, string> = {
  info: "bg-blue-100 text-blue-800",
  warning: "bg-amber-100 text-amber-800",
  promo: "bg-purple-100 text-purple-800",
};

export default function BannersPage() {
  const { user } = useAuth();
  const canWrite = hasRole(user, "admin", "super_admin");
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editBanner, setEditBanner] = useState<Banner | null>(null);

  const query = useQuery({
    queryKey: ["admin-banners"],
    queryFn: () =>
      customFetch<Banner[]>("/api/banners/admin/list", {
        method: "GET",
        credentials: "include",
      }),
  });

  const deleteBanner = useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/banners/admin/${id}`, {
        method: "DELETE",
        credentials: "include",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-banners"] });
    },
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      customFetch(`/api/banners/admin/${id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-banners"] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Banners</h1>
          <p className="text-sm text-slate-500">
            Manage platform banners shown to all users
          </p>
        </div>
        {canWrite && (
          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) setEditBanner(null);
            }}
          >
            <DialogTrigger asChild>
              <Button data-testid="btn-new-banner">
                <Plus className="h-4 w-4 mr-1" /> New banner
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {editBanner ? "Edit banner" : "Create banner"}
                </DialogTitle>
              </DialogHeader>
              <BannerForm
                initial={editBanner}
                onDone={() => {
                  setDialogOpen(false);
                  setEditBanner(null);
                  qc.invalidateQueries({ queryKey: ["admin-banners"] });
                }}
              />
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="space-y-3">
        {query.data?.map((b) => {
          const Icon = TYPE_ICONS[b.type] ?? Info;
          return (
            <Card key={b.id} data-testid={`banner-${b.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`p-2 rounded ${TYPE_COLORS[b.type] ?? "bg-slate-100"}`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium">{b.title}</h3>
                        <Badge variant={b.active ? "default" : "secondary"}>
                          {b.active ? "Active" : "Inactive"}
                        </Badge>
                        {b.sticky && (
                          <Badge variant="outline" className="text-[10px]">
                            Sticky
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-slate-600 mt-1">{b.message}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {fmtDate(b.startsAt)}
                        {b.endsAt ? ` → ${fmtDate(b.endsAt)}` : " → No end"}
                      </p>
                    </div>
                  </div>
                  {canWrite && (
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleActive.mutate({ id: b.id, active: !b.active })}
                        data-testid={`btn-toggle-${b.id}`}
                      >
                        {b.active ? "Deactivate" : "Activate"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditBanner(b);
                          setDialogOpen(true);
                        }}
                        data-testid={`btn-edit-${b.id}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => {
                          if (confirm("Delete this banner?")) {
                            deleteBanner.mutate(b.id);
                          }
                        }}
                        data-testid={`btn-delete-${b.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
        {query.data?.length === 0 && (
          <p className="text-sm text-slate-400 py-8 text-center">
            No banners yet
          </p>
        )}
      </div>
    </div>
  );
}

function BannerForm({
  initial,
  onDone,
}: {
  initial: Banner | null;
  onDone: () => void;
}) {
  const [type, setType] = useState(initial?.type ?? "info");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [message, setMessage] = useState(initial?.message ?? "");
  const [linkUrl, setLinkUrl] = useState(initial?.linkUrl ?? "");
  const [sticky, setSticky] = useState(initial?.sticky ?? false);
  const [startsAt, setStartsAt] = useState(
    initial?.startsAt ? initial.startsAt.slice(0, 16) : "",
  );
  const [endsAt, setEndsAt] = useState(
    initial?.endsAt ? initial.endsAt.slice(0, 16) : "",
  );

  const mutation = useMutation({
    mutationFn: () => {
      if (initial) {
        return customFetch(`/api/banners/admin/${initial.id}`, {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type,
            title,
            message,
            linkUrl: linkUrl || null,
            sticky,
            startsAt: startsAt || undefined,
            endsAt: endsAt || null,
          }),
        });
      }
      return customFetch("/api/banners/admin/create", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type,
          title,
          message,
          linkUrl: linkUrl || undefined,
          sticky,
          startsAt: startsAt || undefined,
          endsAt: endsAt || undefined,
        }),
      });
    },
    onSuccess: onDone,
  });

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Type</Label>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger data-testid="select-banner-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="promo">Promo</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="banner-title">Title</Label>
        <Input
          id="banner-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          data-testid="input-banner-title"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="banner-msg">Message</Label>
        <Textarea
          id="banner-msg"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          data-testid="input-banner-message"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="banner-link">Link URL (optional)</Label>
        <Input
          id="banner-link"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          data-testid="input-banner-link"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="banner-start">Starts at</Label>
          <Input
            id="banner-start"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            data-testid="input-banner-start"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="banner-end">Ends at (optional)</Label>
          <Input
            id="banner-end"
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            data-testid="input-banner-end"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={sticky}
          onChange={(e) => setSticky(e.target.checked)}
          data-testid="checkbox-sticky"
        />
        Sticky (cannot be dismissed by users)
      </label>
      <Button
        className="w-full"
        disabled={!title || !message || mutation.isPending}
        onClick={() => mutation.mutate()}
        data-testid="btn-save-banner"
      >
        {mutation.isPending ? "Saving…" : initial ? "Update banner" : "Create banner"}
      </Button>
      {mutation.isError && (
        <p className="text-sm text-red-600">
          {(mutation.error as Error)?.message ?? "Failed"}
        </p>
      )}
    </div>
  );
}
