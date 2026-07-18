import tempfile
import unittest
from pathlib import Path

import gui_upload_tasks


class GuiUploadTaskNamingTests(unittest.TestCase):
    def test_new_staged_layout_separates_task_identity_from_display_title(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            task_id = "task-20260719123456-abc123"
            staged_pdf = root / "uploads" / "gui" / task_id / "论文标题.pdf"
            runtime_output = root / "output"
            settings = {
                "mineru": {
                    "backend": "local",
                    "parseMethod": "auto",
                    "reuseExistingParse": True,
                },
                "translation": {"enabled": False},
                "publish": {"prepareOnly": True, "imageMode": "note"},
            }

            command, _, log_path = gui_upload_tasks.build_task_command(
                staged_pdf,
                settings,
                workbench_root=root,
                build_direct_network_env=lambda: {},
                sanitize_ascii_stem=lambda value: value,
                runtime_output_dir=runtime_output,
                python_executable="python",
            )

        def argument(flag):
            return command[command.index(flag) + 1]

        self.assertEqual(argument("--title"), "论文标题")
        self.assertEqual(
            Path(argument("--mineru-output-dir")),
            runtime_output / task_id / "paper",
        )
        self.assertEqual(Path(argument("--linearized-output")).name, "paper_linearized.md")
        self.assertEqual(
            Path(argument("--prepared-output")).name,
            "paper_feishu_docx_ready.md",
        )
        self.assertEqual(log_path.name, f"mineru_{task_id}.log")

    def test_legacy_staged_name_still_recovers_original_title(self):
        task_id, title = gui_upload_tasks.describe_staged_file(
            Path("task-20260719123456-abc123-Original Paper.pdf")
        )
        self.assertEqual(task_id, "task-20260719123456-abc123")
        self.assertEqual(title, "Original Paper")


if __name__ == "__main__":
    unittest.main()
