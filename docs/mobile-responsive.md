# Player website mobile layout

The player website reflows at native size. It does not scale an entire desktop canvas down to fit a phone.

- `src/mobile.css` contains the player website overrides. It loads after the shared game styles in `src/main.tsx`; lazy game styles are scoped by `.game-viewport`.
- `MobileNavigation` is shared by the lobby and account pages below 1024px. It includes safe-area spacing and hides while a text field is focused. Game pages keep their own controls.
- The lobby uses two columns below 480px, three below 701px, four below 851px, and five below 1024px. Phone search stays visible; category tabs scroll horizontally.
- Account forms and wallet tabs reflow to one column on phones. Auth forms precede artwork; landscape phones omit the artwork. Profile sign-out remains reachable on mobile.
- Touch controls are at least 44px where practical. Roulette's number board has 44px-wide cells on phones and an accessible horizontal scroller; edge bet hotspots remain aligned with the board.
- Recent-result strips scroll instead of clipping their buttons. Game viewports retain vertical scrolling for short screens and software keyboards. Dialogs respect available height and have 44px close buttons.

Run the mobile navigation, auth, account, and Instant Collection checks with:

```powershell
node artifacts/3d-game/node_modules/@playwright/test/cli.js test --config artifacts/3d-game/playwright.mobile-site.config.ts
```

The default server URL is `http://127.0.0.1:5328`; override `PLAYWRIGHT_BASE_URL` as needed. Set `MOBILE_BROWSER=webkit` for the WebKit navigation checks. The existing `playwright.responsive.config.ts` covers the remaining game layouts, including short screens, landscape, native control sizes, accessible scrolling, and information dialogs.

The lobby must use the window as its vertical scroller so its header stays sticky. Horizontal strips should be local `overflow-x: auto` regions, never a clipped substitute for reachable controls. Retain the nginx `no-store` header for `index.html` when deploying fresh bundles.
