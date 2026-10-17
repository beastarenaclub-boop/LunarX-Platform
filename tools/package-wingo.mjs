import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = resolve(root, "exports/wingo-colour-club-2026-10-03");
if (existsSync(output)) throw new Error(`Package already exists: ${output}`);
if (!existsSync(resolve(root, "artifacts/3d-game/dist/wingo/index.html")))
  throw new Error("Run npm run wingo:build first.");
mkdirSync(output, { recursive: true });
cpSync(
  resolve(root, "artifacts/3d-game/dist/wingo"),
  resolve(output, "dist/wingo"),
  { recursive: true },
);
cpSync(resolve(root, "artifacts/3d-game/wingo"), resolve(output, "source"), {
  recursive: true,
});
// Keep the reusable winning receipt available in the standalone source export.
mkdirSync(resolve(output, "source/src/shared/wins"), { recursive: true });
for (const file of ["RoundWinPopup.tsx", "useGameScreenBounds.ts", "round-win-dialog.css"]) {
  cpSync(resolve(root, "artifacts/3d-game/src/components/table", file),
    resolve(output, "source/src/shared/wins", file));
}
const appSource = resolve(output, "source/src/App.tsx");
writeFileSync(appSource, readFileSync(appSource, "utf8").replace(
  '"../../src/components/table/RoundWinPopup"', '"./shared/wins/RoundWinPopup"',
));
mkdirSync(resolve(output, "server/tests"), { recursive: true });
for (const file of [
  "server.mjs",
  "store.mjs",
  "tests/store.test.mjs",
  "tests/http.test.mjs",
]) {
  cpSync(
    resolve(root, "artifacts/3d-game/wingo-server", file),
    resolve(output, "server", file),
  );
}
const pkg = {
  name: "wingo-colour-club",
  version: "1.0.0",
  private: true,
  type: "module",
  engines: { node: ">=24.0.0" },
  scripts: {
    start: "node server/server.mjs",
    build: "vite build",
    dev: "vite",
    check: "tsc -p source/tsconfig.json --noEmit",
    test: "node --test server/tests/*.test.mjs",
  },
  dependencies: {
    react: "19.1.0",
    "react-dom": "19.1.0",
    "lucide-react": "0.545.0",
    "@radix-ui/react-dialog": "1.1.15",
  },
  devDependencies: {
    vite: "7.3.2",
    "@vitejs/plugin-react": "5.1.4",
    typescript: "~5.9.2",
    "@types/react": "19.2.14",
    "@types/react-dom": "19.2.3",
    "@types/node": "25.3.5",
  },
};
writeFileSync(
  resolve(output, "package.json"),
  JSON.stringify(pkg, null, 2) + "\n",
);
writeFileSync(
  resolve(output, "vite.config.ts"),
  `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ root: 'source', plugins: [react()],
  build: { outDir: '../dist/wingo', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5193, strictPort: true, proxy: { '/api/wingo': 'http://127.0.0.1:5192' } }
});\n`,
);
writeFileSync(
  resolve(output, "source/tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        jsx: "react-jsx",
        lib: ["ESNext", "DOM", "DOM.Iterable"],
        types: ["vite/client"],
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        esModuleInterop: true,
      },
      include: ["src"],
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  resolve(output, "START-WINGO.cmd"),
  '@echo off\r\ncd /d "%~dp0"\r\necho Open http://localhost:5192 in your browser.\r\nnode server/server.mjs\r\npause\r\n',
);
writeFileSync(resolve(output, ".gitignore"), "node_modules/\ndata/\ntmp/\n");
writeFileSync(
  resolve(output, "README.md"),
  `# Win Go — Colour Club

Ready-to-run colour prediction practice game with source code.

## Play

Install Node.js 24 or newer, then double-click START-WINGO.cmd on Windows.
Or run: node server/server.mjs

Open http://localhost:5192. The compiled website is included: no npm install is needed to play.
Keep the server terminal open while playing. To stop, press Ctrl+C.

## Included

30s / 1m / 3m / 5m timers; colour, number and Big/Small picks; responsive UI;
10,000 starting practice coins; saved balance and history; number chart; CSV export;
result commitment verification; optional sound; free low-balance refills.

Virtual coins only. No cash deposit, withdrawal or shared casino wallet.

## Edit and rebuild

Source UI: source/src/
Server: server/
Prebuilt website: dist/wingo/
Saved data: data/wingo.sqlite (created on first run).

Run npm install, then npm run build to rebuild after changing the source.
Run npm run check for TypeScript and npm test for the 11 server checks.
For live development: keep npm start running and run npm run dev in a second terminal.
Development URL: http://localhost:5193.

The full implementation notes, rules and research links are in IMPLEMENTATION.md.
Previews are included in previews/ when available.
`,
);
cpSync(
  resolve(root, "docs/wingo-colour-club.md"),
  resolve(output, "IMPLEMENTATION.md"),
);
for (const file of ["desktop.png", "mobile.png"]) {
  const source = resolve(root, "tmp/wingo-review", file);
  if (existsSync(source)) {
    mkdirSync(resolve(output, "previews"), { recursive: true });
    cpSync(source, resolve(output, "previews", file));
  }
}
const notices = [];
for (const name of [
  "react",
  "react-dom",
  "lucide-react",
  "@radix-ui/react-dialog",
]) {
  const location = resolve(root, "artifacts/3d-game/node_modules", name);
  for (const filename of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) {
    if (existsSync(resolve(location, filename))) {
      notices.push(
        `${name}\n${"=".repeat(name.length)}\n${readFileSync(resolve(location, filename), "utf8")}`,
      );
      break;
    }
  }
}
writeFileSync(resolve(output, "THIRD-PARTY-NOTICES.txt"), notices.join("\n\n"));
console.log(`Win Go package: ${output}`);
