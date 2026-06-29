import unittest
from pathlib import Path
from unittest.mock import patch

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cli


class CliDemoTests(unittest.TestCase):
    def test_doctor_defaults_to_demo_profile(self):
        args = cli.build_parser().parse_args(["doctor"])

        with patch("cli.run_python_script", return_value=0) as run_script:
            result = cli.handle_doctor(args)

        self.assertEqual(result, 0)
        run_script.assert_called_once_with("preflight.py", ["--profile", "demo"])

    def test_doctor_can_run_strict_local_profile(self):
        args = cli.build_parser().parse_args(["doctor", "--profile", "local"])

        with patch("cli.run_python_script", return_value=1) as run_script:
            result = cli.handle_doctor(args)

        self.assertEqual(result, 1)
        run_script.assert_called_once_with("preflight.py", ["--profile", "local"])

    def test_demo_generates_smoke_runtime_without_gui(self):
        args = cli.build_parser().parse_args(["demo", "--runtime-root", "runtime/demo-smoke"])

        with patch("cli.run_python_script", return_value=0) as run_script:
            result = cli.handle_demo(args)

        self.assertEqual(result, 0)
        run_script.assert_called_once_with(
            "smoke_demo.py",
            ["--runtime-root", "runtime\\demo-smoke" if sys.platform == "win32" else "runtime/demo-smoke"],
        )

    def test_demo_gui_launches_generated_runtime(self):
        args = cli.build_parser().parse_args(
            [
                "demo",
                "--runtime-root",
                "runtime/demo-smoke",
                "--gui",
                "--host",
                "127.0.0.1",
                "--port",
                "18765",
                "--no-browser",
            ]
        )

        with patch("cli.run_python_script", side_effect=[0, 0]) as run_script:
            result = cli.handle_demo(args)

        self.assertEqual(result, 0)
        self.assertEqual(run_script.call_args_list[0].args[0], "smoke_demo.py")
        self.assertEqual(run_script.call_args_list[1].args[0], "gui_server.py")
        self.assertEqual(
            run_script.call_args_list[1].args[1],
            [
                "--host",
                "127.0.0.1",
                "--port",
                "18765",
                "--runtime-root",
                "runtime\\demo-smoke" if sys.platform == "win32" else "runtime/demo-smoke",
                "--no-browser",
            ],
        )

    def test_demo_does_not_launch_gui_when_smoke_fails(self):
        args = cli.build_parser().parse_args(["demo", "--gui"])

        with patch("cli.run_python_script", return_value=1) as run_script:
            result = cli.handle_demo(args)

        self.assertEqual(result, 1)
        self.assertEqual(run_script.call_count, 1)


if __name__ == "__main__":
    unittest.main()
