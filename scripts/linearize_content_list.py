import argparse
import html
import json
import re
from pathlib import Path


SUP_TAG_RE = re.compile(r"</?sup>")
HTML_TAG_RE = re.compile(r"<[^>]+>")
NUMBERED_HEADING_RE = re.compile(r"^(?P<prefix>\d+(?:\.\d+)*)\s+(?P<title>.+)$")
APPENDIX_HEADING_RE = re.compile(r"^(?P<prefix>[A-Z](?:\.\d+)*)\s+(?P<title>.+)$")
INLINE_HEADING_SPLIT_RE = re.compile(
    r"^(?P<head>(?P<prefix>(?:\d+(?:\.\d+)+|[A-Z](?:\.\d+)+))\s+[^。?!！？]{1,180}?)[。?!！？]\s*(?P<body>.+)$"
)
INLINE_HEADING_SPLIT_DOT_RE = re.compile(
    r"^(?P<head>(?P<prefix>(?:\d+(?:\.\d+)+|[A-Z](?:\.\d+)+))\s+.{1,180}?)\.\s+(?P<body>.+)$"
)
SPECIAL_HEADINGS = {
    "摘要": 2,
    "抽象的": 2,
    "CCS 概念": 2,
    "关键词": 2,
    "致谢": 2,
    "参考": 2,
}


def bbox_metrics(item):
    bbox = item.get("bbox", [0, 0, 0, 0])
    x1, y1, x2, y2 = bbox
    return {
        "x1": x1,
        "y1": y1,
        "x2": x2,
        "y2": y2,
        "w": max(0, x2 - x1),
        "h": max(0, y2 - y1),
        "cx": (x1 + x2) / 2,
    }


def page_size(items):
    max_x = 0
    max_y = 0
    for item in items:
        m = bbox_metrics(item)
        max_x = max(max_x, m["x2"])
        max_y = max(max_y, m["y2"])
    return max_x or 1, max_y or 1


def clean_text(text):
    text = html.unescape(text or "")
    text = SUP_TAG_RE.sub("", text)
    text = HTML_TAG_RE.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


def numbered_heading_level(prefix):
    depth = prefix.count(".") + 1
    if depth <= 2:
        return 2
    return min(6, depth)


def infer_heading_level(text):
    text = clean_text(text)
    if not text:
        return None

    if text in SPECIAL_HEADINGS:
        return SPECIAL_HEADINGS[text]

    match = NUMBERED_HEADING_RE.match(text)
    if match and len(text) <= 110 and "。 " not in text and "？" not in text and "!" not in text:
        return numbered_heading_level(match.group("prefix"))

    match = APPENDIX_HEADING_RE.match(text)
    if match and len(text) <= 110 and "。 " not in text and "？" not in text and "!" not in text:
        prefix = match.group("prefix")
        return 2 if "." not in prefix else min(6, prefix.count(".") + 2)

    return None


def split_inline_heading(text):
    text = clean_text(text)
    if not text:
        return None

    match = INLINE_HEADING_SPLIT_RE.match(text) or INLINE_HEADING_SPLIT_DOT_RE.match(text)
    if not match:
        return None

    prefix = match.group("prefix")
    heading_text = match.group("head").strip()
    body = match.group("body").strip()
    if not body:
        return None
    return numbered_heading_level(prefix), heading_text, body


def is_plausible_standalone_heading(text):
    text = clean_text(text)
    if not text:
        return False
    if infer_heading_level(text) is not None:
        return True
    if any(mark in text for mark in ("。", "？", "!", "！")):
        return False
    if len(text) > 40:
        return False
    if text.startswith(("价值：", "需求：", "概括", "总之", "例如", "我们", "在这")):
        return False
    return True


def is_small_decorative_image(item, page_w, page_h):
    if item.get("type") != "image":
        return False

    m = bbox_metrics(item)
    has_caption = any(clean_text(caption) for caption in item.get("image_caption", []))
    near_page_edge = m["y1"] >= page_h * 0.76 or m["y2"] <= page_h * 0.14
    small_area = (m["w"] * m["h"]) <= page_w * page_h * 0.025
    narrow = m["w"] <= page_w * 0.18
    return near_page_edge and small_area and narrow and not has_caption


def is_footnote_like_text(item, page_w, page_h):
    if item.get("type") != "text":
        return False

    text = clean_text(item.get("text", ""))
    if not text:
        return False
    if split_inline_heading(text) or infer_heading_level(text):
        return False

    m = bbox_metrics(item)
    near_page_bottom = m["y1"] >= page_h * 0.76
    near_left_footer = m["x1"] <= page_w * 0.45
    shortish = len(text) <= 220
    narrowish = m["w"] <= page_w * 0.36

    if "Both authors contributed equally" in text:
        return True
    if item.get("page_idx", 0) == 0 and near_page_bottom and near_left_footer and shortish and narrowish:
        return True
    if text.startswith("*") and shortish:
        return True
    return False


def is_citation_note(item, page_w, page_h):
    if item.get("type") != "text":
        return False

    text = clean_text(item.get("text", ""))
    if "doi.org/" not in text.lower():
        return False

    m = bbox_metrics(item)
    near_page_bottom = m["y1"] >= page_h * 0.76
    return near_page_bottom and len(text) <= 500


def is_deferred_block(item, page_w, page_h):
    return is_footnote_like_text(item, page_w, page_h) or is_citation_note(item, page_w, page_h)


