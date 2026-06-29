import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import preflight


class PreflightDeliverySurfaceTests(unittest.TestCase):
    def setUp(self):
        preflight._fatal = 0
        preflight._warns = 0

    def test_delivery_surface_passes_when_artifacts_exist(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "docs").mkdir()
            (root / "docs" / "windows-usage.md").write_text("docs", encoding="utf-8")
            (root / "scripts").mkdir()
            (root / "scripts" / "smoke_demo.py").write_text("print('ok')", encoding="utf-8")
            (root / "scripts" / "smoke_demo.ps1").write_text("Write-Host ok", encoding="utf-8")
            (root / "gui" / "dist").mkdir(parents=True)
            (root / "gui" / "dist" / "index.html").write_text("<html></html>", encoding="utf-8")

            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                preflight.check_cark_delivery_surface(root)

        self.assertEqual(preflight._fatal, 0)
        self.assertEqual(preflight._warns, 0)
        self.assertIn("Windows 使用文档已就位", output.getvalue())
        self.assertIn("runtime 目录可写", output.getvalue())

    def test_delivery_surface_warns_when_artifacts_are_missing(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                preflight.check_cark_delivery_surface(Path(temp_dir))

        self.assertEqual(preflight._fatal, 0)
        self.assertGreaterEqual(preflight._warns, 3)
        self.assertIn("缺少 Windows 使用文档", output.getvalue())
        self.assertIn("GUI 构建产物不存在", output.getvalue())


if __name__ == "__main__":
    unittest.main()
