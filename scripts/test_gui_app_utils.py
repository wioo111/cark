import unittest

import gui_app_utils


class GuiAppUtilsTests(unittest.TestCase):
    def test_sanitize_filename_preserves_unicode_and_extension(self):
        self.assertEqual(gui_app_utils.sanitize_filename("论文：测试.pdf"), "论文：测试.pdf")

    def test_sanitize_filename_avoids_windows_reserved_names(self):
        self.assertEqual(gui_app_utils.sanitize_filename("CON.pdf"), "_CON.pdf")

    def test_sanitize_filename_limits_long_names(self):
        result = gui_app_utils.sanitize_filename(f"{'a' * 300}.pdf")
        self.assertLessEqual(len(result), 180)
        self.assertTrue(result.endswith(".pdf"))


if __name__ == "__main__":
    unittest.main()
