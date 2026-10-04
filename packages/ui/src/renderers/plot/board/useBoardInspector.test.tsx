import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { BOARD_TOOL, useBoardInspector } from '../../../../dist/renderers/plot/board/useBoardInspector.js';

// The inspector of a 40 x 30 mm board drawn at 10 px/mm from the pane's corner: a press at
// (x, y) px lands on page (x / 10, y / 10) mm. What a person does to it — the tools, Escape, a
// double-click while measuring, a new revision — is decided here; the pixels are the browser suite's.
const square = (cx: number, cy: number, w: number, h: number) => [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
const FINDINGS = [
  { check: 'drc', severity: 'warning', type: 'silk_overlap', description: 'Silkscreen clearance', items: [{ text: 'R1', ref: '#R1', at: [15, 20] }] },
  { check: 'unconnected', severity: 'error', type: 'unconnected_items', description: 'Missing connection', items: [{ text: 'R1.2', ref: '#R1.2', at: [15.825, 20] }] },
];
const board = (findings = FINDINGS) => ({
  origin: [5, 25], nets: [{ name: 'VIN', class: '' }, { name: 'GND', class: '' }],
  parts: [{ ref: 'R1', value: '10k', footprint: 'R_0603', side: 'top', at: [15, 20], rotation: 0, fields: {}, outline: square(15, 20, 3, 1.4) }],
  pads: [
    { part: 'R1', number: '1', name: '', net: 'VIN', type: 'passive', side: 'top', at: [14.175, 20], polygon: square(14.175, 20, 0.8, 0.95) },
    { part: 'R1', number: '2', name: '', net: 'GND', type: 'passive', side: 'top', at: [15.825, 20], polygon: square(15.825, 20, 0.8, 0.95) },
  ],
  tracks: [], vias: [], zones: [], holes: [{ at: [3, 3], diameter: 2 }, { at: [37, 27], diameter: 2 }], outline: [], findings,
});
const plotOf = (index: object) => ({ layout: { sheets: [{ x: 0, y: 0, width: 40, height: 30 }] }, board: index });

function mount(initial = plotOf(board())) {
  const options = { transformRef: { current: { scale: 10, offsetX: 0, offsetY: 0 } }, requestPaint: () => {}, canvasRef: { current: null } };
  return renderHook(({ plot }) => useBoardInspector({ plot, ...options }), { initialProps: { plot: initial } });
}
const tap = (view: ReturnType<typeof mount>, x: number, y: number) => act(() => { view.result.current.picking.onTap({ x, y }, {}); });

afterEach(cleanup);

it('Escape cancels an unfinished measurement, then puts Measure down with its results kept, as on a STEP', () => {
  const view = mount();
  act(() => view.result.current.chooseTool(BOARD_TOOL.MEASURE));
  tap(view, 30, 30); tap(view, 370, 270);
  // Hole to hole: 34 mm across and 24 mm up the script's frame.
  expect(view.result.current.measurements).toHaveLength(1);
  expect(view.result.current.measurements[0]).toMatchObject({ dx: 34, dy: -24 });
  tap(view, 30, 30);
  expect(view.result.current.measureStart).not.toBeNull();
  act(() => { expect(view.result.current.escape()).toBe(true); });
  expect(view.result.current.measureStart).toBeNull();
  expect(view.result.current.tool).toBe(BOARD_TOOL.MEASURE);
  act(() => { expect(view.result.current.escape()).toBe(true); });
  expect(view.result.current.tool).toBe(BOARD_TOOL.SELECT);
  expect(view.result.current.measurements).toHaveLength(1);
});

it('a double-click while measuring measures nothing: its second press lands on the first', () => {
  const view = mount();
  act(() => view.result.current.chooseTool(BOARD_TOOL.MEASURE));
  tap(view, 30, 30); tap(view, 30, 30);
  expect(view.result.current.measurements).toEqual([]);
  expect(view.result.current.measureStart?.label).toBe('hole');
});

it('a selection made from another tool takes Select up cleanly, and keeps only what the board has', () => {
  const view = mount();
  act(() => view.result.current.chooseTool(BOARD_TOOL.MEASURE));
  tap(view, 30, 30);
  act(() => view.result.current.select(['#R1.2', '#U9', '#@x1y2']));
  expect(view.result.current.tool).toBe(BOARD_TOOL.SELECT);
  expect(view.result.current.measureStart).toBeNull();
  expect(view.result.current.selection).toEqual(['#R1.2', '#@x1y2']);
});

it('a check in focus stays on that check in a new revision, wherever it is listed, and goes with it', () => {
  const view = mount();
  act(() => view.result.current.select(['#R1.2'], { finding: 1 }));
  expect(view.result.current.finding.type).toBe('unconnected_items');
  // KiCad now lists a new check first: the one in focus is the same check, one place down.
  const added = { check: 'drc', severity: 'error', type: 'clearance', description: 'Clearance', items: [] };
  view.rerender({ plot: plotOf(board([added, ...FINDINGS])) });
  expect(view.result.current.focusedFinding).toBe(2);
  expect(view.result.current.finding.type).toBe('unconnected_items');
  // Fixed: no check in focus, and none of the others in its place.
  view.rerender({ plot: plotOf(board([added, FINDINGS[0]])) });
  expect(view.result.current.finding).toBeNull();
  // Leaving Select drops a check with the selection.
  act(() => view.result.current.select(['#R1'], { finding: 1 }));
  act(() => view.result.current.chooseTool(BOARD_TOOL.MEASURE));
  expect(view.result.current.finding).toBeNull();
  expect(view.result.current.selection).toEqual([]);
});
