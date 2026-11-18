import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Gamepad2,
  GripVertical,
  RotateCcw,
  Save,
  Search,
} from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { LOBBY_ENTRIES } from "@workspace/api-zod/lobby-catalog";
import {
  completeLobbyLayout,
  defaultLobbyLayout,
  moveLobbyGame,
  saveLobbyLayoutSchema,
  type LobbyLayout,
  type LobbyLayoutResponse,
  type LobbySection,
} from "@workspace/api-zod/lobby-layout";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLobbyReorder } from "@/components/useLobbyReorder";

const sections: { id: LobbySection; title: string; description: string }[] = [
  {
    id: "home",
    title: "Lunar homepage",
    description:
      "The first 20 games appear in TOP Games. The remaining games follow below.",
  },
  {
    id: "crypto",
    title: "Crypto777 homepage",
    description:
      "Arrange the Now Trending row. Tick Featured for each game you want to show here.",
  },
  {
    id: "casino",
    title: "All Casino",
    description:
      "Controls the Crypto777 game grid and its category lists, for Normal Play and Agent Play.",
  },
];
const byId = new Map(LOBBY_ENTRIES.map((game) => [game.id, game]));
const queryKey = ["admin.lobby-layout"];

function Position({
  id,
  name,
  position,
  count,
  disabled,
  onMove,
}: {
  id: string;
  name: string;
  position: number;
  count: number;
  disabled: boolean;
  onMove: (id: string, position: number) => void;
}) {
  const [value, setValue] = useState(String(position));
  useEffect(() => setValue(String(position)), [position]);
  const commit = () => {
    const next = Number(value);
    if (Number.isInteger(next) && next >= 1 && next <= count) onMove(id, next);
    else setValue(String(position));
  };
  return (
    <Input
      type="number"
      min={1}
      max={count}
      className="w-20"
      value={value}
      disabled={disabled}
      aria-label={`Position for ${name}`}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

export default function LobbyLayoutPage() {
  const { user } = useAuth();
  const allowed = user?.role === "admin" || user?.role === "super_admin";
  const qc = useQueryClient();
  const saved = useQuery({
    queryKey,
    enabled: allowed,
    queryFn: () => customFetch<LobbyLayoutResponse>("/api/admin/lobby-layout"),
    refetchOnWindowFocus: false,
  });
  const [draft, setDraft] = useState<LobbyLayoutResponse | null>(null);
  const [section, setSection] = useState<LobbySection>("casino");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const current = draft ?? saved.data;
  const dirty = !!draft;
  const layout = current ? completeLobbyLayout(current.layout) : null;
  const order = layout?.orders[section] ?? [];
  const reorder = useLobbyReorder({ order, onMove: move, disabled: saving || !allowed,
    resetKey: `${section}|${search}|${category}`, name: id => byId.get(id)?.name ?? id });
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  if (!allowed) return <p>Only admins can change game order and tags.</p>;
  function edit(change: (layout: LobbyLayout) => LobbyLayout) {
    setDraft((previous) => {
      const base = previous ?? saved.data;
      return base
        ? { ...base, layout: change(completeLobbyLayout(base.layout)) }
        : null;
    });
    setMessage("");
    setError("");
  }
  function move(id: string, position: number) {
    edit((layout) => ({
      ...layout,
      orders: {
        ...layout.orders,
        [section]: moveLobbyGame(layout.orders[section], id, position),
      },
    }));
  }
  async function save() {
    if (!current) return;
    const input = saveLobbyLayoutSchema.safeParse({
      revision: current.revision,
      layout: current.layout,
    });
    if (!input.success) {
      setError(input.error.issues[0]?.message ?? "Please check the tags.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await customFetch<LobbyLayoutResponse>(
        "/api/admin/lobby-layout",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input.data),
        },
      );
      qc.setQueryData(queryKey, result);
      setDraft(null);
      setMessage(
        "Saved. Open player pages update within 15 seconds or when refreshed.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save. Your changes are still here.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function reload() {
    if (
      dirty &&
      !window.confirm(
        "Discard your unsaved changes and reload the saved layout?",
      )
    )
      return;
    const result = await saved.refetch();
    if (result.isSuccess) {
      setDraft(null);
      setError("");
      setMessage("Saved layout loaded.");
    }
  }
  const visible = order.filter((id) => {
    const game = byId.get(id)!;
    return (
      (!category || game.category === category) &&
      `${game.name} ${game.id} ${layout?.games[id]?.label} ${layout?.games[id]?.tags.join(" ")}`
        .toLowerCase()
        .includes(search.trim().toLowerCase())
    );
  });
  return (
    <div className="space-y-5" data-testid="lobby-layout-editor">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Game order &amp; tags
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Drag games by the grip to reorder, use the arrows, or enter a position number. Badge and search
            tag changes apply across all three views.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void reload()}
            disabled={saving || saved.isFetching}
          >
            <RotateCcw size={16} className="mr-2" />
            Reload saved
          </Button>
          <Button
            onClick={() => void save()}
            disabled={!dirty || saving || !layout}
            data-testid="save-lobby-layout"
          >
            <Save size={16} className="mr-2" />
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </header>
      <div
        role="tablist"
        aria-label="Game placement"
        className="grid gap-2 sm:grid-cols-3"
      >
        {sections.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={section === item.id}
            onClick={() => setSection(item.id)}
            className={`rounded-lg border px-4 py-3 text-left text-sm font-semibold ${section === item.id ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-600"}`}
          >
            {item.title}
          </button>
        ))}
      </div>
      <p className="text-sm text-slate-600">
        {sections.find((item) => item.id === section)?.description}
      </p>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}
      {message && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          <Check size={16} />
          {message}
        </div>
      )}
      {saved.isError && (
        <p role="alert" className="text-sm text-red-700">
          Could not load the saved layout. Use Reload saved to try again.
        </p>
      )}
      {!current && !saved.isError && <p role="status">Loading game order…</p>}
      {layout && (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-white p-4">
            <div className="relative min-w-48 flex-1">
              <Search
                className="absolute left-3 top-2.5 text-slate-400"
                size={17}
              />
              <Input
                className="pl-9"
                aria-label="Search games to arrange"
                placeholder="Search games or tags"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <select
              aria-label="Filter game category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="h-10 rounded-md border px-3 text-sm"
            >
              <option value="">All categories</option>
              {["crash", "instant", "live", "table", "racing", "lottery"].map(
                (value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ),
              )}
            </select>
            <span className="text-sm text-slate-500">
              {visible.length} of {order.length} games
              {dirty ? " · Unsaved changes" : ""}
            </span>
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => {
                if (
                  window.confirm(
                    "Reset the order for this view? Tags and other views will stay as they are. Save changes to publish.",
                  )
                )
                  edit((value) => ({
                    ...value,
                    orders: {
                      ...value.orders,
                      [section]: defaultLobbyLayout().orders[section],
                    },
                  }));
              }}
            >
              Reset this order
            </Button>
          </div>
          {(search || category) && (
            <p className="text-xs text-slate-500">
              Position numbers refer to the full list. Arrow buttons move one
              position in that list. Dragging inserts before or after the highlighted game in the full list.
            </p>
          )}
          <p id="lobby-drag-help" className="text-sm text-slate-600">Hold the grip and drag with your mouse or finger. Near the edge, the list scrolls automatically. Keyboard: focus the grip and use ↑ / ↓. Save changes when finished.</p>
          <p className="sr-only" role="status" aria-live="polite">{reorder.announcement}</p>
          {reorder.drag && <div ref={reorder.previewRef} aria-hidden="true" className="pointer-events-none fixed left-0 top-0 z-50 w-60 rounded-lg border border-emerald-500 bg-emerald-50 p-3 text-sm text-emerald-900 shadow-lg"><strong>{byId.get(reorder.drag.id)?.name}</strong><div className="text-xs">Release at the highlighted line</div></div>}
          <div ref={reorder.listRef} className="space-y-3">
            {visible.map((id) => {
              const game = byId.get(id)!;
              const position = order.indexOf(id) + 1;
              const metadata = layout.games[id]!;
              return (
                <section
                  key={id}
                  data-testid={`layout-game-${id}`}
                  data-lobby-sort-id={id}
                  data-dragging={reorder.drag?.id === id || undefined}
                  data-drop-edge={reorder.drag?.target?.id === id ? (reorder.drag.target.after ? "after" : "before") : undefined}
                  className={`relative rounded-lg border bg-white p-4 ${reorder.drag?.id === id ? "border-emerald-500 opacity-50" : "border-slate-200"}`}
                >
                  {reorder.drag?.target?.id === id && <div aria-hidden="true" className={`pointer-events-none absolute -left-px -right-px z-10 h-1 rounded bg-emerald-500 ${reorder.drag.target.after ? "-bottom-2" : "-top-2"}`} />}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="button" variant="outline" size="icon"
                      className="h-11 w-11 shrink-0 touch-none select-none cursor-grab active:cursor-grabbing"
                      aria-label={`Drag ${game.name} to reorder`} aria-describedby="lobby-drag-help"
                      disabled={saving} {...reorder.handleProps(id)}>
                      <GripVertical size={20} />
                    </Button>
                    <Position
                      id={id}
                      name={game.name}
                      position={position}
                      count={order.length}
                      disabled={saving}
                      onMove={move}
                    />
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Move ${game.name} up`}
                        disabled={saving || position === 1}
                        onClick={() => move(id, position - 1)}
                      >
                        <ArrowUp size={17} />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Move ${game.name} down`}
                        disabled={saving || position === order.length}
                        onClick={() => move(id, position + 1)}
                      >
                        <ArrowDown size={17} />
                      </Button>
                    </div>
                    <Gamepad2
                      className="hidden text-emerald-600 sm:block"
                      size={22}
                    />
                    <div className="min-w-36 flex-1">
                      <h2 className="text-sm font-semibold text-slate-900">
                        {game.name}
                      </h2>
                      <p className="mt-1 text-xs text-slate-500">
                        {game.category} · {game.id}
                      </p>
                    </div>
                    {metadata.label && (
                      <span
                        className="max-w-48 break-words rounded bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800"
                        data-testid={`badge-preview-${id}`}
                      >
                        {metadata.label}
                      </span>
                    )}
                    {section === "crypto" && (
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={layout.featured.includes(id)}
                          disabled={saving}
                          aria-label={`Feature ${game.name} on Crypto777 homepage`}
                          onChange={(event) =>
                            edit((value) => ({
                              ...value,
                              featured: event.target.checked
                                ? [...value.featured, id]
                                : value.featured.filter((item) => item !== id),
                            }))
                          }
                        />
                        Featured
                      </label>
                    )}
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(140px,220px)_1fr]">
                    <label className="text-xs font-medium text-slate-600">
                      Card badge{" "}
                      <Input
                        value={metadata.label}
                        maxLength={20}
                        disabled={saving}
                        aria-label={`Badge for ${game.name}`}
                        placeholder="NEW, HOT, LIVE or blank"
                        list="lobby-badge-options"
                        className="mt-1"
                        onChange={(event) =>
                          edit((value) => ({
                            ...value,
                            games: {
                              ...value.games,
                              [id]: {
                                ...value.games[id]!,
                                label: event.target.value,
                              },
                            },
                          }))
                        }
                      />
                    </label>
                    <label className="text-xs font-medium text-slate-600">
                      Search tags (comma separated){" "}
                      <Input
                        value={metadata.tags.join(",")}
                        disabled={saving}
                        aria-label={`Search tags for ${game.name}`}
                        placeholder="cards, popular, live"
                        className="mt-1"
                        onChange={(event) =>
                          edit((value) => ({
                            ...value,
                            games: {
                              ...value.games,
                              [id]: {
                                ...value.games[id]!,
                                tags: event.target.value.split(","),
                              },
                            },
                          }))
                        }
                        onBlur={() =>
                          edit((value) => ({
                            ...value,
                            games: {
                              ...value.games,
                              [id]: {
                                ...value.games[id]!,
                                tags: value.games[id]!.tags.map((tag) =>
                                  tag.trim(),
                                ).filter(Boolean),
                              },
                            },
                          }))
                        }
                      />
                    </label>
                  </div>
                </section>
              );
            })}
            {!visible.length && (
              <p className="rounded-lg border bg-white p-8 text-center text-slate-500">
                No games match this search.
              </p>
            )}
          </div>
          <datalist id="lobby-badge-options">
            {["NEW", "HOT", "LIVE", "POPULAR", "INSTANT"].map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
          <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-lg border bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-600">
              {dirty
                ? "Changes are not published yet."
                : "Showing the saved layout."}
            </p>
            <Button disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
