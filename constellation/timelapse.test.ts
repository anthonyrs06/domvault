// Tests for the time-lapse replay logic (#/timelapse): ignition ordering,
// playback position → alive set, edges lacing in only when both ends exist —
// and the v4 SIMULATED growth history (seeded, labeled "simulated" in the UI).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  timelapseOrder, ignitedCount, ignitedSet, visibleEdges, collectEdges,
  simulateGrowth, simIgnitedCount,
} from "./timelapse.js";

const planet = (id: string, title: string, at: string | null, links: string[] = []) =>
  ({ name: title, manifest: { id, published_at: at, links } });

const DATA = {
  galaxies: [
    {
      id: "g1", name: "G1", color: "#fff",
      stars: [{ handle: "star_dom", display: "Dom", planets: [
        planet("planet_c", "Charlie", "2026-06-20T15:41:00Z", ["planet_a"]),
        planet("planet_a", "Alpha", "2026-06-20T15:41:00Z", ["planet_c", "planet_ghost"]),
        planet("planet_z", "Zulu", "2025-01-01T00:00:00Z"),
      ] }],
    },
    {
      id: "g2", name: "G2", color: "#000",
      stars: [{ handle: "star_dom", display: "Dom", planets: [
        planet("planet_a", "Alpha", "2026-06-20T15:41:00Z", ["planet_c"]), // multi-galaxy dupe
        planet("planet_b", "Bravo", "2026-07-01T00:00:00Z", ["planet_z"]),
      ] }],
    },
  ],
};

test("order: earliest published_at first, ties broken by title (stable + deduped)", () => {
  const order = timelapseOrder(DATA);
  assert.deepEqual(order.map((o) => o.id), ["planet_z", "planet_a", "planet_c", "planet_b"]);
  // planet_a appears in two galaxies but ignites exactly once
  assert.equal(order.filter((o) => o.id === "planet_a").length, 1);
});

test("degenerate corpus (one shared publish date) still yields a deterministic sweep", () => {
  const same = {
    galaxies: [{ id: "g", name: "G", color: "#fff", stars: [{ handle: "s", display: "S", planets: [
      planet("planet_2", "Beta", "2026-06-20T15:41:00Z"),
      planet("planet_1", "Alpha", "2026-06-20T15:41:00Z"),
      planet("planet_3", "Gamma", "2026-06-20T15:41:00Z"),
    ] }] }],
  };
  assert.deepEqual(timelapseOrder(same).map((o) => o.title), ["Alpha", "Beta", "Gamma"]);
  assert.deepEqual(timelapseOrder(same), timelapseOrder(same), "same input, same order");
});

test("ignitedCount maps t∈[0,1] to a monotonic planet count (clamped)", () => {
  const order = timelapseOrder(DATA);
  assert.equal(ignitedCount(order, 0), 0);
  assert.equal(ignitedCount(order, 1), 4);
  assert.equal(ignitedCount(order, 2), 4, "over-range clamps");
  assert.equal(ignitedCount(order, -1), 0, "under-range clamps");
  let prev = 0;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const n = ignitedCount(order, t);
    assert.ok(n >= prev, "monotonic");
    prev = n;
  }
});

test("edges lace in only once BOTH endpoints exist", () => {
  const order = timelapseOrder(DATA);
  const edges = collectEdges(DATA);
  // at t=0.5 exactly planet_z + planet_a are alive → no edge yet (a↔c needs c)
  assert.deepEqual(ignitedSet(order, 0.5), new Set(["planet_z", "planet_a"]));
  assert.equal(visibleEdges(edges, order, 0.5).length, 0);
  // at t=0.75 c ignites → a↔c appears; b↔z still waits for b
  assert.equal(visibleEdges(edges, order, 0.75).length, 1);
  assert.equal(visibleEdges(edges, order, 1).length, 2);
});

test("collectEdges dedupes the mirrored/multi-galaxy pairs and drops unresolved links", () => {
  const edges = collectEdges(DATA);
  assert.deepEqual(edges.sort(), [["planet_a", "planet_c"], ["planet_b", "planet_z"]].sort());
  assert.ok(!edges.flat().includes("planet_ghost"), "unresolved link dropped");
});

