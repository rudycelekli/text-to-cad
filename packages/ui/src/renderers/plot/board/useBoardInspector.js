/**
 * A KiCad document's inspection: what Select and Measure do on a board's plot (Select alone on a
 * schematic's), and what they hand over — the selection as board references (`#U3`, `#U3.9`,
 * `#net:VIN`, and on a board `#net:VIN@x..y..`), for Quick Edit, the copy key and the live
 * controller. Read-only: nothing here changes the design.
 *
 * Pointer moves are many and the picture is a canvas, so the hover lives in a ref and repaints
 * the canvas; React re-renders only for what the panels show (the selection, the measurements).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBoardIndex } from "@text-to-cad/core/lib/board2d/boardIndex.js";
import { createSchematicIndex } from "@text-to-cad/core/lib/board2d/schematicIndex.js";
import { drawBoardOverlay } from "@text-to-cad/core/lib/board2d/boardOverlay.js";
import { buildBoardRefToken, parseBoardRefSelector } from "@text-to-cad/core/lib/boardRefs.js";
import { screenToPage } from "@text-to-cad/core/lib/plot2d/index.js";

export const BOARD_TOOL = Object.freeze({ SELECT: "select", MEASURE: "measure", DRAW: "draw" });
// How far a pick may miss a small thing (a via, a thin track), and how far Measure reaches to snap.
const PICK_SLOP_PX = 4;
const SNAP_PX = 10;
const EMPTY = Object.freeze([]);
const MEASURE_KINDS = Object.freeze({ all: null, pads: ["pads"], copper: ["copper"], outline: ["outline"] });
let measurementSequence = 0;

/**
 * @param {object} options
 * @param {{ layout: object, board?: object, schematic?: object }|null} options.plot  The plot on screen.
 * @param {{ current: object|null }} options.transformRef  The view (page mm -> pane px).
 * @param {() => void} options.requestPaint
 * @param {{ current: HTMLCanvasElement|null }} options.canvasRef
 * @param {"top"|"bottom"} [options.side]  The side the board is looked at from: bottom is mirrored.
 */
