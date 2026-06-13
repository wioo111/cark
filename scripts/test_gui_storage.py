import tempfile
import unittest
from pathlib import Path

from gui_storage import WorkbenchStore, format_task_command


class WorkbenchStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store = WorkbenchStore(Path(self.temp_dir.name) / "cark.sqlite3")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_tasks_survive_reopen_and_active_tasks_become_interrupted(self):
        task = {
            "id": "task-1",
            "fileName": "paper.pdf",
            "status": "running",
            "stage": "PDF解析",
            "progress": 38,
            "createdAt": "2026-06-13T10:00:00",
            "updatedAt": "2026-06-13T10:01:00",
            "error": None,
            "logs": ["started"],
            "result": None,
        }
        self.store.create_task(task, "D:/runtime/uploads/paper.pdf")

        reopened = WorkbenchStore(self.store.database_path)
        self.assertEqual(reopened.get_task("task-1")["status"], "running")
        self.assertEqual(reopened.mark_active_tasks_interrupted("2026-06-13T10:02:00"), 1)

        interrupted = reopened.get_task("task-1")
        self.assertEqual(interrupted["status"], "interrupted")
        self.assertIn("重试", interrupted["error"])

        reopened.reset_task_for_retry("task-1", "2026-06-13T10:03:00")
        retried = reopened.get_task("task-1")
        self.assertEqual(retried["status"], "queued")
        self.assertEqual(retried["progress"], 0)
        self.assertIsNone(retried["error"])

    def test_paper_index_and_reading_state_survive_reopen(self):
        paper = {
            "id": "paper-1",
            "title": "A Paper",
            "taskId": "task-1",
            "rootDir": "D:/runtime/output/task-1/paper",
            "autoDir": "D:/runtime/output/task-1/paper/auto",
            "updatedAt": 123.5,
            "availableViews": ["linearized", "bilingual"],
            "sourcePdf": "D:/runtime/uploads/paper.pdf",
            "files": {"linearized": "D:/runtime/output/paper.md"},
        }
        self.store.upsert_papers([paper], "2026-06-13T10:00:00")
        self.store.save_reading_state(
            "paper-1",
            {
                "view": "bilingual",
                "scrollY": 840.5,
                "activeSectionId": "section-3",
                "draft": {"quote": "important", "content": "unfinished"},
            },
            "2026-06-13T10:04:00",
        )

        reopened = WorkbenchStore(self.store.database_path)
        self.assertEqual(reopened.list_papers()[0]["title"], "A Paper")
        state = reopened.get_reading_state("paper-1")
        self.assertEqual(state["view"], "bilingual")
        self.assertEqual(state["scrollY"], 840.5)
        self.assertEqual(state["draft"]["content"], "unfinished")

    def test_task_command_masks_secrets(self):
        formatted = format_task_command(
            [
                "python",
                "pipeline.py",
                "--api-token",
                "mineru-secret",
                "--app-secret",
                "publish-secret",
                "--folder-token",
                "folder-secret",
                "--app-id",
                "public-app-id",
            ]
        )
        self.assertNotIn("mineru-secret", formatted)
        self.assertNotIn("publish-secret", formatted)
        self.assertNotIn("folder-secret", formatted)
        self.assertIn("--api-token ***", formatted)
        self.assertIn("--app-secret ***", formatted)
        self.assertIn("public-app-id", formatted)

    def test_task_logs_are_redacted_before_persistence(self):
        task = {
            "id": "task-secret",
            "fileName": "paper.pdf",
            "status": "queued",
            "stage": "等待执行",
            "progress": 0,
            "createdAt": "2026-06-13T10:00:00",
            "updatedAt": "2026-06-13T10:00:00",
            "error": None,
            "logs": ["run --api-token secret-token --app-secret secret-app --folder-token folder-secret"],
            "result": None,
        }
        self.store.create_task(task, "D:/paper.pdf")
        saved = self.store.get_task("task-secret")
        self.assertEqual(saved["logs"], ["run --api-token *** --app-secret *** --folder-token ***"])


if __name__ == "__main__":
    unittest.main()
