/**
 * What a person is pointing at, drawn over a board's or a schematic's plot: the hovered item, the
 * selection, the measurement in hand and the markers of a check. The plot stays KiCad's picture;
 * this draws on top of it, in the same pass, so a capture of the view shows what was selected.
 *
 * `resolved` items come from an index's `resolve()` or `pick()` (`createBoardIndex`,
 * `createSchematicIndex`); geometry is in page millimetres and is mapped through the view's
 * transform here. Pure canvas 2D: the viewer and a headless capture draw the same thing.
 */
import { pageToScreen } from "../plot2d/plot.js";

/** The viewer's highlight (the CAD views' ink highlight), and how the rest steps back for a net. */
export const BOARD_OVERLAY_COLORS = Object.freeze({
  selection: "#8dc5ff",
  hover: "rgba(141, 197, 255, 0.55)",
  dim: "rgba(0, 8, 20, 0.6)",
  measure: "#ffd166",
  marker: "#ff6b6b",
});
/** On a schematic's paper the highlight is a deeper blue, and the rest is washed out, not darkened. */
export const SCHEMATIC_OVERLAY_COLORS = Object.freeze({
  selection: "#1f6feb",
  hover: "rgba(31, 111, 235, 0.5)",
  fill: "rgba(31, 111, 235, 0.08)",
  dim: "rgba(245, 244, 239, 0.72)",
  measure: "#d97706",
  marker: "#d93025",
});

// A view maps page millimetres to the screen: the transform, through the bottom view's mirror.
function createView(transform, mirrorX) {
  const project = mirrorX == null ? (x, y) => pageToScreen(transform, x, y) : (x, y) => pageToScreen(transform, 2 * mirrorX - x, y);
  return { transform, project };
}

function path(ctx, view, points, close) {
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    const [sx, sy] = view.project(x, y);
    if (index === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  });
  if (close) ctx.closePath();
}

