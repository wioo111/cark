import tempfile
import unittest
from pathlib import Path

import smoke_demo


class SmokeDemoTests(unittest.TestCase):
    def test_run_smoke_creates_verified_demo_runtime(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            runtime_root = Path(temp_dir) / "demo"

            summary = smoke_demo.run_smoke(
                runtime_root,
                reset=True,
                force_reset=True,
            )

            self.assertEqual(summary["activationStatus"], "active")
            self.assertTrue(Path(summary["exportPath"]).exists())
            self.assertTrue((runtime_root / "smoke-summary.json").exists())
            self.assertEqual(summary["paperId"], smoke_demo.DEMO_PAPER_ID)
            self.assertIn(str(runtime_root), str(summary["guiCommand"]))


if __name__ == "__main__":
    unittest.main()