export function useBoardInspector({ plot, transformRef, requestPaint, canvasRef, side = "top" }) {
  const layout = plot?.layout ?? null;
  const board = plot?.board ?? layout?.board ?? null;
  const schematic = board ? null : plot?.schematic ?? null;
  const sheets = layout?.sheets ?? null;
  const sheet = sheets?.[0] ?? null;
  const index = useMemo(() => {
    if (board && sheet) return createBoardIndex(board, { x: sheet.x, y: sheet.y });
    if (schematic && sheets) return createSchematicIndex(schematic, sheets);
    return null;
  }, [board, schematic, sheet, sheets]);
  // Only a board is seen from below: mirrored about its sheet's middle.
  const mirrorX = index?.document === "board" && side === "bottom" && sheet ? sheet.x + sheet.width / 2 : null;

  const [tool, setTool] = useState(BOARD_TOOL.SELECT);
  const [selectMode, setSelectMode] = useState("all");
  const [measureMode, setMeasureMode] = useState("all");
  const [selection, setSelection] = useState(EMPTY);
  const [focusedFinding, setFocusedFinding] = useState(null);
  const [measurements, setMeasurements] = useState(EMPTY);
  const [measureStart, setMeasureStart] = useState(null);
  const hoverRef = useRef(null);
  const draftRef = useRef(null);
  // The viewer's copy of a reference (a double-click's), which the renderer hands the clipboard.
  const copyRef = useRef(null);

  // A new revision of the board keeps what still names something on it.
  useEffect(() => {
    if (!index) return;
    setSelection((current) => {
      const kept = current.filter((selector) => index.resolve(selector));
      return kept.length === current.length ? current : kept;
    });
    hoverRef.current = null;
  }, [index]);

  const resolved = useMemo(() => (index ? selection.map((selector) => index.resolve(selector)).filter(Boolean) : EMPTY), [index, selection]);
  const finding = focusedFinding != null && index ? index.findings[focusedFinding] ?? null : null;
  const markers = useMemo(() => (finding ? finding.items.map((item) => item.at).filter(Boolean) : EMPTY), [finding]);
  // A net or a check in focus is easier to read with the rest of the board stepped back.
  const dim = resolved.some((item) => item.kind === "net") || Boolean(finding);

  // ---- what the canvas draws over the plot -------------------------------------
  const overlayState = useRef({});
  overlayState.current = { index, resolved, dim, markers, measurements, measureStart, mirrorX };
  const paintOverlay = useCallback((ctx, frame) => {
    const state = overlayState.current;
    if (!state.index || !frame.transform) return;
    const draft = draftRef.current;
    const measure = state.measureStart ? { points: [state.measureStart.page], draft: draft?.page ?? null } : null;
    drawBoardOverlay(ctx, state.index, {
      transform: frame.transform, pixelRatio: frame.pixelRatio, width: frame.width, height: frame.height,
      hover: hoverRef.current, selection: state.resolved, dim: state.dim, markers: state.markers, mirrorX: state.mirrorX,
      measure,
    });
    for (const measurement of state.measurements) {
      drawBoardOverlay(ctx, state.index, {
        transform: frame.transform, pixelRatio: frame.pixelRatio, width: frame.width, height: frame.height,
        mirrorX: state.mirrorX, measure: { points: [measurement.a.page, measurement.b.page] },
      });
    }
  }, []);
  useEffect(() => { requestPaint?.(); }, [resolved, dim, markers, measurements, measureStart, mirrorX, requestPaint]);

  // ---- from the pane to the board ---------------------------------------------
  const toPage = useCallback(({ x, y }) => {
    const transform = transformRef.current;
    if (!transform) return null;
    const [px, py] = screenToPage(transform, x, y);
    return [mirrorX == null ? px : 2 * mirrorX - px, py];
  }, [transformRef, mirrorX]);
  const pickAt = useCallback((point) => {
    const page = index && toPage(point);
    const scale = transformRef.current?.scale || 1;
    return page ? index.pick(page, { mode: selectMode, view: mirrorX == null ? "top" : "bottom", tolerance: PICK_SLOP_PX / scale }) : null;
  }, [index, toPage, transformRef, selectMode, mirrorX]);
  const snapAt = useCallback((point) => {
    const page = index?.snap && toPage(point);
    if (!page) return null;
    const scale = transformRef.current?.scale || 1;
    const snapped = index.snap(page, { tolerance: SNAP_PX / scale, kinds: MEASURE_KINDS[measureMode] ?? null });
    if (snapped) return { page: snapped.at, label: snapped.label, selector: snapped.selector || index.pointSelector(snapped.at) };
    return { page, label: "", selector: index.pointSelector(page) };
  }, [index, toPage, transformRef, measureMode]);

  const setCursor = (value) => { if (canvasRef?.current) canvasRef.current.style.cursor = value; };

  // ---- selection --------------------------------------------------------------
  const select = useCallback((selectors, { add = false, finding: findingIndex = null } = {}) => {
    const valid = (Array.isArray(selectors) ? selectors : [selectors]).map((selector) => parseBoardRefSelector(selector)?.canonical).filter(Boolean);
    setFocusedFinding(findingIndex);
    setSelection((current) => {
      if (!add) return valid.length ? [...new Set(valid)] : EMPTY;
      const next = new Set(current);
      for (const selector of valid) { if (next.has(selector)) next.delete(selector); else next.add(selector); }
      return [...next];
    });
    setTool(BOARD_TOOL.SELECT);
  }, []);
  const clear = useCallback(() => { setSelection(EMPTY); setFocusedFinding(null); }, []);

  // ---- the pointer ------------------------------------------------------------
  const picking = useMemo(() => ({
    onHover(point) {
      if (!index) return;
      if (tool === BOARD_TOOL.MEASURE) {
        draftRef.current = point ? snapAt(point) : null;
        setCursor("crosshair");
      } else {
        const hit = point ? pickAt(point) : null;
        if ((hit?.selector || "") === (hoverRef.current?.selector || "")) return;
        hoverRef.current = hit;
        setCursor(hit ? "pointer" : "");
      }
      requestPaint?.();
    },
    onTap(point, event) {
      if (!index) return;
      if (tool === BOARD_TOOL.MEASURE) {
        const picked = snapAt(point);
        if (!picked) return;
        if (!measureStart) { setMeasureStart(picked); return; }
        measurementSequence += 1;
        setMeasurements((current) => [...current, { id: `m${measurementSequence}`, a: measureStart, b: picked }]);
        setMeasureStart(null);
        return;
      }
      const hit = pickAt(point);
      const add = Boolean(event?.shiftKey || event?.metaKey || event?.ctrlKey);
      if (hit) select([hit.selector], { add });
      else if (!add) clear();
    },
    onDoubleTap(point) {
      // A double-click on something copies its reference, as on a STEP face; on bare board, it fits.
      if (!index || tool !== BOARD_TOOL.SELECT) return false;
      const hit = pickAt(point);
      if (!hit) return false;
      select([hit.selector]);
      copyRef.current?.([hit.selector]);
      return true;
    },
  }), [index, tool, pickAt, snapAt, select, clear, measureStart, requestPaint]);

  // ---- what goes to the agent ---------------------------------------------------
  /** The selection (or `selectors`) as one board-reference token naming the file as copied references do. */
  const copyText = useCallback((path, selectors = selection) => (selectors.length ? buildBoardRefToken({ path, selectors }) : ""), [selection]);

  // ---- measurements -----------------------------------------------------------
  const measured = useMemo(() => (index ? measurements.map((measurement) => {
    const [ax, ay] = index.toScript(measurement.a.page);
    const [bx, by] = index.toScript(measurement.b.page);
    return { ...measurement, distance: Math.hypot(bx - ax, by - ay), dx: bx - ax, dy: by - ay };
  }) : EMPTY), [index, measurements]);
  const removeMeasurement = useCallback((id) => setMeasurements((current) => current.filter((item) => item.id !== id)), []);
  const clearMeasure = useCallback(() => { setMeasurements(EMPTY); setMeasureStart(null); draftRef.current = null; }, []);

  /** Escape, innermost first: an unfinished measurement, then the selection. Answers whether it spent the key. */
  const escape = useCallback(() => {
    if (measureStart) { setMeasureStart(null); draftRef.current = null; requestPaint?.(); return true; }
    if (selection.length || focusedFinding != null) { clear(); return true; }
    return false;
  }, [measureStart, selection.length, focusedFinding, clear, requestPaint]);

  const chooseTool = useCallback((next) => {
    setTool((current) => {
      // Measure toggles: a press while it is up clears it and puts it down, back to Select.
      if (next === BOARD_TOOL.MEASURE && current === BOARD_TOOL.MEASURE) { clearMeasure(); return BOARD_TOOL.SELECT; }
      // Draw toggles too: a second press puts it down, and the sketch with it.
      if (next === BOARD_TOOL.DRAW && current === BOARD_TOOL.DRAW) return BOARD_TOOL.SELECT;
      // Leaving Measure cancels its unfinished pick; its completed measurements stay, with their panel.
      if (current === BOARD_TOOL.MEASURE && next !== BOARD_TOOL.MEASURE) { setMeasureStart(null); draftRef.current = null; }
      if (next !== BOARD_TOOL.SELECT && current === BOARD_TOOL.SELECT) { hoverRef.current = null; }
      if (current === BOARD_TOOL.SELECT && next !== BOARD_TOOL.SELECT) setSelection(EMPTY);
      return next;
    });
    setCursor("");
    requestPaint?.();
  }, [clearMeasure, requestPaint]);

  return {
    available: Boolean(index), document: index?.document ?? null, index, tool, chooseTool, selectMode, setSelectMode, measureMode, setMeasureMode,
    selection, resolved, finding, focusedFinding, select, clear, picking, paintOverlay, copyText, copyRef,
    measurements: measured, measureStart, removeMeasurement, clearMeasure, escape,
  };
}
