import { useState } from "react";

export type NetworkWebsite = {
  masterId: string;
  name: string;
  domain: string;
  url: string;
  loginUrl: string;
  logoUrl?: string | null;
  defaultUrl?: string;
};

export function WebsiteLinks({ website }: { website: NetworkWebsite }) {
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  async function copy(url: string, label: string) {
    try {
      await navigator.clipboard.writeText(url);
      setFailed(false);
      setMessage(`${label} copied.`);
    } catch {
      setFailed(true);
      setMessage(
        "Copy is unavailable in this browser. Select and copy the link below.",
      );
    }
  }
  return (
    <section className="net-card net-website" aria-label="Your website links">
      <h2>Customer Playing Website</h2>
      {website.logoUrl && <img src={website.logoUrl} alt={`${website.name} logo`} style={{maxWidth:180,maxHeight:70,objectFit:'contain'}} />}
      <p>
        <strong>{website.name}</strong> · Playing domain:{" "}
        <strong>{website.domain}</strong>
      </p>
      <p>
        Share your branch website with players. They can browse games before
        signing in with their agent-created account.
      </p>
      {(
        [
          ["Player website", website.url],
          ["Player login", website.loginUrl],
        ] as const
      ).map(([label, url]) => (
        <div className="net-website-row" key={label}>
          <div>
            <strong>{label}</strong>
            <a href={url} target="_blank" rel="noopener noreferrer">
              {url}
            </a>
          </div>
          <div className="net-actions">
            <a
              className="net-link-button"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${label.toLowerCase()}`}
            >
              Open
            </a>
            <button
              type="button"
              onClick={() => void copy(url, label)}
              aria-label={`Copy ${label.toLowerCase()}`}
            >
              Copy link
            </button>
          </div>
        </div>
      ))}
      {message && (
        <p
          className={failed ? "net-error" : "net-success"}
          role={failed ? "alert" : "status"}
        >
          {message}
        </p>
      )}
      <a className="net-link-button" href={`https://wa.me/?text=${encodeURIComponent(`${website.name}\nBrowse games and play here: ${website.url}\nSign in with your player account to play.`)}`} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>
      {website.defaultUrl && website.defaultUrl!==website.url && <p>Permanent backup link: <a href={website.defaultUrl} target="_blank" rel="noopener noreferrer">{website.defaultUrl}</a></p>}
    </section>
  );
}
