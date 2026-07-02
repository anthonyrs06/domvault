// Default registry the Explorer reads from. Override per-visit with ?registry=<url>.
//
// Hosted registry: STATIC + git-backed on Vercel (registry-static/) — the repo is the
// durable planet store; rebuild+redeploy on publish. Cannot sleep or expire. Override per-visit
// with ?registry=<url> (e.g. ?registry=http://localhost:8787 for a local one). If the
// registry is unreachable, the Explorer degrades to the offline mock (mock/data.json).
export const DEFAULT_REGISTRY = "https://domvault-registry.vercel.app";
