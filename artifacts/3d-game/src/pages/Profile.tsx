import { SiteLayout } from "@/components/site/SiteLayout";
import { useState, type FormEvent } from "react";
import {
  useGetProfile,
  useGetMyKyc,
  useSubmitKyc,
  uploadKycDocument,
  getGetMyKycQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";

const DOC_TYPES = [
  { value: "passport", label: "Passport" },
  { value: "drivers_license", label: "Driver's License" },
  { value: "national_id", label: "National ID" },
  { value: "aadhaar", label: "Aadhaar" },
  { value: "pan", label: "PAN" },
] as const;

type DocType = (typeof DOC_TYPES)[number]["value"];

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status)
    return (
      <Badge variant="outline" className="gap-1">
        <ShieldQuestion className="w-3 h-3" /> Not submitted
      </Badge>
    );
  if (status === "approved")
    return (
      <Badge className="gap-1 bg-emerald-500/20 text-emerald-700 border-emerald-500/30">
        <ShieldCheck className="w-3 h-3" /> Approved
      </Badge>
    );
  if (status === "rejected")
    return (
      <Badge variant="destructive" className="gap-1">
        <ShieldAlert className="w-3 h-3" /> Rejected
      </Badge>
    );
  return (
    <Badge variant="secondary" className="gap-1">
      <ShieldQuestion className="w-3 h-3" /> Pending review
    </Badge>
  );
}

export default function Profile() {
  const profile = useGetProfile();
  const kyc = useGetMyKyc();
  const qc = useQueryClient();

  const [fullName, setFullName] = useState("");
  const [documentType, setDocumentType] = useState<DocType>("aadhaar");
  const [documentNumber, setDocumentNumber] = useState("");
  const [idFile, setIdFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submitKyc = useSubmitKyc({
    mutation: {
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: getGetMyKycQueryKey() });
        toast.success("KYC submitted for review");
        setIdFile(null);
        setSelfieFile(null);
      },
      onError: (err: Error) => toast.error(err.message),
    },
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!idFile || !selfieFile) {
      toast.error("Both an ID document and a selfie are required");
      return;
    }
    setSubmitting(true);
    try {
      const idResp = await uploadKycDocument(`id-${idFile.name}`, idFile);
      const selfieResp = await uploadKycDocument(
        `selfie-${selfieFile.name}`,
        selfieFile,
      );
      const idKey = (idResp as { key: string }).key;
      const selfieKey = (selfieResp as { key: string }).key;
      submitKyc.mutate({
        data: {
          fullName,
          documentType,
          documentNumber,
          idDocumentKey: idKey,
          selfieKey: selfieKey,
        },
      });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const latest = kyc.data ?? null;
  const canResubmit = !latest || latest.status === "rejected";

  return (
    <SiteLayout
      title="Profile & KYC"
      description="Your account details and identity verification, all in one place."
    >
      <div className="site-profile-grid">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Email</span>
              <span data-testid="text-profile-email">
                {profile.data?.email ?? "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Display name</span>
              <span>{profile.data?.displayName ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Role</span>
              <span className="capitalize">{profile.data?.role ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className="capitalize">{profile.data?.status ?? "—"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>KYC Verification</CardTitle>
            <StatusBadge status={latest?.status} />
          </CardHeader>
          <CardContent className="space-y-3">
            {latest && (
              <div className="rounded-md border border-card-border bg-muted/30 p-3 text-xs space-y-1">
                <div>
                  Name on file: <strong>{latest.fullName}</strong>
                </div>
                <div>
                  Document: {latest.documentType.replace("_", " ")} •{" "}
                  {latest.documentNumber}
                </div>
                <div>
                  Submitted: {new Date(latest.submittedAt).toLocaleString()}
                </div>
                {latest.rejectionReason && (
                  <div className="text-destructive">
                    Reason: {latest.rejectionReason}
                  </div>
                )}
              </div>
            )}
            {canResubmit ? (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="fullName">Full legal name</Label>
                  <Input
                    id="fullName"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    data-testid="input-kyc-name"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Document type</Label>
                    <Select
                      value={documentType}
                      onValueChange={(v) => setDocumentType(v as DocType)}
                    >
                      <SelectTrigger data-testid="select-kyc-doctype">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DOC_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="docNum">Document number</Label>
                    <Input
                      id="docNum"
                      required
                      value={documentNumber}
                      onChange={(e) => setDocumentNumber(e.target.value)}
                      data-testid="input-kyc-docnum"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="idFile">ID document image</Label>
                  <Input
                    id="idFile"
                    type="file"
                    accept="image/*,application/pdf"
                    required
                    onChange={(e) => setIdFile(e.target.files?.[0] ?? null)}
                    data-testid="input-kyc-id-file"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="selfieFile">Selfie</Label>
                  <Input
                    id="selfieFile"
                    type="file"
                    accept="image/*"
                    required
                    onChange={(e) => setSelfieFile(e.target.files?.[0] ?? null)}
                    data-testid="input-kyc-selfie-file"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={submitting || submitKyc.isPending}
                  data-testid="btn-kyc-submit"
                >
                  {submitting || submitKyc.isPending
                    ? "Submitting…"
                    : "Submit for review"}
                </Button>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                Your KYC is currently {latest!.status}. Withdrawals are{" "}
                {latest!.status === "approved" ? "enabled" : "blocked"} until
                approval.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </SiteLayout>
  );
}
