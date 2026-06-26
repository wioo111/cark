import unittest

import gui_app_settings


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
            "failRatioLimit": 0.2,
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
