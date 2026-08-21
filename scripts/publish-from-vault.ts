// publish-from-vault.ts — copy opt-in vault notes into frameworks/ and/or fire
// repository_dispatch so the constellation-publish Action rebuilds the public
// git-backed universe.json without a second human PR.
//
// INVARIANTS
//   • Only 30-frameworks/ and 80-synthesis/ neurons (sparks skipped).
//   • Only notes with publish: true. Default remains unpublished.
//   • Dispatch uses `gh api` with the already-authenticated CLI. No tokens
//     are invented or read from disk by this script.
//   • If dispatch is forbidden (no contents:write on dys5315/domvault), exit
//     with a clear message — never crash.
import { readdir, readFile, writeFile, mkdir, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join, relative, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";

import { parseNote } from "../client/frontmatter.ts";
// @ts-expect-error plain ESM helper without declarations
import { applyDispatchPayload, applyFromEventPath, safeFilename, FRAMEWORKS_DIR } from "./apply-dispatch.mjs";

export { applyDispatchPayload, applyFromEventPath, safeFilename };

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..");
export const DEFAULT_VAULT = process.env.DOMVAULT_VAULT || "/home/box/my-brain";
export const DEFAULT_REPO = process.env.CONSTELLATION_REPO || "dys5315/domvault";
export const DISPATCH_EVENT = "constellation-publish";
const SCAN_DIRS = ["30-frameworks", "80-synthesis"] as const;
const DEFAULT_LICENSE = "PolyForm-Noncommercial-1.0.0";
const DEFAULT_GALAXY = "frameworks";

export class PublishFromVaultError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "PublishFromVaultError";
    this.exitCode = exitCode;
  }
}

export interface PreparedNote {
  source: string;
  filename: string;
  content: string;
  title: string;
}

export type GhResult = { status: number; stdout: string; stderr: string };
export type GhFn = (args: string[], input: string) => Promise<GhResult>;

