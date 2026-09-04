// Apply an optional repository_dispatch note into frameworks/.
//
// Used by .github/workflows/constellation-publish.yml (plain Node, no tsx).
// Keep the rules here in sync with scripts/publish-from-vault.ts.
//
// client_payload: { filename, content }
//   filename — basename only, kebab-case .md (not README.md, no paths)
//   content  — complete markdown note with publish: true and frontmatter
//              handle / star / author / galaxy / title
// Empty payload = rebuild-only (exit 0).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FRAMEWORKS_DIR = join(ROOT, "frameworks");
export const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/;

export function safeFilename(input) {
  if (typeof input !== "string" || input.length === 0) return null;
  if (input.includes("/") || input.includes("\\") || input.includes("..")) return null;
  if (input.includes("\0") || input !== input.trim()) return null;
  if (!SAFE_NAME.test(input)) return null;
  if (input.toLowerCase() === "readme.md") return null;
  return input;
}

function fmBlock(raw) {
  const m = String(raw).replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : null;
}

export function fmField(fm, key) {
  const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!m) return "";
  return m[1].trim().replace(/^["']|["']$/g, "");
}

export function validateDispatchedNote(raw) {
  const fm = fmBlock(raw);
  if (!fm) return { ok: false, reason: "note needs YAML frontmatter" };
  if (fmField(fm, "publish") !== "true") return { ok: false, reason: "publish must be true" };
  for (const key of ["title", "handle", "star", "author", "galaxy"]) {
    if (!fmField(fm, key)) return { ok: false, reason: `missing frontmatter ${key}` };
  }
  return { ok: true, fm };
}

export function ensurePlanetId(raw, fm) {
  if (fmField(fm, "planet_id").startsWith("planet_")) return raw;
  const id = "planet_" + createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 40);
  return raw.replace(/^---\n/, `---\nplanet_id: ${id}\n`);
}

/**
 * Write a dispatch payload into frameworksDir.
 * @returns {{ status: "written"|"skipped", filename?: string, reason?: string }}
 */
export function applyDispatchPayload(payload, frameworksDir = FRAMEWORKS_DIR) {
  const filename = payload?.filename;
  const content = payload?.content;
  if ((filename === undefined || filename === null || filename === "") &&
      (content === undefined || content === null || content === "")) {
    return { status: "skipped", reason: "empty payload (rebuild-only)" };
  }
  if (typeof filename !== "string" || typeof content !== "string") {
    throw new Error("client_payload must include string filename and content");
  }
  const safe = safeFilename(filename);
  if (!safe) {
    throw new Error(`refusing filename ${JSON.stringify(filename)} (basename .md only, no paths, not README.md)`);
  }
  const check = validateDispatchedNote(content);
  if (!check.ok) throw new Error(check.reason);
  const out = ensurePlanetId(content.replace(/\r\n/g, "\n"), check.fm);
  mkdirSync(frameworksDir, { recursive: true });
  const dest = join(frameworksDir, safe);
  writeFileSync(dest, out.endsWith("\n") ? out : out + "\n", "utf8");
  return { status: "written", filename: safe };
}

export function applyFromEventPath(eventPath, frameworksDir = FRAMEWORKS_DIR) {
  if (!eventPath || !existsSync(eventPath)) {
    throw new Error("GITHUB_EVENT_PATH is missing; --apply-dispatch is for GitHub Actions");
  }
  const evt = JSON.parse(readFileSync(eventPath, "utf8"));
  const payload = evt.client_payload && typeof evt.client_payload === "object"
    ? evt.client_payload
    : {};
  return applyDispatchPayload(payload, frameworksDir);
}

function isMain() {
  const argv1 = process.argv[1];
  return Boolean(argv1) && import.meta.url === pathToFileURL(argv1).href;
}

if (isMain()) {
  try {
    const result = applyFromEventPath(process.env.GITHUB_EVENT_PATH, FRAMEWORKS_DIR);
    if (result.status === "skipped") {
      console.log(`No note in dispatch payload — ${result.reason}.`);
    } else {
      console.log(`Wrote frameworks/${result.filename}`);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
