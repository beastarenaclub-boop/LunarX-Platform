import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ReactMarkdown from "react-markdown";

const DOC = `# Lunar Partner API (v1)

Base URL: \`https://<host>/v1\`

## Authentication

Every request must carry these headers:

- \`X-Partner-Key\`: your key id (returned at issuance)
- \`X-Partner-Timestamp\`: current unix milliseconds
- \`X-Partner-Nonce\`: unique 8–128 char string per request (e.g. UUID)
- \`X-Partner-Signature\`: HMAC-SHA256 of \`\${ts}.\${nonce}.\${rawBody}\` keyed by your secret, hex-encoded

Timestamp tolerance is ±5 minutes. Each nonce may be used only once per
key inside that window — replays are rejected. Rate limit: 120 req/min
per key. The plaintext secret is shown once at key issuance and never
travels over the wire — keep it server-side.

### Signing example (Node)
\`\`\`js
const crypto = require("crypto");
const ts = Date.now().toString();
const nonce = crypto.randomUUID();
const body = JSON.stringify(payload);
const sig = crypto.createHmac("sha256", SECRET)
  .update(\`\${ts}.\${nonce}.\${body}\`).digest("hex");
\`\`\`

## Endpoints

### GET /v1/games
Lists games allowed for the partner with config snapshot.

### GET /v1/games/:code/config
Returns full config for one game.

### POST /v1/rounds
Body: \`{ "gameCode": "lunar", "partnerRoundId": "<your-id>" }\`
Returns: \`{ "id", "serverSeedHash", "clientSeed", "nonce" }\`

### POST /v1/bets
Body: \`{ "gameCode", "playerRef", "stakeAmount", "partnerBetId" }\`
Idempotent on \`(partnerId, partnerBetId)\` — DB-enforced via a partial unique
index, so a 23505 conflict from a retry returns the original bet.
\`stakeAmount\` is paise as a string. Returns the bet object.

### GET /v1/bets/:id
Partner-scoped bet lookup.

### POST /v1/bets/:id/cashout
Body: \`{ "multiplier": 2.5 }\`

### Wallet (local-credits mode only)
- \`GET /v1/wallet/balance?playerRef=<ref>\`
- \`POST /v1/wallet/credit\` body \`{ playerRef, amount, reference? }\`
- \`POST /v1/wallet/debit\`  body \`{ playerRef, amount, reference? }\`

### GET /v1/rounds/:id/verify
Returns server seed, recomputed crash point, and verification status.

## Webhooks

Outbound POST to your \`webhookUrl\` for events:
- \`bet.placed\`
- \`bet.settled\`
- \`round.completed\`
- \`partner.suspended\`

Headers (note: all use the \`x-partner-*\` prefix):
- \`x-partner-event-type\`
- \`x-partner-event-id\`
- \`x-partner-timestamp\`
- \`x-partner-signature\`: hex HMAC-SHA256 of \`\${ts}.\${rawBody}\` keyed by your webhook secret

Body shape:
\`\`\`json
{
  "id": "<event id>",
  "type": "bet.settled",
  "createdAt": "<ISO 8601>",
  "data": { ... }
}
\`\`\`

Retry: 30s, 2m, 10m, 1h, 6h. After 5 failed attempts the delivery flips to
\`failed\` (replayable from the admin Webhooks tab, which also exposes the full
per-attempt history including request headers, body, response code, response
body, error message and duration).

## Wallet modes

### \`local-credits\`
Players' balances live in Lunar; you top up via \`/wallet/credit\` and read
via \`/wallet/balance\`. No outbound traffic.

### \`remote-wallet\`
Lunar calls **your** \`walletCallbackUrl\` to debit/credit:

\`POST {walletCallbackUrl}/debit\`
\`\`\`json
{ "op": "debit", "playerRef", "amount": "<paise as string>", "currency": "INR",
  "idempotencyKey", "betId", "gameCode" }
\`\`\`
\`POST {walletCallbackUrl}/credit\` — same shape with \`op: "credit"\`.

Headers:
- \`x-partner-timestamp\`
- \`x-partner-signature\`: hex HMAC-SHA256 of \`\${ts}.\${rawBody}\` keyed by your webhook secret
- \`x-partner-idempotency-key\`: must be deduped on your side

A 2xx response is required. Debit failure → bet rejected. Credit failure →
the durable \`bet.settled\` webhook is your recovery channel (your \`/credit\`
handler must be idempotent on \`betId\`).

## Iframe launcher

The launcher lets you drop the game into your own page as an iframe — no
direct API integration required for read-only embedding. Two-step flow:

1. **Server**: mint a single-use launch token via \`POST /v1/sessions\`:
\`\`\`json
{ "playerRef": "player-123", "gameCode": "lunar" }
\`\`\`
Response includes a \`launchUrl\` valid for 5 minutes and a one-time \`token\`.

2. **Browser**: drop the URL into an iframe. The launcher exchanges the
token for an HTTP-only session cookie, sets the partner context on every
subsequent bet, and streams events to your page via \`postMessage\`.

\`\`\`html
<iframe
  src="https://api.lunar.example/launch?token=...&gameCode=lunar"
  allow="autoplay; fullscreen; clipboard-write" allowfullscreen
  style="width:100%;height:100%;border:0"></iframe>
\`\`\`

The iframe is gated by a per-partner CSP \`frame-ancestors\` directive built
from \`allowedOrigins\` — make sure your serving origin is registered in the
partner record, or the browser will refuse to embed.

### postMessage protocol

All messages are namespaced \`type: "lunar:*"\` and include \`ts\` (epoch ms).
**Always validate \`event.origin\` matches the launcher origin** before
trusting payloads.

| Type                   | Payload                                                 |
| ---------------------- | ------------------------------------------------------- |
| \`lunar:gameLoaded\`     | \`{ gameCode }\`                                          |
| \`lunar:betPlaced\`      | \`{ betId, gameCode, stakeAmount }\`                      |
| \`lunar:betSettled\`     | \`{ betId, gameCode, status, multiplier, payoutAmount }\` |
| \`lunar:balanceChanged\` | \`{ balance, currency }\`                                 |
| \`lunar:error\`          | \`{ code, message }\`                                     |

\`stakeAmount\` and \`payoutAmount\` are paise as strings (avoid float drift).
\`status\` ∈ \`"cashed_out" | "lost"\`.

## JS SDK (\`@workspace/lunar-sdk\`)

Server side:
\`\`\`ts
import { LunarClient } from "@workspace/lunar-sdk";
const lunar = new LunarClient({ baseUrl, keyId, secret });
const { launchUrl } = await lunar.createSession({
  playerRef: "player-123",
  gameCode: "lunar",
});
\`\`\`

Browser:
\`\`\`ts
import { mountLunarGame } from "@workspace/lunar-sdk";
mountLunarGame({
  launchUrl,
  container: document.getElementById("lunar")!,
  onEvent: (e) => console.log(e),
});
\`\`\`

React:
\`\`\`tsx
import { LunarGameFrame } from "@workspace/lunar-sdk/react";
<LunarGameFrame launchUrl={launchUrl} onEvent={track} />
\`\`\`

Webhook verification:
\`\`\`ts
const ok = await LunarClient.verifyWebhook({
  secret, rawBody,
  timestampHeader: req.headers["x-partner-timestamp"],
  signatureHeader: req.headers["x-partner-signature"],
});
\`\`\`

Use the **Integration Demo** page in this console to mint a launch URL
against any partner and watch live \`lunar:*\` events without wiring code.

## Per-game RTP overrides

Partners may carry a per-game RTP override map (e.g. \`{ "lunar": 0.97 }\`)
that supersedes the platform default for that game only. Unset keys fall
back to the platform RTP.
`;

export default function DeveloperDocsPage() {
  return (
    <div className="p-6">
      <Card>
        <CardHeader>
          <CardTitle>Developer documentation</CardTitle>
        </CardHeader>
        <CardContent>
          <article className="prose prose-slate max-w-none prose-pre:bg-slate-900 prose-pre:text-emerald-300 prose-code:text-pink-700 prose-code:before:hidden prose-code:after:hidden">
            <ReactMarkdown>{DOC}</ReactMarkdown>
          </article>
        </CardContent>
      </Card>
    </div>
  );
}
