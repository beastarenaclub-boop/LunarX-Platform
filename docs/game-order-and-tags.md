# Game order and tags

Open **Admin → Game order & tags** (`/admin/lobby-layout`). The Crypto777
Websites page also links to this editor. Only admin and super-admin accounts
can read or change the administrative layout.

- **Lunar homepage:** the first 20 games appear in TOP Games; the rest follow.
- **Crypto777 homepage:** controls Now Trending. The Featured checkbox includes
  or removes a game from this row.
- **All Casino:** controls the Crypto777 grid for both Normal Play and Agent
  Play. Category and provider filters preserve the relative saved order.

Move games with the up/down buttons or type a position and press Enter. Search
and category filters retain full-list position numbers. Edit the card badge
(for example NEW, HOT or LIVE) or leave it blank to remove it. Comma-separated
search tags help players find games. Badges and tags are shared across views;
orders are independent. NEW badges retain their existing visual treatment and
New Games filtering, but do not override an administrator's saved positions.

Click **Save changes** to publish. Open player pages refresh layout settings
within 15 seconds or immediately on page refresh. Failed saves retain the draft.
Reload saved discards a draft after confirmation. Reset this order affects only
the selected view and requires Save changes. Saving from an old browser tab
after another admin's update returns a conflict instead of overwriting it.

## Installation and validation

Apply migration `0070_lobby_layout` with the existing database migration process
before restarting the API and publishing the two frontends. The migration only
adds the `lobby_layout` table. It does not change game balances, odds or enabled
states. Writes and their audit entries commit in one transaction.

Public settings: `GET /api/lobby/layout`. Admin settings: `GET/PUT
/api/admin/lobby-layout`. PUT requires `{ revision, layout }`; validated layout
contains independent orders, featured IDs and badge/tag metadata. The public
response excludes actor information. Demo players read the shared public layout
through the main API.

`lib/api-zod/src/lobby-catalog.ts` owns names, IDs and default metadata. Visual
artwork remains in the player's lobby catalog. Add new game metadata and its
artwork together; new IDs append to previously saved orders.

Run `node tools/test-lobby-layout.mjs` for isolated in-memory PostgreSQL tests
covering persistence, authorization, CSRF, validation, auditing and stale writes.
The browser test uses mocked network responses and the real frontends. With
the admin dev server on port 15175 and player frontend on port 5180, run from
`artifacts/api-server`: `node --import tsx ../../tools/test-lobby-layout-browser.mjs`.
Override `LOBBY_ADMIN_TEST_URL` and `LOBBY_PLAYER_TEST_URL` for other local ports.
