import tempfile
import unittest
from pathlib import Path

import gui_server
import gui_server_runtime


class GuiServerRuntimeTests(unittest.TestCase):
    def test_parser_accepts_runtime_root(self):
        args = gui_server_runtime.build_parser().parse_args(
            ["--runtime-root", "runtime/demo-smoke", "--no-browser"]
        )

        self.assertEqual(args.runtime_root, "runtime/demo-smoke")
        self.assertTrue(args.no_browser)

    def test_runtime_root_prefers_cli_argument(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            runtime_root = Path(temp_dir) / "demo-runtime"

            resolved = gui_server.resolve_runtime_root(
                ["--runtime-root", str(runtime_root)],
                environ={},
            )

            self.assertEqual(resolved, runtime_root.resolve())

    def test_runtime_root_prefers_environment(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            env_root = Path(temp_dir) / "env-runtime"
            cli_root = Path(temp_dir) / "cli-runtime"

            resolved = gui_server.resolve_runtime_root(
                ["--runtime-root", str(cli_root)],
                environ={"CARK_RUNTIME_ROOT": str(env_root)},
            )

            self.assertEqual(resolved, env_root.resolve())


if __name__ == "__main__":
    unittest.main()
