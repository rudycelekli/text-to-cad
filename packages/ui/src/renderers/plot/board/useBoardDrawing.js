/**
 * Draw on a board: the shared drawing editor (`kit/tools/draw/DrawingOverlay.jsx`) laid over the
 * plot, the person's sketch handed to the agent as the view with its ink.
 *
 * While Draw is up the editor owns pan and zoom (its own wheel, pinch and Pan view tool), and the
 * plot follows it, so ink and board stay one picture: the flat counterpart of the 3D views' lock
 * (`drawingViewLock.js`). The editor maps its scene to the pane as `(scene + scroll) * zoom`; once
 * there is something to keep aligned (the first stroke or the first pan), the plot's transform and
 * the editor's viewport are taken together, and every later viewport moves the plot by the same
 * scroll and zoom. When the pane changes size the editor keeps its scroll and zoom against the
 * pane's corner while the plot would refit or keep its centre, so the plot is put back under the
 * ink from the same lock, in the same frame.
 */
import { useCallback, useEffect, useRef } from "react";
import { useDrawingSession } from "../../../drawing/session.js";
import { CAD_DRAWING_DEFAULTS } from "../../kit/tools/draw/DrawingOverlay.jsx";
import { followDrawingViewport } from "./boardViewLock.js";

/**
 * @param {{ active: boolean, transformRef: { current: object|null }, setView(transform: object): void,
 *   paintNow?: () => void, settle?: () => void, canvasRef: { current: HTMLCanvasElement|null } }} options
 *   `settle`: paint the plot final now (not a patch scaled while the view rests), before a capture.
 */
export function useBoardDrawing({ active, transformRef, setView, paintNow, settle, canvasRef }) {
  const drawing = useDrawingSession(active, CAD_DRAWING_DEFAULTS);
  const controllerRef = useRef(null);
  const lockRef = useRef(null);
  const viewportRef = useRef({ scrollX: 0, scrollY: 0, zoom: 1 });
  const inkRef = useRef(false);
  useEffect(() => {
    if (active) return;
    lockRef.current = null;
    viewportRef.current = { scrollX: 0, scrollY: 0, zoom: 1 };
    inkRef.current = false;
  }, [active]);

  const lock = useCallback(() => {
    if (lockRef.current || !transformRef.current) return;
    lockRef.current = { transform: { ...transformRef.current }, viewport: { ...viewportRef.current } };
  }, [transformRef]);
  // The pane changed size under the sketch: the plot's view again from the lock and the editor's
  // viewport, painted before the frame shows the plot refitted. The plane view sizes its canvas in
  // its own observer, so this one, on the canvas, hears of it after that.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || !canvas || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      if (!lockRef.current) return;
      setView(followDrawingViewport(lockRef.current, viewportRef.current));
      paintNow?.();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [active, canvasRef, setView, paintNow]);

  const onViewportChange = useCallback((viewport) => {
    if (!viewport) return;
    lock();
    viewportRef.current = viewport;
    if (lockRef.current) setView(followDrawingViewport(lockRef.current, viewport));
  }, [lock, setView]);
  const onContentChange = useCallback((hasContent) => {
    if (hasContent && !inkRef.current) lock();
    inkRef.current = hasContent;
    drawing.onContentChange(hasContent);
  }, [drawing, lock]);
  const onReady = useCallback((controller) => {
    controllerRef.current = controller;
    drawing.onReady(controller);
  }, [drawing]);

  /** The view as it is on screen, the board with its overlay and the ink over it, as a PNG. */
  const capture = useCallback(() => new Promise((resolve, reject) => {
    const plot = canvasRef.current;
    if (!plot) { reject(new Error("The board is not on screen yet.")); return; }
    // A sketch made right after a zoom is copied as sharp as the board will be once it rests.
    settle?.();
    const canvas = document.createElement("canvas");
    canvas.width = plot.width;
    canvas.height = plot.height;
    const context = canvas.getContext("2d");
    if (!context) { reject(new Error("The browser cannot draw the board’s picture.")); return; }
    context.drawImage(plot, 0, 0);
    const ink = controllerRef.current?.inkCanvas?.();
    if (ink) context.drawImage(ink, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The browser could not encode the board as a PNG."))), "image/png");
  }), [canvasRef, settle]);

  return { drawing, overlay: { drawing, onReady, onContentChange, onViewportChange }, capture };
}
