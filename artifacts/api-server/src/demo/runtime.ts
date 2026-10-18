// Replaced at build time ONLY in demo-worker.mjs. An environment variable
// cannot accidentally turn a production wallet into an unlimited wallet.
declare const __DEMO_WORKER__: boolean;
export const DEMO_RUNTIME = typeof __DEMO_WORKER__ !== "undefined" && __DEMO_WORKER__;
