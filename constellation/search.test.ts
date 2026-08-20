// Tests for the Explorer's fuzzy planet search (titles + tags, deduped).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fuzzyScore, searchPlanets } from "./search.js";

const DATA = {
  galaxies: [
    {
      id: "ai", name: "AI", color: "#7c5cff",
      stars: [{ handle: "star_dom", display: "Dom", planets: [
        { name: "Agent Memory Is a Kalman Filter", manifest: { id: "p1", tags: ["agents", "memory"] } },
        { name: "The Holdout Rule", manifest: { id: "p2", tags: ["evaluation", "rubric"] } },
      ] }],
    },
    {
      id: "lead", name: "Leadership", color: "#e85c5c",
      stars: [{ handle: "star_dom", display: "Dom", planets: [
        // the same planet under a second galaxy — must dedupe
        { name: "Agent Memory Is a Kalman Filter", manifest: { id: "p1", tags: ["agents", "memory"] } },
      ] }],
    },
  ],
};

test("substring beats subsequence; prefix beats mid-string", () => {
  const exact = fuzzyScore("kalman", "Agent Memory Is a Kalman Filter");
  const scattered = fuzzyScore("kmn", "Agent Memory Is a Kalman Filter");
  assert.ok(exact > scattered, "substring outranks scattered subsequence");
  assert.ok(fuzzyScore("agent", "Agent Memory") > fuzzyScore("agent", "The Agent Memory"));
  assert.equal(fuzzyScore("zzz", "Agent Memory"), 0, "non-matches score 0");
  assert.equal(fuzzyScore("", "anything"), 0, "empty query matches nothing");
});

test("searchPlanets matches titles, dedupes multi-galaxy planets, respects limit", () => {
  const rs = searchPlanets(DATA, "kalman");
  assert.equal(rs.length, 1, "the multi-galaxy planet appears once");
  assert.equal(rs[0]!.p.manifest.id, "p1");
  assert.equal(searchPlanets(DATA, "").length, 0);
  assert.equal(searchPlanets(DATA, "holdout", 1).length, 1);
});

test("tags are searchable (fuzzy finds a planet by its tag)", () => {
  const rs = searchPlanets(DATA, "rubric");
  assert.ok(rs.some((r) => r.p.manifest.id === "p2"), "tag-only match surfaces the planet");
});
