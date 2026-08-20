// Tests for the Explorer's hash routing (deep links: #/galaxy, #/star, #/planet).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoute, formatRoute, resolveRoute } from "./routes.js";

const DATA = {
  galaxies: [
    {
      id: "ai-engineering", name: "AI Engineering", color: "#7c5cff",
      stars: [{ handle: "star_dom", display: "Dom", planets: [
        { name: "Kalman", manifest: { id: "planet_k" } },
      ] }],
    },
    {
      id: "leadership", name: "Leadership", color: "#e85c5c",
      stars: [{ handle: "star_dom", display: "Dom", planets: [
        { name: "Trust", manifest: { id: "planet_t" } },
      ] }],
    },
  ],
};

test("parse/format round-trips every route kind", () => {
  for (const r of [
    { kind: "universe" },
    { kind: "galaxy", id: "ai-engineering" },
    { kind: "star", id: "star_dom" },
    { kind: "planet", id: "planet_k" },
  ] as const) {
    const parsed = parseRoute(formatRoute(r));
    assert.equal(parsed.kind, r.kind);
    if ("id" in r) assert.equal((parsed as { id?: string }).id, r.id);
  }
});

test("garbage or empty hashes fall back to universe (never throws)", () => {
  for (const h of ["", "#", "#/", "#/nope", "#/galaxy", "#/galaxy/", "#/wat/x/y"]) {
    assert.equal(parseRoute(h).kind, "universe", `hash ${JSON.stringify(h)}`);
  }
});

test("resolveRoute finds galaxies, stars, and planets", () => {
  const g = resolveRoute({ kind: "galaxy", id: "leadership" }, DATA, null);
  assert.equal(g!.view.mode, "galaxy");
  assert.equal(g!.view.galaxy.id, "leadership");

  const p = resolveRoute({ kind: "planet", id: "planet_t" }, DATA, null);
  assert.equal(p!.view.mode, "star");
  assert.equal(p!.planet.manifest.id, "planet_t");

  assert.equal(resolveRoute({ kind: "planet", id: "planet_missing" }, DATA, null), null);
  assert.equal(resolveRoute({ kind: "galaxy", id: "missing" }, DATA, null), null);
});

test("star routes prefer the galaxy already in view (handles repeat across galaxies)", () => {
  const current = { mode: "galaxy", galaxy: DATA.galaxies[1] }; // leadership in view
  const r = resolveRoute({ kind: "star", id: "star_dom" }, DATA, current);
  assert.equal(r!.view.star, DATA.galaxies[1].stars[0], "resolves within the viewed galaxy");
  const r2 = resolveRoute({ kind: "star", id: "star_dom" }, DATA, null);
  assert.equal(r2!.view.star, DATA.galaxies[0].stars[0], "falls back to the first galaxy");
});

test("#/read/<id> resolves like a planet route plus the read flag (landing view)", () => {
  const parsed = parseRoute(formatRoute({ kind: "read", id: "planet_k" }));
  assert.equal(parsed.kind, "read");
  const r = resolveRoute(parsed, DATA, null);
  assert.equal(r!.view.mode, "star");
  assert.equal(r!.planet.manifest.id, "planet_k");
  assert.equal(r!.read, true);
  assert.equal(resolveRoute({ kind: "read", id: "planet_missing" }, DATA, null), null);
  // plain planet routes do NOT set the read flag
  assert.ok(!resolveRoute({ kind: "planet", id: "planet_k" }, DATA, null)!.read);
});

test("#/timelapse parses and resolves to the universe with the timelapse flag", () => {
  assert.equal(parseRoute("#/timelapse").kind, "timelapse");
  assert.equal(formatRoute({ kind: "timelapse" }), "#/timelapse");
  const r = resolveRoute({ kind: "timelapse" }, DATA, null);
  assert.equal(r!.view.mode, "universe");
  assert.equal(r!.timelapse, true);
  assert.equal(r!.planet, null);
});
