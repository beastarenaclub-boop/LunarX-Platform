import { useState } from "react";
import { useStore } from "@/game/store";
import { rotateServerSeed } from "@/game/engine";
import { deriveCrash } from "@/game/rng";
import { useDialogSound } from "@/game/useDialogSound";
import { t } from "@/game/i18n";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShieldCheck, RotateCw, Check, X } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ProvablyFairDialog({ open, onOpenChange }: Props) {
  const lang = useStore((s) => s.settings.language);
  useDialogSound(open);
  const serverSeedHash = useStore((s) => s.serverSeedHash);
  const clientSeed = useStore((s) => s.clientSeed);
  const nonce = useStore((s) => s.nonce);
  const pastSeeds = useStore((s) => s.pastSeeds);
  const rounds = useStore((s) => s.rounds);

  const [verifyServerSeed, setVerifyServerSeed] = useState("");
  const [verifyClientSeed, setVerifyClientSeed] = useState("");
  const [verifyNonce, setVerifyNonce] = useState(0);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; m: number; expected: number } | null>(null);
  const [newClient, setNewClient] = useState(clientSeed);

  const handleVerify = async () => {
    const { sha256Hex } = await import("@/game/rng");
    const enteredHash = await sha256Hex(verifyServerSeed);
    // Match round by serverSeedHash + clientSeed + nonce so rotated nonces don't collide.
    const round = rounds.find(
      (r) =>
        r.serverSeedHash === enteredHash &&
        r.clientSeed === verifyClientSeed &&
        r.nonce === verifyNonce,
    );
    const m = await deriveCrash(verifyServerSeed, verifyClientSeed, verifyNonce, round);
    setVerifyResult({
      ok: round ? Math.abs(round.crashAt - m) < 0.005 : false,
      m,
      expected: round?.crashAt ?? 0,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[calc(100vw-1rem)] max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-accent" />
            {t(lang, "provablyFair")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2 text-sm">
          <p className="text-xs text-muted-foreground">
            Each round's crash multiplier is derived from a hashed server seed (committed before the round),
            your client seed, and a nonce. The server reveals the seed after the crash and commits a fresh seed for the next round.
          </p>

          <div className="space-y-3">
            <div>
              <Label className="text-xs">{t(lang, "serverSeedHash")}</Label>
              <code className="block mt-1 px-2 py-1.5 rounded bg-secondary text-[11px] font-mono break-all">
                {serverSeedHash}
              </code>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t(lang, "clientSeed")}</Label>
                <Input
                  value={newClient}
                  onChange={(e) => setNewClient(e.target.value)}
                  className="mt-1 font-mono text-xs h-8"
                />
              </div>
              <div>
                <Label className="text-xs">{t(lang, "nonce")}</Label>
                <Input
                  value={nonce}
                  readOnly
                  className="mt-1 font-mono text-xs h-8 bg-muted/40"
                />
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await rotateServerSeed(newClient);
              }}
            >
              <RotateCw className="w-3.5 h-3.5 mr-1.5" />
              Save client seed for next round
            </Button>
          </div>

          {pastSeeds.length > 0 && (
            <div className="border-t border-border pt-3">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Revealed past seeds
              </Label>
              <ScrollArea className="h-32 mt-2">
                <div className="space-y-1">
                  {[...pastSeeds].reverse().map((p) => (
                    <div key={p.seed} className="text-[10px] font-mono space-y-0.5 p-2 rounded bg-secondary/40">
                      <div>seed: <span className="text-accent">{p.seed}</span></div>
                      <div>hash: <span className="text-muted-foreground">{p.hash.slice(0, 32)}…</span></div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          <div className="border-t border-border pt-3 space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              {t(lang, "verify")}
            </Label>
            <Input
              placeholder="Server seed (revealed)"
              value={verifyServerSeed}
              onChange={(e) => setVerifyServerSeed(e.target.value)}
              className="font-mono text-xs h-8"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Client seed"
                value={verifyClientSeed}
                onChange={(e) => setVerifyClientSeed(e.target.value)}
                className="font-mono text-xs h-8"
              />
              <Input
                placeholder="Nonce"
                type="number"
                value={verifyNonce}
                onChange={(e) => setVerifyNonce(parseInt(e.target.value) || 0)}
                className="font-mono text-xs h-8"
              />
            </div>
            <Button size="sm" onClick={handleVerify} disabled={!verifyServerSeed || !verifyClientSeed}>
              {t(lang, "verify")}
            </Button>

            {verifyResult && (
              <div
                className={`flex items-center gap-2 p-2 rounded text-xs font-mono ${
                  verifyResult.ok
                    ? "bg-accent/10 text-accent border border-accent/30"
                    : "bg-destructive/10 text-destructive border border-destructive/30"
                }`}
              >
                {verifyResult.ok ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                Computed: {verifyResult.m.toFixed(2)}×
                {verifyResult.expected > 0 && ` • Recorded: ${verifyResult.expected.toFixed(2)}×`}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
