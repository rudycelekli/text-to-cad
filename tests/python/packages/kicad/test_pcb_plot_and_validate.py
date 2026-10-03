"""What the viewer and ``cadgen pcb validate`` read from a board, through a real KiCad 10.

The plot payload is KiCad's own SVG of each layer of the board (with a ratsnest
when it is a draft), the board's index on that sheet, and each schematic sheet;
``pcb.validate`` is KiCad's ERC and DRC of any project, and checking never
writes into it. ``pcb.read_board`` reads a board KiCad filled. Needs KiCad 10.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

from tests.python.packages.kicad.test_pcb_models import BOARD, board_source
from tests.python.support.paths import add_repo_path
from tests.python.support.tmp_root import generated_cad_directory

CADGEN_SRC = add_repo_path("packages/cadgen/src")


class PcbPlotAndValidateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._tmp = generated_cad_directory(prefix="pcb-plot-")
        cls.folder = Path(cls._tmp.name)
        env = dict(os.environ, CADGEN_DAEMON="0", PYTHONPATH=str(CADGEN_SRC))
        for name, routed in (("finished", True), ("draft", False)):
            (cls.folder / name).mkdir()
            (cls.folder / name / "blinky.py").write_text(board_source(route_led=routed), encoding="utf-8")
            built = subprocess.run([sys.executable, "blinky.py"], cwd=cls.folder / name, env=env, capture_output=True, text=True, timeout=600)
            if built.returncode != 0:
                raise AssertionError(built.stderr)

    @classmethod
    def tearDownClass(cls) -> None:
        cls._tmp.cleanup()

    @classmethod
    def payloads(cls) -> tuple[dict, dict]:
        if not hasattr(cls, "_payloads"):
            from cadgen.kicad.plot import build_plot

            cls._payloads = tuple(build_plot(cls.folder / name / "blinky.kicad_pcb") for name in ("finished", "draft"))
        return cls._payloads

    def test_a_board_plots_as_one_sheet_of_layers_and_a_draft_carries_its_ratsnest(self) -> None:
        from cadgen.kicad.plot import BOARD_BACKGROUND, PLOT_SCHEMA_VERSION

        finished, draft = self.payloads()
        self.assertEqual((finished["schemaVersion"], PLOT_SCHEMA_VERSION), (2, 2))
        self.assertEqual((finished["kind"], finished["unrouted"], len(finished["sheets"])), ("board", 0, 1))
        self.assertEqual(draft["unrouted"], 1)
        sheet = finished["sheets"][0]
        self.assertEqual(sheet["background"], BOARD_BACKGROUND)
        self.assertAlmostEqual(sheet["width"], 40.0, delta=0.05)
        stack = ["B.Fab", "B.SilkS", "B.Cu", "F.Cu", "F.SilkS", "F.Fab", "Edge.Cuts"]
        self.assertEqual([layer["id"] for layer in sheet["layers"]], stack + ["drills"])
        self.assertEqual([layer["id"] for layer in draft["sheets"][0]["layers"]], stack + ["ratsnest", "drills"])
        kinds = {layer["id"]: (layer["kind"], layer["side"]) for layer in draft["sheets"][0]["layers"]}
        self.assertEqual(
            [kinds[name] for name in ("B.Fab", "B.SilkS", "B.Cu", "F.Cu", "Edge.Cuts", "ratsnest", "drills")],
            [("fab", "back"), ("silk", "back"), ("copper", "back"), ("copper", "front"), ("outline", "both"), ("ratsnest", "both"), ("drill", "both")],
        )
        for layer in sheet["layers"]:
            self.assertIn("<svg", layer["svg"][:600])
            self.assertNotIn("<title>", layer["svg"])  # KiCad's timestamped title is gone
        # The pour is on B.Cu: its layer comes again without it; F.Cu has nothing to strip.
        copper = {layer["id"]: layer for layer in sheet["layers"] if layer["kind"] == "copper"}
        self.assertLess(len(copper["B.Cu"]["unpoured"]), len(copper["B.Cu"]["svg"]))
        self.assertNotIn("unpoured", copper["F.Cu"])
        # The ratsnest is drawn in the grey KiCad gives the scratch layer, on a layer of its own.
        ratsnest = next(layer for layer in draft["sheets"][0]["layers"] if layer["id"] == "ratsnest")
        self.assertIn("#C2C2C2", ratsnest["svg"])

    def test_the_index_lands_on_the_sheet_kicad_plotted(self) -> None:
        from cadgen.kicad import sexpr

        finished, draft = self.payloads()
        board = finished["board"]
        # The page is fitted to the outline: its corner is the outline's, and the script's origin
        # (the board's centre, which the outline is drawn around) is half the board in from it.
        tree = sexpr.parse((self.folder / "finished" / "blinky.kicad_pcb").read_text(encoding="utf-8"))
        edges = [node for node in tree[1:] if sexpr.head(node) in ("gr_line", "gr_arc") and sexpr.value(node, "layer") == "Edge.Cuts"]
        corner = (min(sexpr.find(node, key)[1] for node in edges for key in ("start", "end")),
                  min(sexpr.find(node, key)[2] for node in edges for key in ("start", "end")))
        origin = sexpr.find(sexpr.find(tree, "setup"), "aux_axis_origin")[1:]
        self.assertAlmostEqual(board["origin"][0], origin[0] - corner[0], places=3)
        self.assertAlmostEqual(board["origin"][1], origin[1] - corner[1], places=3)
        self.assertEqual([round(value, 3) for value in board["origin"]], [20.0, 15.0])
        counts = {key: len(board[key]) for key in ("parts", "pads", "tracks", "vias", "zones", "holes", "outline")}
        self.assertEqual(counts, {"parts": 3, "pads": 6, "tracks": 7, "vias": 1, "zones": 1, "holes": 0, "outline": 1})
        self.assertEqual(len(draft["board"]["tracks"]), 3)
        for pad in board["pads"]:
            self.assertTrue(_inside(pad["at"], pad["polygon"]), pad)
        j1 = next(part for part in board["parts"] if part["ref"] == "J1")
        line = next(number for number, text in enumerate(BOARD.splitlines(), start=1) if "j1 = board.part(" in text)
        self.assertEqual((j1["script"], j1["fields"]["Script"]), (f"blinky.py:{line}", f"blinky.py:{line}"))
        self.assertEqual({net["name"]: net["class"] for net in board["nets"]}["VBUS"], "Default")

    def test_findings_carry_references_to_what_they_name(self) -> None:
        _finished, draft = self.payloads()
        [unrouted] = [finding for finding in draft["board"]["findings"] if finding["check"] == "unconnected"]
        self.assertEqual(unrouted["severity"], "error")
        self.assertEqual([item["ref"] for item in unrouted["items"]], ["#R1.2", "#D1.2"])
        pads = {(pad["part"], pad["number"]): pad["at"] for pad in draft["board"]["pads"]}
        self.assertEqual([item["at"] for item in unrouted["items"]], [pads["R1", "2"], pads["D1", "2"]])

    def test_read_board_sees_the_copper_kicad_poured(self) -> None:
        from cadgen import pcb

        board = pcb.read_board(self.folder / "finished" / "blinky.kicad_pcb")
        line = next(number for number, text in enumerate(BOARD.splitlines(), start=1) if "r1 = board.part(" in text)
        self.assertEqual(board.resolve("blinky.kicad_pcb#R1").script, f"blinky.py:{line}")
        pour = board.resolve("#net:GND@x-10y-10")
        self.assertEqual([(item.kind, item.layer) for item in pour.items], [("zone", "B.Cu")])
        self.assertIn(pour.items[0], board.at(-10, -10).copper)

    def test_a_schematic_plots_one_sheet_per_page(self) -> None:
        from cadgen.kicad.plot import SCHEMATIC_BACKGROUND, build_plot

        payload = build_plot(self.folder / "finished" / "blinky.kicad_sch")
        self.assertEqual((payload["kind"], len(payload["sheets"])), ("schematic", 1))
        self.assertEqual(payload["sheets"][0]["background"], SCHEMATIC_BACKGROUND)

    def test_the_payload_is_cached_by_the_documents_bytes(self) -> None:
        from cadgen.kicad.plot import plot_payload_bytes

        board = self.folder / "finished" / "blinky.kicad_pcb"
        first = plot_payload_bytes(board)
        self.assertEqual(plot_payload_bytes(board), first)
        self.assertEqual(json.loads(first)["schemaVersion"], 2)

    def test_validate_reads_kicads_verdict_and_writes_nothing(self) -> None:
        from cadgen import pcb

        project = self.folder / "draft"
        before = sorted(path.name for path in project.iterdir())
        finished = pcb.validate(self.folder / "finished" / "blinky.kicad_pcb")
        draft = pcb.validate(project / "blinky.kicad_pcb")
        self.assertTrue(finished.ok, finished.issues)
        self.assertFalse(draft.ok)
        self.assertIn("unconnected.unconnected_items", [issue.code for issue in draft.issues])
        self.assertEqual(sorted(path.name for path in project.iterdir()), before)


def _inside(point, polygon) -> bool:
    x, y = point
    inside = False
    for (x1, y1), (x2, y2) in zip(polygon, [*polygon[1:], polygon[0]]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside


if __name__ == "__main__":
    unittest.main()
