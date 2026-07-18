import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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
            (root / "cli.py").write_text("print('ok')", encoding="utf-8")
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

    def test_onnxruntime_missing_is_warning_for_demo_profile(self):
        output = io.StringIO()
        with patch("builtins.__import__", side_effect=missing_import("onnxruntime")):
            with contextlib.redirect_stdout(output):
                preflight.check_onnxruntime(strict=False)

        self.assertEqual(preflight._fatal, 0)
        self.assertEqual(preflight._warns, 1)
        self.assertIn("demo/云解析不受影响", output.getvalue())

    def test_onnxruntime_missing_is_fatal_for_local_profile(self):
        output = io.StringIO()
        with patch("builtins.__import__", side_effect=missing_import("onnxruntime")):
            with contextlib.redirect_stdout(output):
                preflight.check_onnxruntime(strict=True)

        self.assertEqual(preflight._fatal, 1)
        self.assertEqual(preflight._warns, 0)
        self.assertIn("import onnxruntime 失败", output.getvalue())


def missing_import(target_name: str):
    real_import = __import__

    def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name == target_name:
            raise ImportError(f"No module named '{target_name}'")
        return real_import(name, globals, locals, fromlist, level)

    return fake_import


if __name__ == "__main__":
    unittest.main()
