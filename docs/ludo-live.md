# Ludo Live

The opening menu follows the user-supplied `Screen Recording 2026-10-25 190601.mp4`: shaped blue/gold account bar, illustrated crown/board logo, diagonal dice background, vertically stacked golden Online Multiplayer and Computer cards, More Coins, settings, rules and fullscreen. The account name and wallet remain live values. The star below the avatar opens match history; the lower-left play icon opens the game instructions. The reference's external ad/loading overlay is not part of the game UI. Hero artwork and its built-in imagegen prompt are saved in `public/media/ludo/classic-ludo-hero-v1.png` and the adjacent `.source.json`; local Barlow fonts include their OFL licences.

Desktop browsers open Ludo in a centred 440 px phone frame, including fullscreen. Size breakpoints follow that frame so the home menu, setup, matchmaking and live board use the same portrait UI as a phone. Small desktop windows scroll within the frame. Touch phones retain the compact landscape arrangement when rotated.

On phones the match uses the available visual viewport, including space taken by the demo banner and safe-area insets. A compact match header shows entry and prize, player dice remain 44 px, and a reserved action row keeps the board steady when legal moves appear. Portrait screens from 320 px are supported; short landscape screens put the board beside the player cards and controls. The menu and matchmaking also compact on short screens. The back arrow confirms forfeiting a live game before leaving, and settings, sound and music remain available.

Landscape has dedicated layouts for the home menu, colour/player/stake selection, opponent search and live matches. The match toolbar contains sound and music controls; rules, history and fullscreen are available through Settings. The board stays square and move buttons remain 44 px when the visible game area is as short as 230 px, including browser/session chrome. Rotation does not create a new match or change its entry, turn or legal moves.

Dice use six actual 3D faces. A local click starts the roll immediately, keeps it visible for at least 640 ms, then lands over 260 ms on the server's result. Opponent and Computer rolls animate on new roll nonces too. Each seat retains its last result; reloading or catching up multiple rolls does not replay old animations. Token actions stay disabled until the dice lands, and failed requests stop without inventing a result. Reduced-motion mode uses a short result reveal.

The lobby artwork and storefront Ludo cards have gentle light sweeps; reduced-motion preferences disable these effects. Original Web Audio effects provide dice rattle/landing, a six chime, token taps, captures, home/win tones and a final-five-second tick. Sound and optional background music have separate mute controls in the match and settings, persisted per player. Leaving the page disposes audio; switching tabs stops pending sounds. No third-party sound recordings are used.

The opening screen shows the player's profile, wallet, Online Multiplayer and Computer modes, plus working sound/music preferences. Online play opens table selection, then a red VS matchmaking screen using the actual room participants and server deadline. A waiting-room cancellation refunds the entry. No placeholder portrait is presented as a connected player, and no invented online-player count is displayed.

`POST /api/ludo/join` accepts optional `mode: "computer"` (omitted means online). Computer mode creates an isolated room and starts with 1 or 3 labelled Computer opponents immediately, using the same wallet entry, 90% winner prize and 10% platform commission. It never consumes seats from the public waiting queue. The pool suffix records the mode without a schema migration, and a join UUID cannot be reused with a different mode.

The UI uses an original blue-and-gold arcade lobby, a responsive classic board, vector pin tokens, and dice beside each player. Colour selection is a personal board view stored per account in the browser: a cyclic palette rotates all four colours together while preserving server seat IDs, token progress, legal moves, and turn order. The default shows your tokens as blue. Two players always occupy opposite corners. Player cards follow their displayed home colour, and Computer seats remain explicitly labelled. Entry presets and +/- controls show the prize after the 10% fee before joining.

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