function isPublishTrue(value: unknown): boolean {
  return value === true || value === "true";
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

function asGalaxy(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  const s = asString(value);
  if (!s) return [];
  if (s.startsWith("[") && s.endsWith("]")) {
    return s.slice(1, -1).split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  }
  return [s];
}

function slugify(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug || "untitled"}.md`;
}

function makePlanetId(handle: string, title: string, body: string): string {
  const digest = createHash("sha256")
    .update(`${handle}|${title}|${body}`, "utf8")
    .digest("hex");
  return `planet_${digest.slice(0, 40)}`;
}

/** Insert `key: value` into the frontmatter block if the key is absent. */
export function injectFrontmatter(raw: string, extras: Record<string, string>): string {
  const text = raw.replace(/\r\n/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return text;
  const fmBlock = m[1];
  if (fmBlock === undefined) return text;
  let fm = fmBlock;
  const added: string[] = [];
  for (const [key, value] of Object.entries(extras)) {
    if (new RegExp(`^${key}:`, "m").test(fm)) continue;
    added.push(`${key}: ${value}`);
  }
  if (added.length === 0) return text;
  fm = fm + "\n" + added.join("\n");
  return text.replace(m[0], `---\n${fm}\n---`);
}

export function isSparkPath(rel: string): boolean {
  return rel.split(/[/\\]/).includes("sparks");
}

async function walkMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  let ents;
  try {
    ents = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "sparks" || e.name.startsWith(".")) continue;
      out.push(...await walkMarkdown(p));
    } else if (e.isFile() && e.name.endsWith(".md")) {
      out.push(p);
    }
  }
  return out;
}

export async function scanVault(vaultDir: string): Promise<PreparedNote[]> {
  const notes: PreparedNote[] = [];
  for (const sub of SCAN_DIRS) {
    const root = join(vaultDir, sub);
    const files = await walkMarkdown(root);
    for (const file of files.sort()) {
      const rel = relative(vaultDir, file);
      if (isSparkPath(rel)) continue;
      const raw = await readFile(file, "utf8");
      const prepared = prepareFrameworksNote(raw, file);
      if ("skip" in prepared) continue;
      notes.push(prepared);
    }
  }
  return notes;
}

/**
 * Make a vault note frameworks-style: require publish:true + title, fill
 * handle/star/author/galaxy/planet_id/license from env or defaults.
 */
export function prepareFrameworksNote(
  raw: string,
  sourcePath: string,
  env: NodeJS.ProcessEnv = process.env,
): PreparedNote | { skip: string } {
  const parsed = parseNote(raw);
  if (!parsed.hadFrontmatter) return { skip: "no frontmatter" };
  if (!isPublishTrue(parsed.frontmatter.publish)) return { skip: "publish is not true" };
  const title = asString(parsed.frontmatter.title);
  if (!title) return { skip: "missing title" };

  const handle = asString(parsed.frontmatter.handle) ?? asString(env.CONSTELLATION_HANDLE);
  const star = asString(parsed.frontmatter.star) ?? asString(env.CONSTELLATION_STAR);
  const author = asString(parsed.frontmatter.author)
    ?? asString(env.CONSTELLATION_DISPLAY)
    ?? handle;
  if (!handle || !star || !author) {
    return { skip: "missing handle/star/author (set frontmatter or CONSTELLATION_HANDLE/STAR/DISPLAY)" };
  }

  const galaxy = asGalaxy(parsed.frontmatter.galaxy);
  const extras: Record<string, string> = {
    handle,
    star,
    author,
    license: asString(parsed.frontmatter.license) ?? DEFAULT_LICENSE,
    galaxy: `[${(galaxy.length ? galaxy : [DEFAULT_GALAXY]).join(", ")}]`,
  };
  if (!asString(parsed.frontmatter.planet_id)) {
    extras.planet_id = makePlanetId(handle, title, parsed.body);
  }

  const content = injectFrontmatter(raw, extras);
  const base = basename(sourcePath);
  const filename = safeFilename(base) ?? slugify(title);
  return { source: sourcePath, filename, content, title };
}

export function formatGhCommand(repo: string, filename: string, content: string): string {
  const body = JSON.stringify({
    event_type: DISPATCH_EVENT,
    client_payload: { filename, content },
  }, null, 2);
  return `gh api --method POST repos/${repo}/dispatches --input - <<'JSON'\n${body}\nJSON`;
}

function defaultGh(args: string[], input: string): Promise<GhResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, { stdio: ["pipe", "pipe", "pipe"] });
    child.on("error", (err) => reject(err));
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.stdin.write(input);
    child.stdin.end();
    child.on("close", (code) => {
      resolve({ status: code ?? 1, stdout, stderr });
    });
  });
}

function isForbidden(status: number, text: string): boolean {
  return status === 401 || status === 403 || status === 404
    || /HTTP[_\s-]?40[134]/i.test(text)
    || /Resource not accessible|Must have admin|not found|Bad credentials|Requires authentication/i.test(text);
}

export async function dispatchNote(
  filename: string,
  content: string,
  opts: { repo?: string; gh?: GhFn } = {},
): Promise<void> {
  const repo = opts.repo ?? DEFAULT_REPO;
  const body = JSON.stringify({
    event_type: DISPATCH_EVENT,
    client_payload: { filename, content },
  });
  let result: GhResult;
  try {
    const gh = opts.gh ?? defaultGh;
    result = await gh(["api", "--method", "POST", `repos/${repo}/dispatches`, "--input", "-"], body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || /ENOENT|not found|not installed/i.test(msg)) {
      throw new PublishFromVaultError(
        `gh is not available. Install GitHub CLI and authenticate, or run:\n${formatGhCommand(repo, filename, content)}`,
        2,
      );
    }
    throw new PublishFromVaultError(`dispatch failed: ${msg}`, 2);
  }

  if (result.status === 0) return;

  const combined = `${result.stdout}\n${result.stderr}`;
  if (isForbidden(result.status, combined)) {
    throw new PublishFromVaultError(
      `Dispatch to ${repo} is forbidden (no contents:write on that repo). ` +
      `The Action lands notes on main without a PR only after you can write there — ` +
      `ask the operator to add you as a collaborator. Do not invent a token.\n\n` +
      `Printed command:\n${formatGhCommand(repo, filename, content)}`,
      2,
    );
  }
  throw new PublishFromVaultError(
    `dispatch failed (exit ${result.status}): ${combined.trim() || "(no output)"}`,
    2,
  );
}

export function rebuildStaticRegistry(repoRoot: string = REPO_ROOT): { ok: boolean; output: string } {
  const result = spawnSync(process.execPath, ["registry-static/build.mjs"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

export async function copyNote(note: PreparedNote, frameworksDir = FRAMEWORKS_DIR): Promise<string> {
  await mkdir(frameworksDir, { recursive: true });
  const dest = join(frameworksDir, note.filename);
  await writeFile(dest, note.content.endsWith("\n") ? note.content : note.content + "\n", "utf8");
  return dest;
}

export interface CliOptions {
  vault: string;
  dispatch: boolean;
  dryRun: boolean;
  noCopy: boolean;
  applyDispatch: boolean;
  help: boolean;
  repo: string;
}

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    vault: DEFAULT_VAULT,
    dispatch: false,
    dryRun: false,
    noCopy: false,
    applyDispatch: false,
    help: false,
    repo: DEFAULT_REPO,
  };
  for (const a of argv) {
    if (a === "--dispatch") opts.dispatch = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--no-copy") opts.noCopy = true;
    else if (a === "--apply-dispatch") opts.applyDispatch = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a.startsWith("--repo=")) opts.repo = a.slice("--repo=".length);
    else if (a.startsWith("-")) {
      throw new PublishFromVaultError(`unknown flag ${a} (see --help)`, 1);
    } else {
      opts.vault = a;
    }
  }
  return opts;
}

export const HELP = `Usage: npx tsx scripts/publish-from-vault.ts [vaultDir] [options]

Scan a vault for publish: true notes (30-frameworks + 80-synthesis neurons;
sparks skipped) and copy them into this repo's frameworks/ + rebuild, and/or
dispatch them to ${DEFAULT_REPO} so the constellation-publish Action commits
universe.json on main.

Options:
  --dispatch         Fire repository_dispatch via gh api (needs write on ${DEFAULT_REPO})
  --no-copy          Do not copy into local frameworks/
  --dry-run          Scan and print; no copy, no dispatch, no rebuild
  --apply-dispatch   CI helper: read GITHUB_EVENT_PATH and write the optional note
  --repo=owner/name  Override dispatch target (default ${DEFAULT_REPO})
  --help

Default vault: ${DEFAULT_VAULT} (override with argv or DOMVAULT_VAULT)

The public Explorer reads the static Vercel registry, not Fly. Dispatch (or a
frameworks/** push to main) is what updates that map without a second PR.
Signed POST to https://domvault-registry.fly.dev remains the long-term live path.
`;

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let opts: CliOptions;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    if (err instanceof PublishFromVaultError) {
      console.error(err.message);
      return err.exitCode;
    }
    throw err;
  }

  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }

  if (opts.applyDispatch) {
    try {
      const result = applyFromEventPath(process.env.GITHUB_EVENT_PATH, FRAMEWORKS_DIR);
      if (result.status === "skipped") {
        console.log(`No note in dispatch payload — ${result.reason}.`);
      } else {
        console.log(`Wrote frameworks/${result.filename}`);
      }
      return 0;
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
  }

  let vault = opts.vault;
  try {
    await access(vault, fsConstants.R_OK);
  } catch {
    const homeVault = join(process.env.HOME || "", "my-brain");
    if (vault === DEFAULT_VAULT && homeVault !== vault && existsSync(homeVault)) {
      vault = homeVault;
    } else {
      console.error(`Vault not found: ${vault}\nPass a path or set DOMVAULT_VAULT.`);
      return 3;
    }
  }

  const notes = await scanVault(vault);
  if (notes.length === 0) {
    console.log(`No publishable notes in ${vault} (looked in ${SCAN_DIRS.join(", ")}; sparks skipped).`);
    return 0;
  }

  console.log(`Found ${notes.length} publishable note(s) in ${vault}:`);
  let copied = 0;
  for (const note of notes) {
    console.log(`  - ${note.filename}  (${note.title})`);
    if (opts.dryRun) {
      console.log(formatGhCommand(opts.repo, note.filename, note.content));
      continue;
    }
    if (!opts.noCopy) {
      const dest = await copyNote(note);
      console.log(`    copied → ${relative(REPO_ROOT, dest)}`);
      copied++;
    }
    console.log("    dispatch with:");
    console.log(formatGhCommand(opts.repo, note.filename, note.content).replace(/^/gm, "    "));
    if (opts.dispatch) {
      try {
        await dispatchNote(note.filename, note.content, { repo: opts.repo });
        console.log(`    dispatched constellation-publish → ${opts.repo}`);
      } catch (err) {
        if (err instanceof PublishFromVaultError) {
          console.error(err.message);
          return err.exitCode;
        }
        throw err;
      }
    }
  }

  if (!opts.dryRun && copied > 0) {
    const rebuilt = rebuildStaticRegistry(REPO_ROOT);
    process.stdout.write(rebuilt.output);
    if (!rebuilt.ok) {
      console.error("registry-static rebuild failed.");
      return 1;
    }
  }

  if (!opts.dispatch && !opts.dryRun) {
    console.log(`\nLocal copy done. To publish without a PR (needs write on ${opts.repo}):`);
    console.log("  Re-run with --dispatch to fire constellation-publish via gh.");
  }
  return 0;
}

function isMain(): boolean {
  const argv1 = process.argv[1];
  return argv1 !== undefined && import.meta.url === pathToFileURL(argv1).href;
}

if (isMain()) {
  main().then((code) => process.exit(code), (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
