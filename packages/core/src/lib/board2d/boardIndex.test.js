import assert from "node:assert/strict";
import test from "node:test";

import { createBoardIndex, pointInPolygon } from "./boardIndex.js";
import { drawBoardOverlay } from "./boardOverlay.js";

// A 40 x 30 mm sheet whose script origin sits at sheet (5, 25): script (10, 5) is sheet (15, 20).
const rect = (cx, cy, w, h) => [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
const BOARD = {
  origin: [5, 25],
  nets: [{ name: "VIN", class: "Power" }, { name: "GND", class: "Default" }, { name: "OUT", class: "Default" }],
  parts: [
    { ref: "R1", value: "10k", footprint: "Resistor_SMD:R_0603_1608Metric", side: "top", at: [15, 20], rotation: 0,
      fields: { MPN: "RC0603" }, script: "board.py:12", outline: rect(15, 20, 3, 1.4) },
    { ref: "U1", value: "AMP", footprint: "Test:SOT4", side: "bottom", at: [30, 10], rotation: 90, fields: {}, outline: rect(30, 10, 4, 3) },
  ],
  pads: [
    { part: "R1", number: "1", name: "~", net: "VIN", type: "passive", side: "top", at: [14.175, 20], polygon: rect(14.175, 20, 0.8, 0.95) },
    { part: "R1", number: "2", name: "~", net: "GND", type: "passive", side: "top", at: [15.825, 20], polygon: rect(15.825, 20, 0.8, 0.95) },
    { part: "U1", number: "2", name: "OUT", net: "OUT", type: "output", side: "bottom", at: [31.5, 9.05], polygon: rect(31.5, 9.05, 0.8, 0.95) },
    { part: "U1", number: "3", name: "GND", net: "GND", type: "passive", side: "bottom", at: [28.5, 10.95], polygon: rect(28.5, 10.95, 0.8, 0.95) },
    { part: "U1", number: "3", name: "GND", net: "GND", type: "passive", side: "bottom", at: [28.5, 9.05], polygon: rect(28.5, 9.05, 0.8, 0.95) },
  ],
  tracks: [{ net: "VIN", layer: "F.Cu", width: 0.5, points: [[14.175, 20], [14.175, 12]] }],
  vias: [{ net: "GND", at: [20, 15], diameter: 0.6, drill: 0.3 }],
  zones: [{ net: "GND", layer: "B.Cu", outline: [[0, 0], [40, 0], [40, 30], [0, 30]] }],
  holes: [{ at: [3, 3], diameter: 2.75 }],
  outline: [[[0, 0], [40, 0], [40, 30], [0, 30], [0, 0]]],
  findings: [{ check: "drc", severity: "warning", type: "silk_overlap", description: "Silkscreen clearance",
    items: [{ text: "Reference field of R1", ref: "#R1", at: [15, 20] }, { text: "Segment", ref: null, at: null }] }],
};

test("the script frame is y up from the board's origin, wherever the sheet is laid out", () => {
  const index = createBoardIndex(BOARD, { x: 2, y: 3 });
  assert.deepEqual(index.toScript([17, 23]), [10, 5]);
  assert.deepEqual(index.toPage([10, 5]), [17, 23]);
});

test("a press picks the most specific thing under it, filtered by the Select mode", () => {
  const index = createBoardIndex(BOARD);
  assert.equal(index.pick([14.175, 20]).selector, "#R1.1");
  assert.equal(index.pick([14.175, 20], { mode: "parts" }).selector, "#R1");
  assert.equal(index.pick([15.825, 20], { mode: "nets" }).selector, "#net:GND");
  // A track is its net at the nearest point of its centreline, to the hundredth of a millimetre.
  assert.equal(index.pick([14.3, 16]).selector, "#net:VIN@x9.18y9");
  assert.equal(index.pick([20.1, 15]).selector.startsWith("#net:GND@"), true);
  // Bare board inside a pour is nothing under All, and the pour's net under Nets.
  assert.equal(index.pick([2, 28]), null);
  assert.equal(index.pick([2, 28], { mode: "nets" }).selector, "#net:GND");
  assert.equal(index.pointSelector([5, 25]), "#@x0y0");
});

test("a pin with two pads is one pin, and a pick on either names it", () => {
  const index = createBoardIndex(BOARD);
  assert.equal(index.pick([28.5, 9.05]).selector, "#U1.3");
  assert.equal(index.pick([28.5, 10.95]).selector, "#U1.3");
  assert.equal(index.nets.get("GND").pads.length, 2, "R1.2 and U1.3, each once");
});

test("the side looked at decides between what overlaps", () => {
  const board = { ...BOARD, parts: [...BOARD.parts, { ref: "C9", value: "1u", footprint: "x", side: "top", at: [30, 10], rotation: 0, fields: {}, outline: rect(30, 10, 1, 1) }] };
  const index = createBoardIndex(board);
  assert.equal(index.pick([30, 10], { mode: "parts" }).selector, "#C9");
  assert.equal(index.pick([30, 10], { mode: "parts", view: "bottom" }).selector, "#U1");
});

test("a reference resolves to what it names, or to nothing on a board that lacks it", () => {
  const index = createBoardIndex(BOARD);
  assert.equal(index.resolve("#U1.3").pad.net, "GND");
  assert.equal(index.resolve("U1").part.side, "bottom");
  assert.deepEqual(index.resolve("#net:GND").net.pads.map((pad) => `${pad.ref}.${pad.number}`), ["R1.2", "U1.3"]);
  const copper = index.resolve("#net:VIN@x9.18y9");
  assert.equal(copper.item.kind, "track");
  assert.deepEqual(index.resolve("#@x1y2").page, [6, 23]);
  assert.equal(index.resolve("#C99"), null);
  assert.equal(index.resolve("#net:NOPE"), null);
  assert.equal(index.resolve("o1.f2"), null);
  assert.deepEqual(index.extent(index.resolve("#R1.1")).map((v) => Math.round(v * 1000) / 1000), [13.775, 19.525, 14.575, 20.475]);
});

test("a measurement snaps to pad centres, vias, holes and the outline", () => {
  const index = createBoardIndex(BOARD);
  assert.equal(index.snap([14.2, 20.1], { tolerance: 0.5 }).label, "R1.1");
  assert.equal(index.snap([14.2, 20.1], { tolerance: 0.5 }).selector, "#R1.1");
  assert.equal(index.snap([3.1, 3], { tolerance: 0.5 }).kind, "hole");
  assert.equal(index.snap([39.9, 29.9], { tolerance: 0.5, kinds: ["outline"] }).kind, "outline");
  assert.equal(index.snap([10, 10], { tolerance: 0.5 }), null);
});

test("checks keep their items' references and places", () => {
  const index = createBoardIndex(BOARD);
  assert.equal(index.findings[0].type, "silk_overlap");
  assert.deepEqual(index.findings[0].items.map((item) => item.ref), ["#R1", ""]);
  assert.ok(pointInPolygon([1, 1], [[0, 0], [2, 0], [2, 2], [0, 2]]));
});

test("the overlay draws a selection, a hover and a measurement without throwing", () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (target, key) => (key in target ? target[key] : (...args) => calls.push(key)), set: (target, key, value) => { target[key] = value; return true; } });
  const index = createBoardIndex(BOARD);
  drawBoardOverlay(ctx, index, {
    transform: { scale: 10, offsetX: 0, offsetY: 0 }, width: 400, height: 300, dim: true,
    selection: [index.resolve("#net:GND"), index.resolve("#R1")], hover: index.resolve("#U1.2"),
    measure: { points: [[14.175, 20]], draft: [20, 15] }, markers: [[15, 20]],
  });
  assert.ok(calls.includes("fillRect"), "the rest of the board steps back");
  assert.ok(calls.filter((call) => call === "stroke").length > 5);
});
