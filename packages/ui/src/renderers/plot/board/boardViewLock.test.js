import assert from "node:assert/strict";
import test from "node:test";
import { followDrawingViewport } from "./boardViewLock.js";

// A point of the board and a point of the ink that were on the same pixel stay on the same pixel.
const plotToScreen = (t, [x, y]) => [x * t.scale + t.offsetX, -y * t.scale + t.offsetY];
const inkToScreen = (v, [x, y]) => [(x + v.scrollX) * v.zoom, (y + v.scrollY) * v.zoom];
const screenToInk = (v, [x, y]) => [x / v.zoom - v.scrollX, y / v.zoom - v.scrollY];

test("the plot follows the editor's scroll and zoom, so ink stays on the board", () => {
  const lock = { transform: { scale: 8, offsetX: 100, offsetY: 400 }, viewport: { scrollX: 3, scrollY: -2, zoom: 1.5 } };
  const board = [12.5, 30];
  const ink = screenToInk(lock.viewport, plotToScreen(lock.transform, board));
  for (const viewport of [{ scrollX: 3, scrollY: -2, zoom: 1.5 }, { scrollX: 40, scrollY: 10, zoom: 1.5 }, { scrollX: -7, scrollY: 25, zoom: 3.25 }]) {
    const followed = followDrawingViewport(lock, viewport);
    const [bx, by] = plotToScreen(followed, board);
    const [ix, iy] = inkToScreen(viewport, ink);
    assert.ok(Math.abs(bx - ix) < 1e-9 && Math.abs(by - iy) < 1e-9, JSON.stringify(viewport));
  }
});
