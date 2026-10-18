import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type { NetworkWebsite } from "./network-website";
type Settings = {
  brand_name: string | null;
  logo_data: string | null;
  custom_domain: string | null;
  domain_token: string;
  domain_status: string;
  cnameTarget: string;
  website: NetworkWebsite;
};
const api = <T,>(path: string, body?: unknown, method = "POST") =>
  customFetch<T>(
    `/api/network/branding${path}`,
    body === undefined
      ? {}
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );

async function resizeLogo(file: File) {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 5_000_000
  )
    throw Error("Choose a PNG, JPEG or WebP image under 5 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 512 / bitmap.width, 512 / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const data = canvas.toDataURL("image/webp", 0.8);
  if (data.length > 85000) throw Error("Choose a simpler or smaller logo.");
  return data;
}
export function NetworkBranding({ masterId }: { masterId: string }) {
  const qc = useQueryClient();
  const data = useQuery({
    queryKey: ["network", "branding", masterId],
    queryFn: () => api<Settings>(`/${masterId}`),
  });
  if (data.isPending) return <p>Loading website settings…</p>;
  if (data.isError) return <p role="alert">{data.error.message}</p>;
  return (
    <BrandingForm
      key={`${masterId}:${data.dataUpdatedAt}`}
      settings={data.data}
      masterId={masterId}
      refresh={() => void qc.invalidateQueries({ queryKey: ["network"] })}
    />
  );
}
function BrandingForm({
  masterId,
  settings,
  refresh,
}: {
  masterId: string;
  settings: Settings;
  refresh: () => void;
}) {
  const [brand, setBrand] = useState(
    settings.brand_name ?? settings.website.name,
  );
  const [logo, setLogo] = useState(settings.logo_data);
  const [domain, setDomain] = useState(settings.custom_domain ?? "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(message);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const dnsName = settings.custom_domain
    ? `_lunarx.${settings.custom_domain}`
    : "";
  return (
    <section className="net-card" aria-label="Website branding settings">
      <h2>Your brand & custom domain</h2>
      <p>
        Your playing link is ready automatically. Add your own name, logo or
        domain below.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () =>
              api(
                `/${masterId}`,
                { brandName: brand, logoData: logo },
                "PATCH",
              ),
            "Branding saved.",
          );
        }}
      >
        <label className="net-field">
          <span>Website name</span>
          <input
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            minLength={2}
            maxLength={80}
            required
          />
        </label>
        <label className="net-field">
          <span>Upload your logo</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                setError("");
                setBusy(true);
                void resizeLogo(file)
                  .then(setLogo)
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }
            }}
          />
        </label>
        {logo && (
          <div className="net-actions">
            <img
              src={logo}
              alt="Logo preview"
              style={{ maxWidth: 180, maxHeight: 80 }}
            />
            <button type="button" onClick={() => setLogo(null)}>
              Remove logo
            </button>
          </div>
        )}
        <button className="net-primary" disabled={busy}>
          Save branding
        </button>
      </form>
      <hr style={{ margin: "24px 0" }} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () => api(`/${masterId}/domain`, { domain }, "PUT"),
            "Domain saved. Add the DNS records shown below.",
          );
        }}
      >
        <label className="net-field">
          <span>Your custom domain</span>
          <input
            placeholder="play.yourbrand.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            required
            maxLength={253}
          />
        </label>
        <button disabled={busy}>Save domain</button>
      </form>
      {settings.custom_domain && (
        <>
          <p>
            <strong>
              Domain status:{" "}
              {settings.domain_status === "active"
                ? "Live"
                : settings.domain_status === "provisioning"
                  ? "Preparing HTTPS — retry verification shortly"
                  : "Waiting for DNS"}
            </strong>
          </p>
          <p>
            In your domain provider’s DNS settings, add these records. Use the
            full names shown if your provider asks for a hostname.
          </p>
          <div className="net-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Name</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>CNAME</td>
                  <td>{settings.custom_domain}</td>
                  <td>{settings.cnameTarget}</td>
                </tr>
                <tr>
                  <td>TXT</td>
                  <td>{dnsName}</td>
                  <td style={{ overflowWrap: "anywhere" }}>
                    {settings.domain_token}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            For a root domain (yourbrand.com), use A → 216.24.57.1 instead of
            CNAME. Remove conflicting AAAA records for this hostname. Keep the
            TXT record for ownership checks.
          </p>
          <div className="net-actions">
            <button
              className="net-primary"
              disabled={busy}
              onClick={() =>
                void run(
                  () => api(`/${masterId}/domain/verify`, {}),
                  "DNS checked. If HTTPS is still preparing, retry shortly.",
                )
              }
            >
              Verify & activate domain
            </button>
            <button
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Disconnect this custom domain? Your permanent playing link will keep working.",
                  )
                )
                  void run(
                    () => api(`/${masterId}/domain`, {}, "DELETE"),
                    "Domain disconnected.",
                  );
              }}
            >
              Disconnect domain
            </button>
          </div>
        </>
      )}
      {busy && <p role="status">Saving / checking…</p>}
      {error && (
        <p className="net-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="net-success" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
