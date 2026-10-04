"""A served folder that reaches its models through a symlinked folder: the catalog lists them by the
link, and every route that takes a model the catalog lists takes them by that name.

The library's check measured where the link leads from the root, found it outside, and answered 400
for a model the catalog listed and the Viewer had open.
"""

from __future__ import annotations

import base64
import http.client
import json
import os
import shutil
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from cadgen.analytics import Recorder, file_code, file_salt
from cadgen.viewer import handler as handler_module
from cadgen.viewer import warm
from cadgen.viewer.http_app import create_cad_app
from cadgen.viewer.recents import RecentStore
from cadgen.viewer.scanner import scan_cad_directory

STL = b"solid t\nendsolid t\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
# A guard against a hang, never a measurement: the wait below is for a condition.
HANG = 60.0


class SymlinkedFolderTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.root = self.tmp / "root"
        self.root.mkdir()
        # The models' real folder is outside the root, as another project's STEP folder is.
        self.target = self.tmp / "elsewhere" / "hypercar" / "STEP"
        self.target.mkdir(parents=True)
        (self.target / "hypercar.stl").write_bytes(STL)
        (self.target.parent / "secret.stl").write_bytes(STL)
        try:
            (self.root / "hypercar").symlink_to(self.target, target_is_directory=True)
        except OSError as error:  # Windows without the symlink privilege
            self.skipTest(f"directory symlinks unavailable: {error}")
        self.listed = self.root / "hypercar" / "hypercar.stl"
        self.state = self.tmp / "state"
        environment = mock.patch.dict(os.environ, {"CADGEN_STATE_DIR": str(self.state), "CADGEN_CACHE_DIR": str(self.tmp / "store"),
                                                   "DO_NOT_TRACK": "", "CADGEN_ANALYTICS": ""})
        environment.start()
        self.addCleanup(environment.stop)
        self.sent: list[dict] = []
        self.app = create_cad_app(root=str(self.root), host="127.0.0.1", port=0)
        self.app.analytics = Recorder(path=self.state / "settings.json", send=lambda payload: self.sent.append(payload) or True)
        self.app.analytics.started(client={"name": "cadgen-viewer", "version": "0"}, presentation="browser")
        server = handler_module.serve(self.app, "127.0.0.1", 0)
        self.port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 5)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)

    def request(self, path: str, body: dict) -> tuple[int, dict | None]:
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            connection.request("POST", path, body=json.dumps(body),
                               headers={"x-cadgen-viewer": "1", "content-type": "application/json"})
            response = connection.getresponse()
            data = response.read()
            return response.status, json.loads(data) if data else None
        finally:
            connection.close()

    def change(self, action: str, file: str, **extra) -> tuple[int, dict | None]:
        return self.request("/__cad/recents", {"action": action, "file": file, **extra})

    def test_it_joins_the_library_by_the_name_the_catalog_gives_it(self) -> None:
        # The walk follows the link and names the model by it, never by where it leads.
        catalog = scan_cad_directory(str(self.root), defer_unpreferred=True)
        self.assertEqual([entry["file"] for entry in catalog["entries"]], ["hypercar/hypercar.stl"])
        self.assertEqual(self.change("open", "hypercar/hypercar.stl"), (200, {"ok": True}))
        self.assertEqual(self.change("thumbnail", str(self.listed), png=base64.b64encode(PNG).decode("ascii")),
                         (200, {"ok": True}))
        # Kept where the Viewer shows it, which is where the library reopens it.
        [entry] = RecentStore().list()
        self.assertEqual((entry.path, entry.public()["missing"]), (str(self.listed), False))
        self.assertEqual(RecentStore().read_thumbnail(entry.thumbnail), PNG)

    def test_nothing_past_the_root_is_named_through_it(self) -> None:
        # Where the link leads is not this Viewer's to name, nor what a ".." climbs out to.
        for ref in (str(self.target / "hypercar.stl"), "hypercar/../../elsewhere/hypercar/STEP/hypercar.stl"):
            self.assertEqual(self.change("open", ref)[0], 403)
        # A ".." is undone before any link is followed: this names root/secret.stl, which is not
        # there, and never the file beside the link's target that the filesystem would find.
        self.assertEqual(self.change("open", "hypercar/../secret.stl")[0], 400)
        self.assertEqual(RecentStore().list(), [])

    def test_its_opening_is_counted(self) -> None:
        self.request("/__cad/analytics", {"share": True})
        self.assertEqual(self.request("/__cad/analytics/activity", {"file": "hypercar/hypercar.stl"})[0], 204)
        self.assertTrue(self.app.analytics.flush())
        [payload] = self.sent
        code = file_code(file_salt(self.state / "settings.json"), str(self.listed))
        self.assertIn({"name": "file", "file": code, "kind": "stl"}, payload["events"])

    def test_a_build_of_it_warms_its_row_by_that_name(self) -> None:
        (self.target / "hypercar.step").write_bytes(b"ISO-10303-21;\n")
        # The daemon's ledger names what a build saved by its real path.
        saved = os.path.realpath(self.target / "hypercar.step")
        job = {"id": "epoch:job-1", "epoch": "epoch", "sequence": 1, "tool": "run", "storeRoot": str(self.tmp / "store"),
               "outputs": [saved], "state": "building", "phase": "STEP saved",
               "savedResults": {saved: {"tree": "", "output": saved}}}
        warmed = []
        with mock.patch("cadgen.daemon.client.watch_jobs", return_value={"jobsCursor": "epoch:2", "jobs": [job]}), \
                mock.patch.object(warm, "warm_catalog_entry", lambda root, path: warmed.append(path)):
            self.assertEqual(self.app.build_status("hypercar/hypercar.step", after="epoch:1")["phase"], "STEP saved")
            self.assertTrue(self.app.catalog_warm.wait_settled(HANG))
        self.assertEqual(warmed, [str(self.root / "hypercar" / "hypercar.step")])


if __name__ == "__main__":
    unittest.main()
