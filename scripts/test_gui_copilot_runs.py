from __future__ import annotations

import tempfile
import unittest
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

import gui_copilot_runs
import gui_memory


@dataclass
class FakeRecord:
    paper_id: str = "paper-1"
    title: str = "Paper"


class GuiCopilotRunsTest(unittest.TestCase):
    def test_create_and_list_run(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            record = FakeRecord()
            memory_root = Path(temp_dir)
            run = gui_copilot_runs.create_run(
                record,
                memory_root,
                {
                    "annotationId": "annotation-1",
                    "agentIds": ["agent-a"],
                    "userMessage": "Explain this",
                },
                [{"id": "agent-a", "name": "Agent A"}],
            )

            self.assertEqual(run["status"], "queued")
            self.assertEqual(run["paperId"], "paper-1")
            self.assertEqual(run["annotationId"], "annotation-1")
            self.assertEqual(run["agents"][0]["agentId"], "agent-a")
            self.assertEqual(gui_copilot_runs.list_runs(record, memory_root)[0]["runId"], run["runId"])

    def test_marks_failed_agent_and_retries_only_target_agent(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            record = FakeRecord()
            memory_root = Path(temp_dir)
            run = gui_copilot_runs.create_run(
                record,
                memory_root,
                {"annotationId": "annotation-1"},
                [
                    {"id": "agent-a", "name": "Agent A"},
                    {"id": "agent-b", "name": "Agent B"},
                ],
            )
            run_id = str(run["runId"])

            gui_copilot_runs.mark_agent_done(record, memory_root, run_id, "agent-a", "comment-1")
            failed = gui_copilot_runs.mark_agent_failed(record, memory_root, run_id, "agent-b", "timeout")
            self.assertEqual(failed["status"], "failed")

            retried = gui_copilot_runs.prepare_retry(record, memory_root, run_id, "agent-b")
            agents = {str(agent["agentId"]): agent for agent in retried["agents"]}
            self.assertEqual(retried["status"], "queued")
            self.assertEqual(agents["agent-a"]["status"], "done")
            self.assertEqual(agents["agent-b"]["status"], "queued")
            self.assertIsNone(agents["agent-b"]["error"])

    def test_cancel_marks_active_agents_canceled(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            record = FakeRecord()
            memory_root = Path(temp_dir)
            run = gui_copilot_runs.create_run(
                record,
                memory_root,
                {"annotationId": "annotation-1"},
                [{"id": "agent-a", "name": "Agent A"}],
            )

            canceled = gui_copilot_runs.cancel_run(record, memory_root, str(run["runId"]))

            self.assertEqual(canceled["status"], "canceled")
            self.assertEqual(canceled["agents"][0]["status"], "canceled")

    def test_prepare_resume_requeues_active_agents_only(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            record = FakeRecord()
            memory_root = Path(temp_dir)
            run = gui_copilot_runs.create_run(
                record,
                memory_root,
                {"annotationId": "annotation-1"},
                [
                    {"id": "agent-a", "name": "Agent A"},
                    {"id": "agent-b", "name": "Agent B"},
                ],
            )
            run_id = str(run["runId"])

            gui_copilot_runs.mark_agent_done(record, memory_root, run_id, "agent-a", "comment-1")
            gui_copilot_runs.mark_agent_running(record, memory_root, run_id, "agent-b")
            resumed = gui_copilot_runs.prepare_resume(record, memory_root, run_id)
            agents = {str(agent["agentId"]): agent for agent in resumed["agents"]}

            self.assertEqual(resumed["status"], "queued")
            self.assertEqual(agents["agent-a"]["status"], "done")
            self.assertEqual(agents["agent-b"]["status"], "queued")

    def test_expire_stale_active_runs_marks_run_failed(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            record = FakeRecord()
            memory_root = Path(temp_dir)
            run = gui_copilot_runs.create_run(
                record,
                memory_root,
                {"annotationId": "annotation-1"},
                [{"id": "agent-a", "name": "Agent A"}],
            )
            run_id = str(run["runId"])
            running = gui_copilot_runs.mark_agent_running(record, memory_root, run_id, "agent-a")
            running["updatedAt"] = (datetime.now() - timedelta(minutes=10)).isoformat()
            gui_copilot_runs.save_run(record, memory_root, running)

            expired_count = gui_copilot_runs.expire_stale_active_runs(record, memory_root, timeout_seconds=1)
            expired = gui_copilot_runs.load_run(record, memory_root, run_id)

            self.assertEqual(expired_count, 1)
            self.assertEqual(expired["status"], "failed")
            self.assertEqual(expired["agents"][0]["status"], "failed")
            self.assertIn("超时", str(expired["agents"][0]["error"]))

    def test_run_file_uses_schema_version_and_backup_fallback(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            record = FakeRecord()
            memory_root = Path(temp_dir)
            run = gui_copilot_runs.create_run(
                record,
                memory_root,
                {"annotationId": "annotation-1"},
                [{"id": "agent-a", "name": "Agent A"}],
            )
            run_id = str(run["runId"])
            path = gui_copilot_runs.run_path(record, memory_root, run_id)
            payload = gui_memory.read_json_file(path, default={})
            self.assertEqual(payload["schemaVersion"], 1)

            gui_copilot_runs.mark_agent_running(record, memory_root, run_id, "agent-a")
            backup_payload = gui_memory.read_json_file(gui_memory.json_backup_path(path), default={})
            self.assertEqual(backup_payload["status"], "queued")

            path.write_text("{broken", encoding="utf-8")
            recovered = gui_copilot_runs.load_run(record, memory_root, run_id)
            self.assertEqual(recovered["runId"], run_id)


if __name__ == "__main__":
    unittest.main()