function strokePolygon(ctx, view, polygon, color, width, fill = null) {
  if (polygon.length < 2) return;
  path(ctx, view, polygon, true);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function strokeTrack(ctx, view, track, color, minimum) {
  path(ctx, view, track.points, false);
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(minimum, track.width * view.transform.scale);
  ctx.stroke();
}

function fillCircle(ctx, view, [x, y], radius, color, minimum = 0) {
  const [sx, sy] = view.project(x, y);
  ctx.beginPath();
  ctx.arc(sx, sy, Math.max(minimum, radius * view.transform.scale), 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function crosshair(ctx, view, [x, y], color, size = 7) {
  const [sx, sy] = view.project(x, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(sx - size, sy); ctx.lineTo(sx + size, sy);
  ctx.moveTo(sx, sy - size); ctx.lineTo(sx, sy + size);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(sx, sy, size * 0.45, 0, Math.PI * 2);
  ctx.stroke();
}

function drawCopperItem(ctx, view, item, color) {
  if (!item) return;
  if (item.kind === "track") strokeTrack(ctx, view, item, color, 3);
  else if (item.kind === "via") fillCircle(ctx, view, item.at, item.diameter / 2, color, 3);
  else if (item.kind === "zone") strokePolygon(ctx, view, item.outline, color, 2, "rgba(141, 197, 255, 0.18)");
}

function strokeLine(ctx, view, points, color, width) {
  path(ctx, view, points, false);
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = width;
  ctx.stroke();
}

// A schematic pin: its line from the body out to where a wire meets it, and a dot there.
function strokePin(ctx, view, pin, color, width) {
  if (pin.hidden) return;
  strokeLine(ctx, view, [pin.end, pin.at], color, width);
  fillCircle(ctx, view, pin.at, 0, color, width + 0.75);
}

/** One resolved schematic reference (or hit), highlighted in `color`. */
export function drawSchematicResolved(ctx, view, resolved, { color, fill, weight = 1 }) {
  if (!resolved) return;
  const shapesOf = (pad) => pad.part.pads.filter((shape) => shape.number === pad.number);
  if (resolved.kind === "part") {
    for (const unit of resolved.part.units) strokePolygon(ctx, view, unit.outline, color, 2 * weight, fill);
    for (const pin of resolved.part.pads) strokePin(ctx, view, pin, color, 1.5 * weight);
  } else if (resolved.kind === "pad") {
    for (const pin of shapesOf(resolved.pad)) strokePin(ctx, view, pin, color, 2.5 * weight);
  } else if (resolved.kind === "net") {
    const net = resolved.net;
    for (const wire of net.wires) strokeLine(ctx, view, wire.points, color, 2.5 * weight);
    for (const label of net.labels) strokePolygon(ctx, view, label.outline, color, 1.5 * weight, fill);
    for (const junction of net.junctions) fillCircle(ctx, view, junction.at, 0, color, 3.5 * weight);
    for (const pad of net.pads) for (const pin of shapesOf(pad)) strokePin(ctx, view, pin, color, 2 * weight);
  }
}

/** One resolved board reference (or hit), highlighted in `color`. */
export function drawResolved(ctx, view, resolved, { color, toPage, weight = 1 }) {
  if (!resolved) return;
  const kind = resolved.kind;
  const pinPads = (pad) => pad.part.pads.filter((shape) => shape.number === pad.number);
  if (kind === "part") {
    const part = resolved.part;
    strokePolygon(ctx, view, part.outline, color, 2 * weight, "rgba(141, 197, 255, 0.10)");
    for (const pad of part.pads) strokePolygon(ctx, view, pad.polygon, color, 1, "rgba(141, 197, 255, 0.35)");
  } else if (kind === "pad") {
    for (const shape of pinPads(resolved.pad)) strokePolygon(ctx, view, shape.polygon, color, 1.5 * weight, color);
  } else if (kind === "net") {
    const net = resolved.net;
    for (const zone of net.zones) strokePolygon(ctx, view, zone.outline, color, 1.5, "rgba(141, 197, 255, 0.12)");
    for (const track of net.tracks) strokeTrack(ctx, view, track, color, 2);
    for (const via of net.vias) fillCircle(ctx, view, via.at, via.diameter / 2, color, 2.5);
    for (const pad of net.pads) for (const shape of pinPads(pad)) strokePolygon(ctx, view, shape.polygon, color, 1, color);
  } else if (kind === "copper") {
    drawCopperItem(ctx, view, resolved.item, color);
    crosshair(ctx, view, resolved.page || toPage(resolved.at), color);
  } else if (kind === "point") {
    crosshair(ctx, view, resolved.page || toPage(resolved.at), color);
  }
}

/**
 * The overlay for one frame. `transform` maps page millimetres to CSS pixels; the context is set to
 * `pixelRatio` here. `dim`: the rest of the board steps back (a net or a check in focus).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof import("./boardIndex.js").createBoardIndex> | ReturnType<typeof import("./schematicIndex.js").createSchematicIndex>} index
 * @param {{ transform: object, pixelRatio?: number, width: number, height: number, hover?: object|null,
 *   selection?: object[], dim?: boolean, measure?: { points: number[][], draft?: number[]|null }|null,
 *   markers?: number[][], mirrorX?: number|null, colors?: typeof BOARD_OVERLAY_COLORS }} frame
 *   `mirrorX`: the page x the board is mirrored about (the view from the bottom), or null.
 */
export function drawBoardOverlay(ctx, index, { transform, pixelRatio = 1, width, height, hover = null, selection = [], dim = false,
  measure = null, markers = [], mirrorX = null, colors = null }) {
  if (!ctx || !index || !transform) return;
  const schematic = index.document === "schematic";
  colors = colors || (schematic ? SCHEMATIC_OVERLAY_COLORS : BOARD_OVERLAY_COLORS);
  const view = createView(transform, mirrorX);
  const draw = schematic
    ? (resolved, options) => drawSchematicResolved(ctx, view, resolved, { ...options, fill: colors.fill })
    : (resolved, options) => drawResolved(ctx, view, resolved, { ...options, toPage: index.toPage });
  ctx.save();
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  if (dim && selection.length) {
    ctx.fillStyle = colors.dim;
    ctx.fillRect(0, 0, width, height);
  }
  for (const resolved of selection) draw(resolved, { color: colors.selection, weight: 1.25 });
  if (hover && !selection.some((resolved) => resolved.selector === hover.selector)) draw(hover, { color: colors.hover });
  for (const marker of markers) {
    ctx.strokeStyle = colors.marker;
    ctx.lineWidth = 2;
    const [sx, sy] = view.project(marker[0], marker[1]);
    ctx.beginPath();
    ctx.arc(sx, sy, 9, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (measure && measure.points.length) {
    const points = measure.draft ? [...measure.points, measure.draft] : measure.points;
    ctx.setLineDash([5, 4]);
    path(ctx, view, points, false);
    ctx.strokeStyle = colors.measure;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    for (const at of points) fillCircle(ctx, view, at, 0, colors.measure, 3.5);
  }
  ctx.restore();
}