// ---- simulated growth (v4) ----
// A richer universe: g_hub is the most-connected galaxy (its planets touch 3 edge
// endpoints), h1 is its hub. One cross-galaxy bridge (h1 ↔ i1).
const SIM_DATA = {
  galaxies: [
    {
      id: "g_side", name: "Side", color: "#000",
      stars: [{ handle: "s", display: "S", planets: [
        planet("planet_i1", "Island one", null, ["planet_h1"]),
        planet("planet_i2", "Island two", null),
      ] }],
    },
    {
      id: "g_hub", name: "Hub", color: "#fff",
      stars: [{ handle: "s", display: "S", planets: [
        planet("planet_h3", "Hub leaf", null),
        planet("planet_h1", "Hub core", null, ["planet_h2", "planet_h3"]),
        planet("planet_h2", "Hub mid", null, ["planet_h1"]),
      ] }],
    },
  ],
};

test("simulateGrowth is deterministic (same input → identical timeline, no Math.random)", () => {
  assert.deepEqual(simulateGrowth(SIM_DATA), simulateGrowth(SIM_DATA));
});

test("simulateGrowth: the first spark is the hub of the most-connected galaxy, alone", () => {
  const sim = simulateGrowth(SIM_DATA);
  assert.equal(sim.planets[0].id, "planet_h1", "highest-degree planet founds");
  assert.equal(sim.planets[0].galaxy, "g_hub", "most-connected galaxy founds first");
  assert.equal(sim.planets[0].t, 0, "the story starts at t=0");
  // the founding spark holds alone before accretion begins
  assert.ok(sim.planets[1].t > 0, "second planet ignites strictly later");
});

test("simulateGrowth: within a galaxy, hubs ignite before leaves", () => {
  const sim = simulateGrowth(SIM_DATA);
  const hub = sim.planets.filter((p) => p.galaxy === "g_hub");
  // h1 deg 3 first; h2/h3 tie at deg 1 → title order ("Hub leaf" < "Hub mid")
  assert.deepEqual(hub.map((p) => p.id), ["planet_h1", "planet_h3", "planet_h2"],
    "edge-degree order (ties by title)");
  for (let i = 1; i < hub.length; i++) assert.ok(hub[i].t >= hub[i - 1].t, "times non-decreasing");
});

test("simulateGrowth: every edge laces strictly after BOTH endpoints exist", () => {
  const sim = simulateGrowth(SIM_DATA);
  const tOf = new Map(sim.planets.map((p) => [p.id, p.t]));
  for (const e of sim.edges) {
    assert.ok(e.t > Math.max(tOf.get(e.a)!, tOf.get(e.b)!), `edge ${e.key} after endpoints`);
  }
});

test("simulateGrowth: the first cross-galaxy bridge is identified and flagged", () => {
  const sim = simulateGrowth(SIM_DATA);
  assert.ok(sim.firstBridge, "a bridge exists in this universe");
  assert.equal(sim.firstBridge!.cross, true);
  assert.equal(sim.firstBridge!.key, "planet_h1|planet_i1");
  const crosses = sim.edges.filter((e) => e.cross);
  for (const c of crosses) assert.ok(c.t >= sim.firstBridge!.t, "firstBridge is the earliest bridge");
  assert.equal(sim.phases.bridge, sim.firstBridge!.t, "caption phase = the bridge moment");
});

test("simulateGrowth: all times normalized into [0, ~0.94] with settle room at the end", () => {
  const sim = simulateGrowth(SIM_DATA);
  const all = [...sim.planets.map((p) => p.t), ...sim.edges.map((e) => e.t)];
  for (const t of all) assert.ok(t >= 0 && t <= 0.9401, `t=${t} in range`);
  assert.ok(Math.max(...all) > 0.9, "the timeline actually uses its span");
});

test("simulateGrowth: island galaxies ignite after the founding galaxy starts", () => {
  const sim = simulateGrowth(SIM_DATA);
  const firstSide = sim.planets.find((p) => p.galaxy === "g_side")!;
  assert.ok(firstSide.t > 0, "second domain ignites later");
  assert.equal(sim.phases.domains, firstSide.t, "caption phase = second domain's ignition");
});

test("simIgnitedCount counts simulated ignitions monotonically (clamped)", () => {
  const sim = simulateGrowth(SIM_DATA);
  assert.equal(simIgnitedCount(sim, -1), simIgnitedCount(sim, 0), "under-range clamps");
  assert.equal(simIgnitedCount(sim, 2), sim.planets.length, "over-range clamps to all");
  let prev = 0;
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const n = simIgnitedCount(sim, t);
    assert.ok(n >= prev, "monotonic");
    prev = n;
  }
  assert.equal(prev, sim.planets.length);
});

test("simulateGrowth: multi-galaxy dupes ignite exactly once", () => {
  const sim = simulateGrowth(DATA); // DATA has planet_a in two galaxies
  assert.equal(sim.planets.filter((p) => p.id === "planet_a").length, 1);
  assert.equal(sim.planets.length, 4);
});
