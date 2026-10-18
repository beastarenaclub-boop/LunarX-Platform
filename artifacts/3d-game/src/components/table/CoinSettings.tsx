import { useEffect, useState, type ComponentProps } from "react";
import { Check, Settings2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import ChipRack, { CoinFace, LIVE_TABLE_COIN_VALUES } from "./chips";
import { cn } from "@/lib/utils";
import { TableSoundSettings } from "./TableSoundSettings";
import { ROULETTE_COIN_VALUES } from "@workspace/api-zod/roulette-game";
import { useButtonValues } from "@/lib/buttonValues";
import { useLocation } from "wouter";

type Preferences = { values: number[]; showCustom: boolean };
const ALL_COIN_VALUES = [...new Set([...LIVE_TABLE_COIN_VALUES, ...ROULETTE_COIN_VALUES])];
const defaults = (maxValue = Infinity, allowed: readonly number[] = LIVE_TABLE_COIN_VALUES): Preferences => ({ values: allowed.filter(v => v <= maxValue), showCustom: true });
function normalize(value: unknown, maxValue = Infinity, allowed: readonly number[] = LIVE_TABLE_COIN_VALUES): Preferences {
  if (!value || typeof value !== "object") return defaults(maxValue, allowed);
  const saved = value as Partial<Preferences>;
  const values = allowed.filter(v => v <= maxValue && Array.isArray(saved.values) && saved.values.includes(v));
  return { values: values.length ? values : defaults(maxValue, allowed).values, showCustom: saved.showCustom !== false };
}
function load(key: string, maxValue: number, allowed: readonly number[] = LIVE_TABLE_COIN_VALUES) {
  try { return normalize(JSON.parse(localStorage.getItem(key) ?? "null"), maxValue, allowed); }
  catch { return defaults(maxValue, allowed); }
}
function initial(key: string, maxValue: number, legacyKey?: string, allowed: readonly number[] = LIVE_TABLE_COIN_VALUES) {
  // Apply the new ₹100/₹500 ladder once, including accounts with old saved
  // presets. Keep their custom-amount setting and all denominations above a
  // capped game's limit, so visiting that game cannot shrink the shared rack.
  try {
    if (!localStorage.getItem(key)) {
      const previousKey = key.replace("table-coins:v3:", "table-coins:v2:");
      const previous = JSON.parse(localStorage.getItem(previousKey) ?? (legacyKey ? localStorage.getItem(legacyKey) : null) ?? "null");
      localStorage.setItem(key, JSON.stringify({ ...defaults(Infinity, allowed), showCustom: previous?.showCustom !== false }));
    }
  } catch { /* Storage is optional. */ }
  const preferences = load(key, maxValue, allowed);
  return { key, ...preferences, chip: preferences.values[0] ?? Math.max(1, Math.min(100, Math.floor(maxValue))) };
}

export function useCoinPreferences(game: string, userId?: string, maxValue = Infinity, allowed: readonly number[] = LIVE_TABLE_COIN_VALUES) {
  const accountValues = useButtonValues();
  const key = `table-coins:v3:${userId ?? "guest"}`;
  const legacyKey = `table-coins:v1:${game}:${userId ?? "guest"}`;
  const [stored, setStored] = useState(() => initial(key, maxValue, legacyKey, allowed));
  const current = stored.key === key ? stored : initial(key, maxValue, legacyKey, allowed);
  useEffect(() => {
    const sync = () => setStored(previous => {
      const next = initial(key, maxValue, legacyKey, allowed);
      return { ...next, chip: previous.key === key && previous.chip <= maxValue &&
        (next.values.includes(previous.chip) || (next.showCustom && !allowed.includes(previous.chip)))
        ? previous.chip : next.chip };
    });
    sync();
    window.addEventListener("table-coins-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("table-coins-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, [key, maxValue, legacyKey, allowed]);
  const selectChip = (chip: number) => {
    if (!Number.isSafeInteger(chip) || chip < 1 || chip > maxValue) return;
    setStored(previous => {
      const value = previous.key === key ? previous : initial(key, maxValue, legacyKey, allowed);
      return value.showCustom || value.values.includes(chip) || accountValues?.includes(chip) ? { ...value, chip } : value;
    });
  };
  const save = (input: Preferences) => {
    const preferences = normalize(input, maxValue, allowed);
    const isCustom = !allowed.includes(current.chip);
    const chip = preferences.values.includes(current.chip) || (isCustom && preferences.showCustom)
      ? current.chip : preferences.values[0];
    setStored({ key, ...preferences, chip });
    try {
      // A capped practice table must not erase larger coins used by other games.
      const larger = load(key, Infinity, ALL_COIN_VALUES).values.filter(value => value > maxValue || !allowed.includes(value));
      localStorage.setItem(key, JSON.stringify({ ...preferences, values: [...preferences.values, ...larger] }));
      window.dispatchEvent(new Event("table-coins-changed"));
    } catch { /* Session still works when storage is blocked. */ }
  };
  return { ...current, selectChip, save };
}

export function CoinSettingsButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-label="Coin settings" title="Choose your coins"
    data-testid="coin-settings-button"
    className="h-11 w-11 shrink-0 inline-flex items-center justify-center rounded-lg border border-emerald-200/20 bg-emerald-200/5 text-emerald-200 hover:bg-emerald-200/15 focus-visible:outline-2 focus-visible:outline-amber-300">
    <Settings2 size={19} />
  </button>;
}

/** Shared rack and settings for tables with desktop and mobile controls. */
export function TableCoinRack({ preferences, availableValues, selectableValues, ...props }: ComponentProps<typeof ChipRack> & {
  preferences: ReturnType<typeof useCoinPreferences>;
  availableValues?: readonly number[];
  /** Limit this game's displayed coins without changing shared saved choices. */
  selectableValues?: readonly number[];
}) {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const accountValues = useButtonValues();
  const useAccount = !!accountValues && props.unit !== "chips" && props.showCustom !== false && !selectableValues;
  return <div className="table-coin-controls flex min-w-0 flex-1 items-center gap-2">
    <ChipRack {...props} values={selectableValues ?? preferences.values} allowAccountValues={useAccount} showCustom={props.showCustom !== false && (useAccount || preferences.showCustom)} className={cn("min-w-0 flex-1", props.className)} />
    <CoinSettingsButton onClick={() => useAccount ? navigate("/settings/buttonvalue") : setOpen(true)} />
    <CoinSettingsDialog open={open} onOpenChange={setOpen} preferences={preferences} onSave={preferences.save} maxValue={props.maxValue} unit={props.unit} allowCustom={props.showCustom !== false} values={availableValues} />
  </div>;
}

export function CoinSettingsDialog({ open, onOpenChange, preferences, onSave, maxValue = Infinity, unit = "rupees", values = LIVE_TABLE_COIN_VALUES, allowCustom = true }: {
  open: boolean; onOpenChange: (open: boolean) => void; preferences: Preferences; onSave: (value: Preferences) => void;
  maxValue?: number; unit?: "rupees" | "chips";
  values?: readonly number[]; allowCustom?: boolean;
}) {
  const [draft, setDraft] = useState<Preferences>(preferences);
  useEffect(() => {
    const close = () => onOpenChange(false);
    window.addEventListener("table-round-win", close);
    return () => window.removeEventListener("table-round-win", close);
  }, [onOpenChange]);
  useEffect(() => { if (open) setDraft({ values: [...preferences.values], showCustom: preferences.showCustom }); },
    [open, preferences.values, preferences.showCustom]);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-md border-emerald-300/20 bg-[#0b2119] text-white" data-testid="coin-settings-dialog">
      <DialogTitle className="pr-8 text-xl">Choose your coins</DialogTitle>
      <DialogDescription className="text-white/65">Your coin choices apply across games, within each game's limits. Choose at least one.</DialogDescription>
      <div className="grid grid-cols-4 gap-2">
        {values.filter(value => value <= maxValue).map(value => {
          const selected = draft.values.includes(value);
          return <button key={value} type="button" role="checkbox" aria-checked={selected} aria-label={unit === "chips" ? `${value.toLocaleString("en-IN")} chip` : `₹${value.toLocaleString("en-IN")} coin`}
            onClick={() => setDraft(previous => ({ ...previous, values: selected ? previous.values.filter(v => v !== value) : [...previous.values, value] }))}
            className={cn("relative flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl border py-3", selected ? "border-emerald-300 bg-emerald-300/10" : "border-white/10 bg-black/20 opacity-60")}>
            <CoinFace value={value} sizeClass="w-10 h-10" />
            <span className="text-[10px]">{unit === "rupees" ? "₹" : ""}{value.toLocaleString("en-IN")}</span>
            {selected && <Check size={13} className="absolute right-1 top-1 text-emerald-300" />}
          </button>;
        })}
      </div>
      {allowCustom && <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-white/10 p-3 text-sm">
        <input type="checkbox" className="h-5 w-5 accent-emerald-400" checked={draft.showCustom}
          onChange={event => setDraft(previous => ({ ...previous, showCustom: event.target.checked }))} />
        Show Any (custom amount)
      </label>}
      <p role="status" className="text-xs text-emerald-200">{draft.values.length ? `${draft.values.length} coins selected` : "Choose at least one coin to continue."}</p>
      <TableSoundSettings />
      <div className="sticky bottom-0 flex gap-2 bg-[#0b2119] pt-2">
        <button type="button" className="min-h-11 rounded-lg border border-white/20 px-3 text-sm" onClick={() => setDraft(defaults(maxValue, values))}>Reset</button>
        <button type="button" className="min-h-11 flex-1 rounded-lg bg-emerald-300 px-4 text-sm font-bold text-[#082218] disabled:opacity-40"
          disabled={!draft.values.length} onClick={() => { onSave(draft); onOpenChange(false); }} data-testid="coin-settings-save">Save coins</button>
      </div>
    </DialogContent>
  </Dialog>;
}
