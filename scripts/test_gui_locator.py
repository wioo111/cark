import unittest

from gui_locator import build_annotation_locator, build_locator, build_memory_locator, normalize_locator


class GuiLocatorTests(unittest.TestCase):
    def test_build_locator_omits_empty_fields(self):
        locator = build_locator(
            view="linearized",
            annotation_id=" annotation-1 ",
            comment_id="",
            memory_item_id=None,
            block_id="block-3",
            quote=" quoted text ",
            context_before=" before ",
            context_after=" ",
        )

        self.assertEqual(
            locator,
            {
                "view": "linearized",
                "annotationId": "annotation-1",
                "blockId": "block-3",
                "quote": "quoted text",
                "contextBefore": "before",
            },
        )

    def test_normalize_locator_uses_default_shape(self):
        locator = normalize_locator(
            None,
            default={
                "view": "bilingual",
                "annotationId": "annotation-2",
                "commentId": "comment-2",
            },
        )

        self.assertEqual(
            locator,
            {
                "view": "bilingual",
                "annotationId": "annotation-2",
                "commentId": "comment-2",
            },
        )

    def test_build_annotation_locator_includes_annotation_quote_context(self):
        locator = build_annotation_locator(
            {
                "id": "annotation-3",
                "view": "linearized",
                "blockId": "block-9",
                "quote": "Core finding",
                "contextBefore": "Before",
                "contextAfter": "After",
            },
            comment_id="comment-3",
        )

        self.assertEqual(
            locator,
            {
                "view": "linearized",
                "annotationId": "annotation-3",
                "commentId": "comment-3",
                "blockId": "block-9",
                "quote": "Core finding",
                "contextBefore": "Before",
                "contextAfter": "After",
            },
        )

    def test_build_memory_locator_falls_back_to_anchor(self):
        locator = build_memory_locator(
            {
                "id": "memory-1",
                "sourceAnnotationId": "annotation-4",
                "blockId": "block-4",
                "quote": "Memory quote",
                "anchor": {
                    "view": "linearized",
                    "contextBefore": "Leading context",
                    "contextAfter": "Trailing context",
                },
            }
        )

        self.assertEqual(
            locator,
            {
                "view": "linearized",
                "annotationId": "annotation-4",
                "memoryItemId": "memory-1",
                "blockId": "block-4",
                "quote": "Memory quote",
                "contextBefore": "Leading context",
                "contextAfter": "Trailing context",
            },
        )

    def test_build_memory_locator_prefers_explicit_locator(self):
        locator = build_memory_locator(
            {
                "id": "memory-2",
                "sourceAnnotationId": "annotation-legacy",
                "blockId": "block-legacy",
                "quote": "legacy quote",
                "locator": {
                    "view": "bilingual",
                    "blockId": "block-9",
                    "quote": "locator quote",
                },
                "anchor": {
                    "view": "linearized",
                    "contextBefore": "before",
                    "contextAfter": "after",
                },
            }
        )

        self.assertEqual(
            locator,
            {
                "view": "bilingual",
                "annotationId": "annotation-legacy",
                "memoryItemId": "memory-2",
                "blockId": "block-9",
                "quote": "locator quote",
                "contextBefore": "before",
                "contextAfter": "after",
            },
        )

    def test_build_memory_locator_falls_back_to_anchor_quote(self):
        locator = build_memory_locator(
            {
                "id": "memory-3",
                "sourceAnnotationId": "annotation-5",
                "blockId": "block-5",
                "anchor": {
                    "view": "linearized",
                    "quote": "anchor quote",
                    "contextBefore": "Leading context",
                    "contextAfter": "Trailing context",
                },
            }
        )

        self.assertEqual(
            locator,
            {
                "view": "linearized",
                "annotationId": "annotation-5",
                "memoryItemId": "memory-3",
                "blockId": "block-5",
                "quote": "anchor quote",
                "contextBefore": "Leading context",
                "contextAfter": "Trailing context",
            },
        )


if __name__ == "__main__":
    unittest.main()
