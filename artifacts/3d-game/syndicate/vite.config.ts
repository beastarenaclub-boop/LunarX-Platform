import vinext from "vinext";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "./build/sites-vite-plugin";
import { connectorPreview } from "./build/connector-preview-plugin.mjs";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

function localHttpsAuthority(): Plugin {
  return {
    name: "syndicate-local-https-authority",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        // The local Worker adapter reads Host from rawHeaders and drops HTTP/2
        // pseudo-headers. Preserve the actual TLS request authority for URL,
        // same-origin checks and secure cookies; never use forwarded headers.
        const authority = request.headers[":authority"];
        if (request.httpVersionMajor === 2 && typeof authority === "string") {
          if (request.headers.host && request.headers.host !== authority) {
            response.writeHead(400).end("Mismatched HTTP/2 authority.");
            return;
          }
          if (!request.headers.host) {
            request.headers.host = authority;
            request.rawHeaders.push("Host", authority);
          }
        }
        next();
      });
    },
  };
}

const localBindingConfig = {
  main: "./build/sites-worker.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ command }) => {
  // Opt-in local TLS; credentials stay in ignored, server-denied tool state.
  const localHttps = !managedLinux && command === "serve" &&
    process.env.SYNDICATE_LOCAL_HTTPS === "1"
    ? {
        pfx: readFileSync(new URL("./.sites-runtime/https/localhost.pfx", import.meta.url)),
        passphrase: readFileSync(new URL("./.sites-runtime/https/password.txt", import.meta.url), "utf8").trim(),
      }
    : undefined;
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      ...(localHttps ? { https: localHttps } : {}),
      ...(managedLinux
        ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] }
        : {}),
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      localHttps && localHttpsAuthority(),
      vinext(),
      sites({ mockAuth: !managedLinux }),
      connectorPreview(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: {
          ...localBindingConfig,
          ...(command === "serve"
            ? {
                services: [
                  {
                    binding: "CONNECTORS",
                    service: "sites-connector-preview",
                    entrypoint: "ConnectorPreview",
                  },
                ],
              }
            : {}),
        },
        ...(command === "serve"
          ? {
              auxiliaryWorkers: [
                {
                  config: {
                    name: "sites-connector-preview",
                    main: "./build/connector-preview-worker.mjs",
                    compatibility_date: "2026-05-15",
                  },
                },
              ],
            }
          : {}),
      }),
    ],
  };
});