def is_multicolumn_page(items, page_w):
    left = 0
    right = 0
    for item in items:
        if item.get("type") not in {"text", "image", "table"}:
            continue
        m = bbox_metrics(item)
        if m["w"] >= page_w * 0.72:
            continue
        if m["cx"] <= page_w * 0.5:
            left += 1
        else:
            right += 1
    return left >= 3 and right >= 3


def sort_by_position(items):
    return sorted(items, key=lambda item: (bbox_metrics(item)["y1"], bbox_metrics(item)["x1"]))


def reorder_regular_blocks(items, page_w, page_h):
    if not is_multicolumn_page(items, page_w):
        return sort_by_position(items)

    top_full_width = []
    left_column = []
    right_column = []
    bottom_full_width = []

    for item in items:
        m = bbox_metrics(item)
        if m["w"] >= page_w * 0.72:
            if m["y1"] <= page_h * 0.2:
                top_full_width.append(item)
            else:
                bottom_full_width.append(item)
            continue

        if m["cx"] <= page_w * 0.5:
            left_column.append(item)
        else:
            right_column.append(item)

    return (
        sort_by_position(top_full_width)
        + sort_by_position(left_column)
        + sort_by_position(right_column)
        + sort_by_position(bottom_full_width)
    )


def format_block(item):
    block_type = item.get("type")
    if block_type == "text":
        text = clean_text(item.get("text", ""))
        if not text:
            return ""
        inline_heading = split_inline_heading(text)
        level = item.get("text_level")
        if isinstance(level, int) and level > 0:
            inferred_level = infer_heading_level(text)
            level = max(1, min(6, (inline_heading[0] if inline_heading else inferred_level) or level))
            if inline_heading:
                _, heading_text, body = inline_heading
                return f"{'#' * level} {heading_text}\n\n{body}"
            if not is_plausible_standalone_heading(text):
                return text
            return f"{'#' * level} {text}"
        if inline_heading:
            level, heading_text, body = inline_heading
            return f"{'#' * level} {heading_text}\n\n{body}"
        inferred_level = infer_heading_level(text)
        if inferred_level:
            return f"{'#' * inferred_level} {text}"
        return text

    if block_type == "image":
        img_path = item.get("img_path", "").strip()
        parts = []
        if img_path:
            parts.append(f"![]({img_path})")
        for caption in item.get("image_caption", []):
            caption = clean_text(caption)
            if caption:
                parts.append(caption)
        return "\n".join(parts).strip()

    if block_type == "table":
        table_body = item.get("table_body", "").strip()
        if table_body:
            return table_body

    return ""


def linearize_page(items):
    page_w, page_h = page_size(items)
    deferred = []
    regular = []
    citation_notes = []

    for item in items:
        if is_small_decorative_image(item, page_w, page_h):
            continue
        if is_citation_note(item, page_w, page_h):
            citation_notes.append(item)
        elif is_deferred_block(item, page_w, page_h):
            deferred.append(item)
        else:
            regular.append(item)
    return reorder_regular_blocks(regular, page_w, page_h) + sort_by_position(citation_notes) + sort_by_position(deferred)


def linearize_content_list(items):
    pages = {}
    for item in items:
        pages.setdefault(item.get("page_idx", 0), []).append(item)

    output_blocks = []
    for page_idx in sorted(pages):
        output_blocks.extend(linearize_page(pages[page_idx]))

    blocks = []
    for item in output_blocks:
        rendered = format_block(item)
        if rendered:
            blocks.append(rendered)

    blocks = stitch_paragraph_blocks(blocks)

    return "\n\n".join(blocks).strip() + "\n"


def normalize_paragraph_text(text):
    text = text.replace("（第 6.1.1 节，6.1），", "（第 6.1.1 节），")
    text = text.replace(" 6.1），", " ")
    text = text.replace("6.1），", "")
    return text


def is_heading_block(text):
    return text.startswith("#")


def is_media_block(text):
    return text.startswith("![](") or text.startswith("|")


def should_merge_paragraphs(previous, current):
    if is_heading_block(current):
        return False
    if is_media_block(previous) or is_media_block(current):
        return False
    previous = previous.strip()
    current = current.strip()
    if not previous or not current:
        return False
    if re.match(r"^\d+(?:\.\d+)*[)）]", current):
        return True
    if is_heading_block(previous):
        if "\n\n" not in previous:
            return False
        previous = previous.rsplit("\n\n", 1)[1].strip()
    return not re.search(r'[。！？.!?"”’)\]]$', previous)


def stitch_paragraph_blocks(blocks):
    stitched = []
    for block in blocks:
        block = normalize_paragraph_text(block.strip())
        if not block:
            continue
        if stitched and should_merge_paragraphs(stitched[-1], block):
            stitched[-1] = normalize_paragraph_text(f"{stitched[-1].rstrip()} {block.lstrip()}")
        else:
            stitched.append(block)
    return stitched


def main():
    parser = argparse.ArgumentParser(description="Linearize MinerU content_list into cleaner markdown.")
    parser.add_argument("input_json", help="Path to MinerU content_list.json")
    parser.add_argument("output_md", nargs="?", help="Optional output markdown path")
    args = parser.parse_args()

    input_path = Path(args.input_json)
    output_path = Path(args.output_md) if args.output_md else input_path.with_name(input_path.stem + "_linearized.md")

    items = json.loads(input_path.read_text(encoding="utf-8"))
    markdown = linearize_content_list(items)
    output_path.write_text(markdown, encoding="utf-8")
    print(output_path)


if __name__ == "__main__":
    main()
