// Tests for the registry builder's link mining (registry-static/build.mjs) —
// the edges ARE the product, so the miner is verified: explicit references win,
// concept-phrase mentions connect, generic words don't, and the real corpus
// yields a usable graph.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error plain ESM module without type declarations
import { parseFramework, conceptPhrases, mineLinks, buildUniverse } from "../registry-static/build.mjs";

const doc = (fn: string, title: string, pid: string, body: string) => ({
  fn, title, planetId: pid, body,
});

test("parseFramework extracts title, id, body, and the epigraph summary", () => {
  const d = parseFramework("x.md", [
    "---", "title: The Holdout Rule", "publish: true", "planet_id: planet_x", "---",
    "", "# The Holdout Rule", "", "> Keep some data the model never sees.", "", "Body text.",
  ].join("\n"));
  assert.equal(d.title, "The Holdout Rule");
  assert.equal(d.planetId, "planet_x");
  assert.equal(d.summary, "Keep some data the model never sees.");
  assert.match(d.body, /Body text\./);
});

test("parseFramework skips unpublished or malformed files", () => {
  assert.equal(parseFramework("a.md", "---\ntitle: T\npublish: false\nplanet_id: p\n---\nx"), null);
  assert.equal(parseFramework("b.md", "no frontmatter at all"), null);
  assert.equal(parseFramework("c.md", "---\npublish: true\n---\nx"), null, "missing title/id");
});

test("conceptPhrases keeps non-stopword bigrams only", () => {
  assert.deepEqual(conceptPhrases("Agent Memory Is a Kalman Filter"),
    ["agent memory", "kalman filter"]);
  assert.deepEqual(conceptPhrases("A Ranking Function for Trust"),
    ["ranking function"]);
});

test("explicit references resolve: wiki-links, sibling .md links, Related bullets", () => {
  const docs = [
    doc("alpha-note.md", "Alpha Note", "planet_a",
      "Mentions [[Beta Note]] inline and links to [gamma](./gamma-note.md).\n\n## Related\n- Delta Note\n"),
    doc("beta-note.md", "Beta Note", "planet_b", "Nothing shared here."),
    doc("gamma-note.md", "Gamma Note", "planet_c", "Nothing shared here either."),
    doc("delta-note.md", "Delta Note", "planet_d", "Standalone content."),
  ];
  const adj = mineLinks(docs);
  assert.deepEqual([...adj.get("planet_a")].sort(), ["planet_b", "planet_c", "planet_d"]);
  // mirrored (undirected)
  assert.ok(adj.get("planet_b").has("planet_a"));
  assert.ok(adj.get("planet_d").has("planet_a"));
});

test("a distinctive title phrase mentioned in another body creates a mirrored edge", () => {
  const docs = [
    doc("kalman.md", "Agent Memory Is a Kalman Filter", "planet_k",
      "Predict then correct, weighting evidence by trust."),
    doc("holdout.md", "The Holdout Rule", "planet_h",
      "Estimation loops like a kalman filter need untouched validation data."),
    doc("misc.md", "Unrelated Note", "planet_m", "Totally different topic."),
  ];
  const adj = mineLinks(docs);
  assert.ok(adj.get("planet_h").has("planet_k"), "holdout body mentions 'kalman filter'");
  assert.ok(adj.get("planet_k").has("planet_h"), "edge is mirrored");
  assert.equal(adj.get("planet_m").size, 0, "no phantom edges");
});

test("generic words do not create edges", () => {
  const docs = [
    doc("a.md", "The Production Problem", "planet_a", "Some body."),
    doc("b.md", "Another Note", "planet_b", "We shipped this to production and it was a problem."),
  ];
  const adj = mineLinks(docs);
  assert.equal(adj.get("planet_b").size, 0, "'production'/'problem' are blocklisted as generic");
});

test("determinism: same corpus in, same edges out", () => {
  const docs = [
    doc("k.md", "Kalman Filter Memory", "p1", "About the double pendulum."),
    doc("p.md", "The Double Pendulum", "p2", "A kalman filter analogy."),
  ];
  const one = mineLinks(docs), two = mineLinks(docs);
  assert.deepEqual(
    [...one.entries()].map(([k, v]) => [k, [...v].sort()]),
    [...two.entries()].map(([k, v]) => [k, [...v].sort()]));
});

test("the real corpus yields a usable graph (>= 15 edges, no self-links, ids resolve)", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const { planets, edgeCount } = buildUniverse(root);
  assert.ok(planets.length >= 40, `expected the framework corpus, got ${planets.length}`);
  assert.ok(edgeCount >= 15, `edge yield too thin: ${edgeCount}`);
  const ids = new Set(planets.map((p: { id: string }) => p.id));
  for (const p of planets) {
    assert.ok(!p.links.includes(p.id), `${p.id} links to itself`);
    for (const l of p.links) assert.ok(ids.has(l), `unresolved link ${l} on ${p.id}`);
    assert.equal(typeof p.content, "string");
    assert.ok(p.content.length > 100, `${p.id} content missing`);
  }
});
