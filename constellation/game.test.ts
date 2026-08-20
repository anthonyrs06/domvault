// Tests for the discovery/game layer: state schema, ranks, deterministic daily planet,
// and data-derived trails (no hardcoded planet ids — the registry changes).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STATE_KEY, emptyState, loadState, saveState, discover, discoveredSet,
  galaxyProgress, completion, computeRank, todaysPlanet, deriveTrails, planetKey,
} from "./game.js";

function planet(id: string, name: string, extra: object = {}) {
  return { name, manifest: { id, title: name, tags: [], ...extra } };
}
const DATA = {
  galaxies: [
    { id: "ai", name: "AI", color: "#7c5cff", stars: [
      { handle: "star_dom", display: "Dom", planets: [planet("p1", "Alpha"), planet("p2", "Beta")] },
    ] },
    { id: "sys", name: "Systems", color: "#5cd6a8", stars: [
      { handle: "star_dom", display: "Dom", planets: [planet("p3", "Gamma"), planet("p1", "Alpha")] }, // p1 multi-galaxy
    ] },
  ],
};

// a minimal localStorage stand-in
function memStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void } {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
}

test("state: versioned single key, corrupt/missing data degrades to empty", () => {
  const st = memStorage();
  assert.deepEqual(loadState(st).discovered, []);
  st.setItem(STATE_KEY, "{not json");
  assert.deepEqual(loadState(st).discovered, [], "corrupt JSON → fresh state");
  st.setItem(STATE_KEY, JSON.stringify({ v: 99, discovered: "?" }));
  assert.deepEqual(loadState(st).discovered, [], "wrong version → fresh state");
  const s = emptyState();
  discover(s, DATA.galaxies[0]!.stars[0]!.planets[0]);
  saveState(st, s);
  assert.equal(loadState(st).discovered.length, 1, "round-trips through storage");
});

test("discover: visit order kept, repeats ignored, multi-galaxy planet counts once", () => {
  const s = emptyState();
  assert.equal(discover(s, planet("p1", "Alpha")), true);
  assert.equal(discover(s, planet("p1", "Alpha")), false, "re-visiting is not a new discovery");
  discover(s, planet("p3", "Gamma"));
  assert.deepEqual(s.discovered.map((d) => d.id), ["p1", "p3"], "visit order preserved");
  const c = completion(s, DATA);
  assert.equal(c.total, 3, "p1 counted once across galaxies");
  assert.equal(c.done, 2);
});

test("galaxy progress + rank ladder (Astronomer needs a fully cleared galaxy)", () => {
  const s = emptyState();
  assert.equal(computeRank(s, DATA).name, "Observer");
  discover(s, planet("p1", "Alpha"));
  assert.equal(computeRank(s, DATA).name, "Stargazer");
  discover(s, planet("p2", "Beta"));
  const gp = galaxyProgress(s, DATA.galaxies[0]!);
  assert.deepEqual(gp, { done: 2, total: 2 }, "ai galaxy fully explored");
  assert.equal(computeRank(s, DATA).name, "Astronomer", "full galaxy outranks raw counts");
  discover(s, planet("p3", "Gamma"));
  assert.equal(computeRank(s, DATA).name, "Cosmographer", "100% = top rank");
});

test("todaysPlanet is deterministic per date and never random", () => {
  const a = todaysPlanet(DATA, "2026-08-19");
  const b = todaysPlanet(DATA, "2026-08-19");
  assert.ok(a && b);
  assert.equal(a!.id, b!.id, "same date → same planet");
  assert.ok(["p1", "p2", "p3"].includes(a!.id));
  assert.equal(todaysPlanet({ galaxies: [] }, "2026-08-19"), null, "empty universe → null");
});

test("trails derive from the data (grand tour spans galaxies; ids never hardcoded)", () => {
  const trails = deriveTrails(DATA);
  assert.ok(trails.length >= 1 && trails.length <= 3);
  const grand = trails.find((t) => t.id === "grand-tour");
  assert.ok(grand, "grand tour exists with 2+ galaxies");
  assert.equal(grand!.stops.length, 2, "one stop per galaxy");
  const gids = new Set(grand!.stops.map((st) => st.g.id));
  assert.deepEqual([...gids].sort(), ["ai", "sys"]);
  for (const t of trails) for (const st of t.stops) assert.ok(planetKey(st.p), "stops carry planets");
  assert.deepEqual(deriveTrails({ galaxies: [] }), [], "empty universe → no trails");
});
