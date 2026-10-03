/**
 * The flat view lock: while Draw is up, the drawing editor owns pan and zoom and the plot follows
 * it. The editor maps its scene to the pane as `(scene + scroll) * zoom`; the plot maps page
 * millimetres as `x * scale + offsetX`, `-y * scale + offsetY`. Taken together at one moment
 * (`lock`: the plot's transform and the editor's viewport then), every later viewport moves the
 * plot by the same scroll and zoom, so a point under the ink stays under it.
 */

/** The plot's view for the editor's `viewport`, given the plot's view and the editor's when they were locked together. */
export function followDrawingViewport(lock, viewport) {
  const { transform, viewport: start } = lock;
  const zoom = viewport.zoom / start.zoom;
  return {
    scale: transform.scale * zoom,
    offsetX: (transform.offsetX / start.zoom - start.scrollX + viewport.scrollX) * viewport.zoom,
    offsetY: (transform.offsetY / start.zoom - start.scrollY + viewport.scrollY) * viewport.zoom,
  };
}

