import tempfile
import unittest
from pathlib import Path

from gui_storage import SingleInstanceLock, WorkbenchStore, format_task_command


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
        self.store.create_task(task, "D:/runtime/uploads/paper.pdf", "owner-1")

        reopened = WorkbenchStore(self.store.database_path)
        self.assertEqual(reopened.get_task("task-1")["status"], "running")
        self.assertEqual(
            reopened.mark_orphaned_active_tasks_interrupted(
                "owner-2",
                "2026-06-13T10:02:00",
            ),
            1,
        )

        interrupted = reopened.get_task("task-1")
        self.assertEqual(interrupted["status"], "interrupted")
        self.assertIn("重试", interrupted["error"])

        reopened.reset_task_for_retry("task-1", "owner-2", "2026-06-13T10:03:00")
        retried = reopened.get_task("task-1")
        self.assertEqual(retried["status"], "queued")
        self.assertEqual(retried["progress"], 0)
        self.assertIsNone(retried["error"])
        runtime = reopened.get_task_runtime("task-1")
        self.assertEqual(runtime["ownerId"], "owner-2")
        self.assertIsNone(runtime["workerPid"])

    def test_current_owner_tasks_are_not_interrupted(self):
        task = {
            "id": "task-owner",
            "fileName": "paper.pdf",
            "status": "running",
            "stage": "PDF解析",
            "progress": 38,
            "createdAt": "2026-06-13T10:00:00",
            "updatedAt": "2026-06-13T10:01:00",
            "error": None,
            "logs": [],
            "result": None,
        }
        self.store.create_task(task, "D:/paper.pdf", "owner-current")
        self.store.update_task(
            "task-owner",
            "2026-06-13T10:01:30",
            workerPid=4321,
        )
        self.assertEqual(
            self.store.get_task_runtime("task-owner"),
            {"ownerId": "owner-current", "workerPid": 4321},
        )
        changed = self.store.mark_orphaned_active_tasks_interrupted(
            "owner-current",
            "2026-06-13T10:02:00",
        )
        self.assertEqual(changed, 0)
        self.assertEqual(self.store.get_task("task-owner")["status"], "running")

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

    def test_paper_sync_removes_missing_records(self):
        first = {
            "id": "paper-1",
            "title": "First",
            "taskId": None,
            "rootDir": "D:/papers/first",
            "autoDir": "D:/papers/first/auto",
            "updatedAt": 1,
            "availableViews": ["linearized"],
            "sourcePdf": None,
            "files": {"linearized": "D:/papers/first.md"},
        }
        second = {
            **first,
            "id": "paper-2",
            "title": "Second",
            "rootDir": "D:/papers/second",
            "autoDir": "D:/papers/second/auto",
        }
        self.store.sync_papers([first, second], "2026-06-13T10:00:00")
        self.store.save_reading_state(
            "paper-1",
            {
                "view": "linearized",
                "scrollY": 320,
                "activeSectionId": "section-1",
                "draft": {"content": "keep this draft"},
            },
            "2026-06-13T10:00:30",
        )
        self.store.sync_papers([second], "2026-06-13T10:01:00")
        self.assertEqual(
            [paper["id"] for paper in self.store.list_papers()],
            ["paper-2"],
        )
        self.assertEqual(
            self.store.get_reading_state("paper-1")["draft"]["content"],
            "keep this draft",
        )

    def test_zotero_import_mapping_survives_reopen(self):
        self.store.record_zotero_import(
            "PDFD1234",
            "ABCD1234",
            "task-zotero",
            "2026-06-14T16:30:00",
        )

        reopened = WorkbenchStore(self.store.database_path)
        imported = reopened.get_zotero_import("PDFD1234")
        self.assertEqual(imported["itemKey"], "ABCD1234")
        self.assertEqual(imported["taskId"], "task-zotero")
        self.assertEqual(reopened.list_zotero_imports(), [imported])

    def test_stale_reading_state_cannot_overwrite_newer_state(self):
        self.store.save_reading_state(
            "paper-1",
            {
                "view": "bilingual",
                "scrollY": 900,
                "activeSectionId": "section-new",
                "draft": {"content": "new draft"},
                "clientRevision": 200,
            },
            "2026-06-13T10:02:00",
        )
        self.store.save_reading_state(
            "paper-1",
            {
                "view": "linearized",
                "scrollY": 100,
                "activeSectionId": "section-old",
                "draft": {"content": "old draft"},
                "clientRevision": 100,
            },
            "2026-06-13T10:03:00",
        )

        state = self.store.get_reading_state("paper-1")
        self.assertEqual(state["view"], "bilingual")
        self.assertEqual(state["scrollY"], 900)
        self.assertEqual(state["clientRevision"], 200)
        self.assertEqual(state["draft"]["content"], "new draft")

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
        self.store.create_task(task, "D:/paper.pdf", "owner-1")
        saved = self.store.get_task("task-secret")
        self.assertEqual(saved["logs"], ["run --api-token *** --app-secret *** --folder-token ***"])

    def test_single_instance_lock_rejects_second_holder(self):
        lock_path = Path(self.temp_dir.name) / "gui.lock"
        first = SingleInstanceLock(lock_path)
        second = SingleInstanceLock(lock_path)
        self.assertTrue(first.acquire())
        self.assertFalse(second.acquire())
        first.release()
        self.assertTrue(second.acquire())
        second.release()


if __name__ == "__main__":
    unittest.main()
