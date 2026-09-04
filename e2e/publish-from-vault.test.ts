// Auto-publish plumbing: vault scan, dispatch payload, filename safety.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  scanVault,
  prepareFrameworksNote,
  parseArgs,
  formatGhCommand,
  dispatchNote,
  PublishFromVaultError,
  injectFrontmatter,
  isSparkPath,
  safeFilename,
  applyDispatchPayload,
} from "../scripts/publish-from-vault.ts";

const NOTE = (extra = "", body = "Body.") => `---
title: Trim Tabs Beat Thrust
author: Anthony Sadarangani
handle: anthony
star: star_anthony
publish: true
galaxy: [airplanes]
${extra}---

# Trim Tabs Beat Thrust

${body}
`;

function tmpVault(): string {
  const dir = mkdtempSync(join(tmpdir(), "domvault-vault-"));
  mkdirSync(join(dir, "30-frameworks"), { recursive: true });
  mkdirSync(join(dir, "80-synthesis", "sparks"), { recursive: true });
  mkdirSync(join(dir, "40-personal"), { recursive: true });
  return dir;
}

test("safeFilename accepts kebab.md and rejects paths / README", () => {
  assert.equal(safeFilename("trim-tabs-beat-thrust.md"), "trim-tabs-beat-thrust.md");
  assert.equal(safeFilename("../evil.md"), null);
  assert.equal(safeFilename("foo/bar.md"), null);
  assert.equal(safeFilename("README.md"), null);
  assert.equal(safeFilename("readme.md"), null);
  assert.equal(safeFilename(""), null);
});

test("scanVault finds 30-frameworks + 80-synthesis neurons, skips sparks and unpublished", async () => {
  const dir = tmpVault();
  try {
    writeFileSync(join(dir, "30-frameworks", "good.md"), NOTE());
    writeFileSync(join(dir, "30-frameworks", "nope.md"), NOTE().replace("publish: true", "publish: false"));
    writeFileSync(join(dir, "80-synthesis", "neuron.md"), NOTE("tags: [synthesis]\n"));
    writeFileSync(join(dir, "80-synthesis", "sparks", "spark.md"), NOTE());
    writeFileSync(join(dir, "40-personal", "secret.md"), NOTE());
    const found = await scanVault(dir);
    const names = found.map((n) => n.filename).sort();
    assert.deepEqual(names, ["good.md", "neuron.md"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prepareFrameworksNote injects planet_id and defaults without rewriting existing fields", () => {
  const prepared = prepareFrameworksNote(NOTE(), "/vault/30-frameworks/trim-tabs-beat-thrust.md", {});
  assert.ok(!("skip" in prepared));
  if ("skip" in prepared) return;
  assert.equal(prepared.filename, "trim-tabs-beat-thrust.md");
  assert.match(prepared.content, /^planet_id: planet_[a-f0-9]{40}$/m);
  assert.match(prepared.content, /^handle: anthony$/m);
  assert.match(prepared.content, /^galaxy: \[airplanes\]$/m);
});

test("prepareFrameworksNote skips unpublished and fills handle from env", () => {
  const unpublished = prepareFrameworksNote("---\ntitle: X\npublish: false\n---\n\nHi\n", "x.md");
  assert.deepEqual(unpublished, { skip: "publish is not true" });
  const raw = `---
title: Env Filled
publish: true
---

Hi
`;
  const prepared = prepareFrameworksNote(raw, "env-filled.md", {
    CONSTELLATION_HANDLE: "anthony",
    CONSTELLATION_STAR: "star_anthony",
    CONSTELLATION_DISPLAY: "Anthony Sadarangani",
  });
  assert.ok(!("skip" in prepared));
  if ("skip" in prepared) return;
  assert.match(prepared.content, /^handle: anthony$/m);
  assert.match(prepared.content, /^star: star_anthony$/m);
  assert.match(prepared.content, /^galaxy: \[frameworks\]$/m);
});

test("applyDispatchPayload writes a valid note and no-ops on empty payload", () => {
  const dir = mkdtempSync(join(tmpdir(), "domvault-fw-"));
  try {
    const empty = applyDispatchPayload({}, dir);
    assert.equal(empty.status, "skipped");
    const result = applyDispatchPayload({ filename: "good-note.md", content: NOTE("planet_id: planet_abc\n") }, dir);
    assert.equal(result.status, "written");
    assert.equal(result.filename, "good-note.md");
    const written = readFileSync(join(dir, "good-note.md"), "utf8");
    assert.match(written, /Trim Tabs Beat Thrust/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("applyDispatchPayload rejects path traversal and unpublished notes", () => {
  const dir = mkdtempSync(join(tmpdir(), "domvault-fw-"));
  try {
    assert.throws(() => applyDispatchPayload({ filename: "../x.md", content: NOTE() }, dir), /refusing filename/);
    assert.throws(
      () => applyDispatchPayload({ filename: "x.md", content: NOTE().replace("publish: true", "publish: false") }, dir),
      /publish must be true/,
    );
    assert.throws(
      () => applyDispatchPayload({ filename: "x.md", content: NOTE().replace("handle: anthony\n", "") }, dir),
      /missing frontmatter handle/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("formatGhCommand prints a constellation-publish repository_dispatch", () => {
  const cmd = formatGhCommand("dys5315/domvault", "good.md", NOTE());
  assert.match(cmd, /gh api --method POST repos\/dys5315\/domvault\/dispatches --input -/);
  assert.match(cmd, /"event_type": "constellation-publish"/);
  assert.match(cmd, /"filename": "good.md"/);
});

test("dispatchNote exits cleanly on 403 instead of throwing a crash", async () => {
  await assert.rejects(
    () => dispatchNote("good.md", NOTE(), {
      repo: "dys5315/domvault",
      gh: async () => ({ status: 1, stdout: "", stderr: "gh: HTTP 403 Resource not accessible by integration" }),
    }),
    (err: unknown) => {
      assert.ok(err instanceof PublishFromVaultError);
      assert.equal(err.exitCode, 2);
      assert.match(err.message, /forbidden/);
      assert.doesNotMatch(err.message, /undefined/);
      return true;
    },
  );
});

test("parseArgs: vault path, --dispatch, --dry-run, --no-copy", () => {
  const a = parseArgs(["/tmp/brain", "--dispatch", "--dry-run"]);
  assert.equal(a.vault, "/tmp/brain");
  assert.equal(a.dispatch, true);
  assert.equal(a.dryRun, true);
  assert.equal(a.noCopy, false);
  const b = parseArgs(["--no-copy", "--apply-dispatch"]);
  assert.equal(b.noCopy, true);
  assert.equal(b.applyDispatch, true);
});

test("isSparkPath and injectFrontmatter", () => {
  assert.equal(isSparkPath("80-synthesis/sparks/a.md"), true);
  assert.equal(isSparkPath("80-synthesis/neuron.md"), false);
  const injected = injectFrontmatter("---\ntitle: T\n---\n\nHi\n", { handle: "anthony" });
  assert.match(injected, /^handle: anthony$/m);
  const kept = injectFrontmatter("---\ntitle: T\nhandle: existing\n---\n\nHi\n", { handle: "anthony" });
  assert.match(kept, /^handle: existing$/m);
  assert.doesNotMatch(kept, /handle: anthony/);
});
