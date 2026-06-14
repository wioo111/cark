import os
import tempfile
import unittest
from pathlib import Path

from pdf_to_feishu_docx import _ParseLock
from process_utils import is_process_alive


class ProcessUtilsTests(unittest.TestCase):
    def test_current_process_is_alive(self):
        self.assertTrue(is_process_alive(os.getpid()))

    def test_invalid_process_is_not_alive(self):
        self.assertFalse(is_process_alive(-1))
        self.assertFalse(is_process_alive(2_147_483_647))

    def test_parse_lock_replaces_dead_owner(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            lock_path = Path(temp_dir) / "mineru_parse.lock"
            lock_path.write_text("2147483647", encoding="ascii")

            with _ParseLock(lock_path, timeout_seconds=0.1):
                self.assertEqual(
                    lock_path.read_text(encoding="ascii"),
                    str(os.getpid()),
                )

            self.assertFalse(lock_path.exists())


if __name__ == "__main__":
    unittest.main()
