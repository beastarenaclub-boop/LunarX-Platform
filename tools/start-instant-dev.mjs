import { spawn } from "node:child_process";
const child = spawn(process.execPath, ["artifacts/3d-game/node_modules/vite/bin/vite.js", "--config", "artifacts/3d-game/vite.config.ts", "--host", "127.0.0.1"], {
  cwd: new URL("..", import.meta.url), env: { ...process.env, PORT: process.env.PORT ?? "5327" }, stdio: "inherit", windowsHide: true,
});
child.on("exit", code => process.exit(code ?? 1));
