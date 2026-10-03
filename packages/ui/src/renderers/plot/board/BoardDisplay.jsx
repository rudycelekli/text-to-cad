import { RotateCcw } from "lucide-react";
import { Button } from "@text-to-cad/ui/primitives/button";
import { TooltipHint } from "@text-to-cad/ui/primitives/tooltip";
import { FileSheetCheckboxRow, FileSheetSelectRow, FileSheetSettingsSection } from "../../kit/inspector/FileSheet.js";

/**
 * A board's Display settings: which side it is seen from (the bottom mirrored, its layers on top),
 * which layers are drawn, and whether copper pours are filled — a pour hides the tracks under it,
 * and a person reading the routing turns it off. KiCad still draws every layer; this only chooses
 * among the layers it drew. Kept with the file's view, as a 3D file's Display settings are.
 */
export const BOARD_DISPLAY_DEFAULTS = Object.freeze({ side: "top", layers: "all", poured: true });
const SIDES = [{ value: "top", label: "Top" }, { value: "bottom", label: "Bottom" }];
const LAYER_PRESETS = [
  { value: "all", label: "All layers" }, { value: "copper", label: "Copper" }, { value: "assembly", label: "Silkscreen and fab" },
];
// What each preset draws, by layer kind; the outline and the ratsnest always.
const PRESET_KINDS = Object.freeze({ copper: ["copper", "outline", "ratsnest"], assembly: ["silk", "fab", "outline", "ratsnest"] });

/** A stored display, or the defaults where it says nothing usable. */
export function readBoardDisplay(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  return {
    side: value.side === "bottom" ? "bottom" : "top",
    layers: LAYER_PRESETS.some((preset) => preset.value === value.layers) ? value.layers : "all",
    poured: value.poured !== false,
  };
}

/** The drawing's view for a display: the layer ids to draw (null = all), pours, side. */
export function boardDrawView(display, sheet) {
  const kinds = PRESET_KINDS[display.layers];
  const layers = kinds && Array.isArray(sheet?.layers) ? sheet.layers.filter((layer) => kinds.includes(layer.kind)).map((layer) => layer.id) : null;
  return { layers, poured: display.poured, side: display.side };
}

export function BoardDisplaySection({ display, onChange }) {
  const custom = display.side !== BOARD_DISPLAY_DEFAULTS.side || display.layers !== BOARD_DISPLAY_DEFAULTS.layers || display.poured !== BOARD_DISPLAY_DEFAULTS.poured;
  return <FileSheetSettingsSection title="Board" sectionId="board"
    headingAction={custom ? <TooltipHint content="Reset board display"><Button type="button" variant="ghost" size="icon-xs" aria-label="Reset board display"
      className="size-6 text-muted-foreground hover:text-foreground" onClick={() => onChange({ ...BOARD_DISPLAY_DEFAULTS })}>
      <RotateCcw className="size-3" aria-hidden="true" /></Button></TooltipHint> : null}>
    <FileSheetSelectRow label="View from" value={display.side} options={SIDES} onValueChange={(side) => onChange({ ...display, side })} />
    <FileSheetSelectRow label="Layers" value={display.layers} options={LAYER_PRESETS} onValueChange={(layers) => onChange({ ...display, layers })} />
    <FileSheetCheckboxRow label="Copper pours" checked={display.poured} onCheckedChange={(poured) => onChange({ ...display, poured })} />
  </FileSheetSettingsSection>;
}
