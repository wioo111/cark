import unittest
from unittest.mock import Mock, patch

from translate_content import translate_chunk


class TranslateContentTests(unittest.TestCase):
    def test_translate_chunk_uses_configured_model(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "choices": [{"message": {"content": "translated"}}]
        }

        with patch("translate_content.requests.post", return_value=response) as post:
            translated, ok = translate_chunk(
                "Original paragraph",
                "api-key",
                "https://example.test/v1",
                "custom-model",
                max_retries=1,
            )

        self.assertTrue(ok)
        self.assertEqual(translated, "translated")
        self.assertEqual(post.call_args.kwargs["json"]["model"], "custom-model")


if __name__ == "__main__":
    unittest.main()
