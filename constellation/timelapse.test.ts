// Tests for the time-lapse replay logic (#/timelapse): ignition ordering,
// playback position → alive set, and edges lacing in only when both ends exist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { timelapseOrder, ignitedCount, ignitedSet, visibleEdges, collectEdges } from "./timelapse.js";

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
