import copy
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock

import gui_app_settings
import gui_app_utils


def default_agent():
    return {
        "id": "agent-default",
        "enabled": True,
        "name": "共读助手",
        "description": "默认共读助手",
        "rolePrompt": "Read carefully.",
        "apiKey": "",
        "baseUrl": "https://openrouter.ai/api/v1",
        "model": "",
    }


def default_settings():
    return {
        "mineru": {
            "backend": "local",
            "modelVersion": "pipeline",
            "parseMethod": "auto",
            "apiToken": "",
            "reuseExistingParse": True,
        },
        "translation": {
            "enabled": False,
            "apiKey": "",
            "baseUrl": "https://api.deepseek.com/v1",
            "model": "deepseek-chat",
        },
        "publish": {
            "prepareOnly": True,
            "imageMode": "note",
            "folderToken": "",
            "appId": "",
            "appSecret": "",
        },
        "copilot": {
            "agents": [default_agent()],
        },
    }


def sanitize(payload):
    return gui_app_settings.sanitize_gui_settings(
        payload,
        default_settings_factory=default_settings,
        default_copilot_agent=default_agent,
    )


class FakeResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"choices": [{"message": {"content": "ok"}}]}


class GuiAppSettingsTests(unittest.TestCase):
    def test_upload_readiness_passes_settings_by_keyword(self):
        received = {}

        def detect_capabilities(*, settings=None):
            received["settings"] = settings
            return {"ready": True, "issues": []}

        settings = {"mineru": {"backend": "local"}}
        gui_app_settings.ensure_upload_ready(
            detect_capabilities_func=detect_capabilities,
            settings=settings,
        )

        self.assertIs(received["settings"], settings)

    def test_materialize_does_not_rewrite_unchanged_versioned_settings(self):
        with TemporaryDirectory() as temp_dir:
            settings_path = Path(temp_dir) / "gui_settings.json"
            settings_path.write_text("{}", encoding="utf-8")
            expected = sanitize(default_settings())
            existing = copy.deepcopy(expected)
            existing["schemaVersion"] = 1
            write_json_file = Mock()

            result = gui_app_settings.materialize_gui_settings(
                settings_path=settings_path,
                default_settings_factory=default_settings,
                sanitize_settings=sanitize,
                load_json_object=lambda _path: copy.deepcopy(existing),
                write_json_file=write_json_file,
            )

            self.assertEqual(result, expected)
            write_json_file.assert_not_called()

    def test_materialize_serializes_concurrent_first_run_writes(self):
        with TemporaryDirectory() as temp_dir:
            settings_path = Path(temp_dir) / "gui_settings.json"
            state_lock = threading.Lock()
            active_writes = 0
            max_active_writes = 0
            write_count = 0

            def tracked_write(path, payload):
                nonlocal active_writes, max_active_writes, write_count
                with state_lock:
                    active_writes += 1
                    write_count += 1
                    max_active_writes = max(max_active_writes, active_writes)
                time.sleep(0.05)
                try:
                    gui_app_utils.write_json_file(path, payload)
                finally:
                    with state_lock:
                        active_writes -= 1

            def materialize():
                return gui_app_settings.materialize_gui_settings(
                    settings_path=settings_path,
                    default_settings_factory=default_settings,
                    sanitize_settings=sanitize,
                    load_json_object=gui_app_utils.load_json_object,
                    write_json_file=tracked_write,
                )

            with ThreadPoolExecutor(max_workers=8) as executor:
                results = list(executor.map(lambda _index: materialize(), range(8)))

            expected = sanitize(default_settings())
            self.assertTrue(all(result == expected for result in results))
            self.assertEqual(write_count, 1)
            self.assertEqual(max_active_writes, 1)

    def test_incomplete_enabled_agent_is_retained_but_disabled(self):
        settings = sanitize(
            {
                "copilot": {
                    "agents": [
                        {
                            "id": "agent-a",
                            "enabled": True,
                            "name": "Reviewer",
                            "description": "Checks methods.",
                            "rolePrompt": "Find weak evidence.",
                            "apiKey": "secret",
                            "baseUrl": "https://example.test/v1",
                            "model": "",
                        }
                    ]
                }
            }
        )

        agent = settings["copilot"]["agents"][0]
        self.assertFalse(agent["enabled"])
        self.assertEqual(agent["description"], "Checks methods.")
        self.assertEqual(agent["name"], "Reviewer")

    def test_complete_enabled_agent_stays_enabled(self):
        settings = sanitize(
            {
                "copilot": {
                    "agents": [
                        {
                            "id": "agent-a",
                            "enabled": True,
                            "name": "Reviewer",
                            "rolePrompt": "Find weak evidence.",
                            "apiKey": "secret",
                            "baseUrl": "https://example.test/v1",
                            "model": "model-a",
                        }
                    ]
                }
            }
        )

        self.assertTrue(settings["copilot"]["agents"][0]["enabled"])

    def test_copilot_agent_connection_uses_selected_agent(self):
        captured = {}

        def fake_post(url, headers, json, timeout):
            captured.update(
                {
                    "url": url,
                    "headers": headers,
                    "json": json,
                    "timeout": timeout,
                }
            )
            return FakeResponse()

        result = gui_app_settings.test_copilot_agent_connection(
            {
                "copilot": {
                    "agents": [
                        {
                            "id": "agent-a",
                            "enabled": True,
                            "name": "Reviewer",
                            "rolePrompt": "Find weak evidence.",
                            "apiKey": "secret",
                            "baseUrl": "https://example.test/v1",
                            "model": "model-a",
                        }
                    ]
                }
            },
            agent_id="agent-a",
            requests_post=fake_post,
        )

        self.assertTrue(result["ok"])
        self.assertEqual(captured["url"], "https://example.test/v1/chat/completions")
        self.assertEqual(captured["headers"]["Authorization"], "Bearer secret")
        self.assertEqual(captured["json"]["model"], "model-a")

    def test_copilot_agent_connection_reports_missing_fields(self):
        with self.assertRaisesRegex(ValueError, "模型"):
            gui_app_settings.test_copilot_agent_connection(
                {
                    "copilot": {
                        "agents": [
                            {
                                "id": "agent-a",
                                "name": "Reviewer",
                                "rolePrompt": "Find weak evidence.",
                                "apiKey": "secret",
                                "baseUrl": "https://example.test/v1",
                                "model": "",
                            }
                        ]
                    }
                },
                agent_id="agent-a",
            )


if __name__ == "__main__":
    unittest.main()
