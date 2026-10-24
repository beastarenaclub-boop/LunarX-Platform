# Ludo Live

`/ludo` is an authenticated, server-controlled multiplayer game. Two seats use red/yellow; four seats use all colours. Players are matched by seat count, entry and account channel (B2B rooms also share the same agent). A full room starts immediately. After 20 seconds, remaining seats become visibly labelled Computer players.

Entries are ₹10, ₹50, ₹100 or ₹500. Joining reserves the entry in the existing shared wallet and creates a normal bet/report record. The first player to take four tokens home receives 90% of `entry × seats`; 10% is the platform commission. Computer seats are house-funded. A Computer win does not credit any human account. Waiting-room cancellation refunds the entry; leaving a started game forfeits it. Unsettled entries are refunded if a match reaches two hours.

Rules v1: a six enters a token, exact roll to finish, safe star squares, captures return opponents to the yard, no stack blockades. Sixes, captures and reaching home grant another roll. Three consecutive sixes end the turn. Red starts. Each human roll/move allows 25 seconds; a missed action is played automatically and the player can resume afterwards. Bots make one action per second and use only the public board.

Match state, deadlines, seat ownership and every accepted action are persisted in PostgreSQL. A row lock serializes actions and payouts. Join/action UUIDs support safe retries; expected versions reject stale clicks. Partial unique indexes prevent multiple active seats per account. Wallet ledger changes and bet settlement share the room transaction. `ludo:<userId>` WebSocket notifications are restricted to that account; the browser also polls and reloads the saved snapshot after reconnect. Long server interruptions restart the action timer.

Each match commits to SHA-256 of a 32-byte random seed before play. Rolls use HMAC-SHA256 with message `ludo:v1:<matchId>:<zero-based nonce>:<block>`. Read bytes left-to-right, reject bytes ≥252, then take `byte % 6 + 1`. A new block is used only when needed. The seed and action/roll audit become available to participants at `/api/ludo/<id>/proof` once the match ends. The UI verifies the seed commitment and downloads that record. This is a reproducible server-seed commitment, not a third-party certification.

The additive `0057_ludo_matches` migration creates three tables and uniqueness/index constraints. Existing games and old application versions remain compatible. The normal API boot registers the game and starts the timer; no extra hosted service is required. Admins can pause new entries through the existing game control. In-progress games continue to settle.

Validation commands:

```sh
node artifacts/api-server/scripts/test-ludo.mjs
docker compose --profile network-test up -d --wait network-test-db
node artifacts/api-server/scripts/test-ludo.mjs --postgres
node artifacts/3d-game/node_modules/@playwright/test/cli.js test --config artifacts/3d-game/playwright.ludo.config.ts
```

Tests never use the development or production database. PostgreSQL tests create a disposable `ludo_test_<timestamp>` database on the local test server, apply the entire migration chain, and remove that specific database afterwards. The browser fixture is bound to loopback and is not imported into the application. It uses actual authenticated sessions, the production routes, engine and private WebSocket gateway, with isolated test funds. Production demo mode also runs in its existing isolated worker and cannot debit a real wallet.
