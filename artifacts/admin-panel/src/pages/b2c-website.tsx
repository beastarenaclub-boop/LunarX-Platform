import { useState } from "react";
import { ExternalLink, Globe, Monitor, Smartphone } from "lucide-react";
import { Link } from "wouter";

function storefrontUrl(agent = false) {
  const configured = (agent ? import.meta.env.VITE_B2C_AGENT_SITE_URL : import.meta.env.VITE_B2C_SITE_URL)?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (["http:", "https:"].includes(url.protocol)) return url.href;
    } catch {
      /* Use the existing website preview. */
    }
  }
  const { hostname, origin } = window.location;
  if (agent) return "https://play.crypto777.in/";
  if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname))
    return "http://127.0.0.1:5180/";
  if (hostname === "admin.lunarx.live") return "https://crypto777.in/";
  return new URL("/b2c", origin).href;
}

export default function B2CWebsite() {
  const [mobile, setMobile] = useState(false);
  const [agent, setAgent] = useState(false);
  const url = storefrontUrl(agent);
  return (
    <div className="p-4 md:p-7 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Globe className="h-6 w-6 text-emerald-600" />
            <h1 className="text-2xl font-bold text-slate-900">Crypto777 Websites</h1>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Normal Play and Agent Play share the Crypto777 design and existing games.
          </p>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white"
        >
          Open website <ExternalLink className="h-4 w-4" />
        </a>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Storefront
          </p>
          <p className="mt-2 font-semibold text-slate-900">
            Dark casino design
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Banner carousel, game categories, provider filters and player login.
          </p>
        </div>
        <div className="rounded-lg border bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Shared games
          </p>
          <p className="mt-2 font-semibold text-slate-900">
            Same catalog & game settings
          </p>
          <Link
            href="/games"
            className="mt-2 inline-block text-sm text-emerald-700 underline"
          >
            Manage games
          </Link>
        </div>
        <div className="rounded-lg border bg-white p-5">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Brand & domain
          </p>
          <p className="mt-2 font-semibold text-slate-900">
            CRYPTO777
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Normal players use crypto777.in. Agent-created players use
            play.crypto777.in with their assigned login details.
          </p>
        </div>
      </div>
      <section className="overflow-hidden rounded-lg border bg-white">
        <div className="flex flex-wrap gap-2 border-b px-4 py-3" role="group" aria-label="Player website">
          <button aria-pressed={!agent} onClick={() => setAgent(false)} className={`rounded px-4 py-2 text-sm ${!agent ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-700"}`}>Normal Play</button>
          <button aria-pressed={agent} onClick={() => setAgent(true)} className={`rounded px-4 py-2 text-sm ${agent ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-700"}`}>Agent Play</button>
          <Link href="/network" className="ml-auto px-3 py-2 text-sm text-emerald-700 underline">Manage agents & players</Link>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">
              Website preview
            </h2>
            <p className="mt-1 break-all text-xs text-slate-500">{url}</p>
          </div>
          <div className="flex gap-1 rounded-md bg-slate-100 p-1">
            <button
              aria-pressed={!mobile}
              onClick={() => setMobile(false)}
              className={`flex items-center gap-2 rounded px-3 py-1.5 text-xs ${!mobile ? "bg-white shadow-sm" : "text-slate-500"}`}
            >
              <Monitor size={15} />
              Desktop
            </button>
            <button
              aria-pressed={mobile}
              onClick={() => setMobile(true)}
              className={`flex items-center gap-2 rounded px-3 py-1.5 text-xs ${mobile ? "bg-white shadow-sm" : "text-slate-500"}`}
            >
              <Smartphone size={15} />
              Mobile
            </button>
          </div>
        </div>
        <div className="bg-slate-200 p-2 md:p-5">
          <iframe
            title={agent ? "Agent Play website preview" : "Normal Play website preview"}
            src={url}
            className={`mx-auto block h-[760px] max-w-full border-0 bg-[#22292e] shadow-lg transition-[width] ${mobile ? "w-[390px] rounded-xl" : "w-full rounded"}`}
          />
        </div>
        <p className="border-t px-4 py-3 text-xs text-slate-500">
          If the embedded preview is unavailable, use Open website. For local
          preview, start the B2C frontend with <code>npm run b2c:dev</code>.
        </p>
      </section>
    </div>
  );
}
