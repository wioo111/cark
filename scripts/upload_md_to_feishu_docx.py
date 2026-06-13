import argparse
import html
import json
import os
import re
import sys
import uuid
from pathlib import Path

import requests

from patch_feishu_doc_images import (
    apply_text_replacements,
    legacy_frontmatter_replacements,
    load_replacements,
    patch_images,
)
from upload_md_to_feishu import FeishuApiError, get_tenant_access_token, parse_json_response, prepare_markdown


OPEN_FEISHU = "https://open.feishu.cn"
HTML_TABLE_RE = re.compile(r"<table\b[^>]*>(.*?)</table>", re.IGNORECASE | re.DOTALL)
HTML_ROW_RE = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
HTML_CELL_RE = re.compile(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", re.IGNORECASE | re.DOTALL)
HTML_TAG_RE = re.compile(r"<[^>]+>")


def parse_args():
    parser = argparse.ArgumentParser(description="Create a native Feishu docx document from Markdown blocks.")
    parser.add_argument("markdown_file", help="Path to the markdown file to upload")
    parser.add_argument("--title", help="Optional title for the generated document")
    parser.add_argument(
        "--folder-token",
        default=os.getenv("FEISHU_FOLDER_TOKEN", ""),
        help="Target folder token. Defaults to FEISHU_FOLDER_TOKEN. Leave empty for My Space root.",
    )
    parser.add_argument(
        "--app-id",
        default=os.getenv("FEISHU_APP_ID", ""),
        help="Feishu app id. Defaults to FEISHU_APP_ID.",
    )
    parser.add_argument(
        "--app-secret",
        default=os.getenv("FEISHU_APP_SECRET", ""),
        help="Feishu app secret. Defaults to FEISHU_APP_SECRET.",
    )
    parser.add_argument(
        "--prepared-output",
        help="Optional path to write the prepared markdown file.",
    )
    parser.add_argument(
        "--image-mode",
        choices=["strip", "note", "keep"],
        default="note",
        help="How to handle local image references before conversion.",
    )
    parser.add_argument(
        "--normalize-frontmatter",
        action="store_true",
        help="Deprecated: apply hard-coded fixes for the current test paper only.",
    )
    parser.add_argument(
        "--replacements-file",
        help="Optional JSON file describing post-import text replacements.",
    )
    parser.add_argument(
        "--replacement-block-limit",
        type=int,
        default=40,
        help="Only inspect the first N text-like blocks when applying configured replacements.",
    )
    parser.add_argument(
        "--prepare-only",
        action="store_true",
        help="Only prepare a Feishu-friendly markdown file and skip API calls.",
    )
    return parser.parse_args()


def build_headers(access_token):
    return {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json; charset=utf-8",
    }


def create_document(access_token, folder_token, title):
    body = {}
    if folder_token:
        body["folder_token"] = folder_token
    if title:
        body["title"] = title

    response = requests.post(
        f"{OPEN_FEISHU}/open-apis/docx/v1/documents",
        headers=build_headers(access_token),
        json=body,
        timeout=30,
    )
    payload = parse_json_response(response, "创建原生飞书文档")
    if payload.get("code", -1) != 0:
        raise FeishuApiError(f"创建原生飞书文档失败: {payload}")

    data = payload.get("data", {})
    document = data.get("document", {})
    document_id = document.get("document_id")
    if not document_id:
        raise FeishuApiError(f"创建原生飞书文档成功但未返回 document_id: {payload}")
    return document_id, payload


def convert_markdown_to_blocks(access_token, markdown_text):
    response = requests.post(
        f"{OPEN_FEISHU}/open-apis/docx/v1/documents/blocks/convert",
        headers=build_headers(access_token),
        json={"content_type": "markdown", "content": markdown_text},
        timeout=120,
    )
    payload = parse_json_response(response, "转换 Markdown 为飞书块")
    if payload.get("code", -1) != 0:
        raise FeishuApiError(f"转换 Markdown 为飞书块失败: {payload}")

    data = payload.get("data", {})
    blocks = data.get("blocks", [])
    first_level_ids = data.get("first_level_block_ids", [])
    if not blocks or not first_level_ids:
        raise FeishuApiError(f"转换 Markdown 成功但未返回 blocks: {payload}")
    return blocks, first_level_ids


def sanitize_block_for_create(block):
    cleaned = {}
    for key, value in block.items():
        if key == "parent_id":
            continue
        if key == "table" and isinstance(value, dict):
            property_value = value.get("property", {}) if isinstance(value.get("property", {}), dict) else {}
            property_value = {k: v for k, v in property_value.items() if k != "merge_info"}
            value = {"property": property_value}
        cleaned[key] = value
    cleaned.setdefault("children", [])
    return cleaned


def create_nested_blocks(access_token, document_id, first_level_ids, blocks):
    first_level_ids, blocks = split_oversized_top_level_tables(
        first_level_ids,
        blocks,
        max_descendants=1000,
        table_split_descendants=400,
    )
    by_id = {block["block_id"]: sanitize_block_for_create(block) for block in blocks}
    children_map = {block_id: list(block.get("children", [])) for block_id, block in by_id.items()}
    return append_block_children(
        access_token=access_token,
        document_id=document_id,
        parent_block_id=document_id,
        child_ids=first_level_ids,
        by_id=by_id,
        children_map=children_map,
        max_descendants=1000,
    )


def collect_subtree_ids(block_id, children_map):
    subtree = [block_id]
    for child_id in children_map.get(block_id, []):
        subtree.extend(collect_subtree_ids(child_id, children_map))
    return subtree


def split_table_row_groups(root_id, block, by_id, children_map, max_descendants):
    table = block.get("table", {})
    prop = table.get("property", {}) if isinstance(table, dict) else {}
    column_size = prop.get("column_size")
    children = list(block.get("children", []))
    if not column_size or column_size <= 0 or len(children) % column_size != 0:
        return None

    row_groups = []
    current_rows = []
    current_size = 1
    for offset in range(0, len(children), column_size):
        row_cell_ids = children[offset: offset + column_size]
        row_size = sum(len(collect_subtree_ids(cell_id, children_map)) for cell_id in row_cell_ids)
        if current_rows and current_size + row_size > max_descendants:
            row_groups.append(current_rows)
            current_rows = []
            current_size = 1
        current_rows.append(row_cell_ids)
        current_size += row_size

    if current_rows:
        row_groups.append(current_rows)

    if len(row_groups) <= 1:
        return None

    split_blocks = []
    split_root_ids = []
    for group_index, rows in enumerate(row_groups):
        child_ids = [cell_id for row in rows for cell_id in row]
        target_root_id = root_id if group_index == 0 else str(uuid.uuid4())
        new_block = dict(block)
        new_block["block_id"] = target_root_id
        new_block["children"] = child_ids
        new_table = dict(table)
        new_prop = dict(prop)
        new_prop["row_size"] = len(rows)
        new_table["property"] = new_prop
        new_block["table"] = new_table
        split_blocks.append(new_block)
        split_root_ids.append(target_root_id)

    return split_root_ids, split_blocks


def split_oversized_top_level_tables(first_level_ids, blocks, max_descendants, table_split_descendants):
    by_id = {block["block_id"]: sanitize_block_for_create(block) for block in blocks}
    children_map = {block_id: list(block.get("children", [])) for block_id, block in by_id.items()}
    updated_blocks = {block["block_id"]: dict(block) for block in blocks}
    updated_first_level_ids = []

    for root_id in first_level_ids:
        block = by_id.get(root_id)
        if not block:
            updated_first_level_ids.append(root_id)
            continue

        subtree_size = len(collect_subtree_ids(root_id, children_map))
        if block.get("block_type") != 31:
            updated_first_level_ids.append(root_id)
            continue

        if subtree_size <= table_split_descendants:
            updated_first_level_ids.append(root_id)
            continue

        split_result = split_table_row_groups(root_id, block, by_id, children_map, table_split_descendants)
        if not split_result:
            updated_first_level_ids.append(root_id)
            continue

        split_root_ids, split_blocks = split_result
        updated_first_level_ids.extend(split_root_ids)
        updated_blocks[root_id] = split_blocks[0]
        for extra_block in split_blocks[1:]:
            updated_blocks[extra_block["block_id"]] = extra_block

    return updated_first_level_ids, list(updated_blocks.values())


def normalize_html_cell_text(cell_html):
    text = HTML_TAG_RE.sub(" ", cell_html)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def flatten_html_tables(markdown_text):
    def replace_table(match):
        rows = []
        for row_html in HTML_ROW_RE.findall(match.group(0)):
            cells = [normalize_html_cell_text(cell) for cell in HTML_CELL_RE.findall(row_html)]
            cells = [cell for cell in cells if cell]
            if cells:
                rows.append(cells)

        if not rows:
            return match.group(0)

        lines = ["### Table Fallback", ""]
        header = rows[0]
        data_rows = rows[1:] if len(rows) > 1 else []

        if len(header) >= 2:
            lines.append(f"- Columns: {header[0]} | {header[1]}")
        else:
            lines.append(f"- Columns: {' | '.join(header)}")

        for index, row in enumerate(data_rows, start=1):
            if len(row) == 1:
                lines.append(f"- Row {index}: {row[0]}")
            else:
                lines.append(f"- Row {index}: {row[0]} -> {row[1]}")
        lines.append("")
        return "\n".join(lines)

    return HTML_TABLE_RE.sub(replace_table, markdown_text)


def create_descendant_batch(access_token, document_id, parent_block_id, children_id, descendants, batch_label, index):
    response = requests.post(
        f"{OPEN_FEISHU}/open-apis/docx/v1/documents/{document_id}/blocks/{parent_block_id}/descendant",
        headers=build_headers(access_token),
        params={"document_revision_id": -1},
        json={
            "index": index,
            "children_id": children_id,
            "descendants": descendants,
        },
        timeout=120,
    )
    payload = parse_json_response(response, batch_label)
    if payload.get("code", -1) != 0:
        raise FeishuApiError(f"{batch_label}失败: {payload}")
    return payload.get("data", {})


def block_id_relations_map(batch_result):
    relations = batch_result.get("block_id_relations", [])
    return {
        relation["temporary_block_id"]: relation["block_id"]
        for relation in relations
        if relation.get("temporary_block_id") and relation.get("block_id")
    }


def clone_root_only_block(block):
    root_block = dict(block)
    root_block["children"] = []
    return root_block


def is_invalid_parent_children_error(exc):
    text = str(exc)
    return "1770030" in text or "invalid parent children relation" in text


def build_block_batches(child_ids, by_id, children_map, max_descendants):
    batches = []
    current_child_ids = []
    current_descendants = []

    for root_id in child_ids:
        subtree_ids = collect_subtree_ids(root_id, children_map)
        subtree_blocks = [by_id[subtree_id] for subtree_id in subtree_ids]
        if current_descendants and len(current_descendants) + len(subtree_blocks) > max_descendants:
            batches.append({"children_id": current_child_ids, "descendants": current_descendants})
            current_child_ids = []
            current_descendants = []

        current_child_ids.append(root_id)
        current_descendants.extend(subtree_blocks)

    if current_descendants:
        batches.append({"children_id": current_child_ids, "descendants": current_descendants})

    return batches


def append_block_children(access_token, document_id, parent_block_id, child_ids, by_id, children_map, max_descendants):
    results = []
    pending_child_ids = []
    pending_descendants = []
    next_index = 0

    def emit_batch(batch_child_ids, batch_descendants, batch_label):
        nonlocal next_index
        result = create_descendant_batch(
            access_token=access_token,
            document_id=document_id,
            parent_block_id=parent_block_id,
            children_id=batch_child_ids,
            descendants=batch_descendants,
            batch_label=batch_label,
            index=next_index,
        )
        next_index = -1
        results.append(result)
        return result

    def flush_pending():
        nonlocal pending_child_ids, pending_descendants
        if not pending_child_ids:
            return
        try:
            emit_batch(
                pending_child_ids,
                pending_descendants,
                f"写入飞书原生块（父块 {parent_block_id}，子树数 {len(pending_child_ids)}）",
            )
        except FeishuApiError as exc:
            if len(pending_child_ids) == 1 or not is_invalid_parent_children_error(exc):
                raise
            for child_id in pending_child_ids:
                subtree_ids = collect_subtree_ids(child_id, children_map)
                subtree_blocks = [by_id[subtree_id] for subtree_id in subtree_ids]
                emit_batch(
                    [child_id],
                    subtree_blocks,
                    f"写入飞书原生块（父块 {parent_block_id}，单根重试 {child_id}）",
                )
        pending_child_ids = []
        pending_descendants = []

    for root_id in child_ids:
        subtree_ids = collect_subtree_ids(root_id, children_map)
        subtree_blocks = [by_id[subtree_id] for subtree_id in subtree_ids]
        if len(subtree_blocks) <= max_descendants:
            if pending_descendants and len(pending_descendants) + len(subtree_blocks) > max_descendants:
                flush_pending()
            pending_child_ids.append(root_id)
            pending_descendants.extend(subtree_blocks)
            continue

        flush_pending()
        root_only_result = emit_batch(
            [root_id],
            [clone_root_only_block(by_id[root_id])],
            f"创建超大块根节点 {root_id}",
        )

        created_root_id = block_id_relations_map(root_only_result).get(root_id)
        if not created_root_id:
            raise FeishuApiError(f"创建超大块根节点成功但未返回 block_id: {root_id}")

        child_results = append_block_children(
            access_token=access_token,
            document_id=document_id,
            parent_block_id=created_root_id,
            child_ids=children_map.get(root_id, []),
            by_id=by_id,
            children_map=children_map,
            max_descendants=max_descendants,
        )
        results.extend(child_results)

    flush_pending()
    return results


def prepare_markdown(markdown_path, image_mode):
    # This is imported from upload_md_to_feishu, but we'll override it here 
    # to inject the Hermes-style academic template.
    from upload_md_to_feishu import prepare_markdown as original_prepare
    prepared_markdown, local_images = original_prepare(markdown_path, image_mode)
    
    prepared_markdown = flatten_html_tables(prepared_markdown)

    # Inject Hermes-style academic template at the top
    title = markdown_path.stem.replace("_feishu_docx_ready", "").replace("_linearized", "").replace("_bilingual", "")
    
    template = f"""# 论文导读：{title}

> 📌 **阅读状态**：待读
> 🏷️ **标签**：#文献阅读

---
## 🎯 AI 核心摘要
- 核心贡献：(等待总结)
- 采用方法：(等待总结)

## 💡 我的思考 (Personal Notes)
> （在此记录你的灵感、质疑和下一步研究计划）

---
## 📄 正文与双语翻译

{prepared_markdown}"""

    return template, local_images


def main():
    args = parse_args()
    markdown_path = Path(args.markdown_file).resolve()
    if not markdown_path.exists():
        raise FeishuApiError(f"Markdown 文件不存在: {markdown_path}")

    prepared_markdown, local_images = prepare_markdown(markdown_path, args.image_mode)
    prepared_path = (
        Path(args.prepared_output).resolve()
        if args.prepared_output
        else markdown_path.with_name(markdown_path.stem + "_feishu_docx_ready.md")
    )
    prepared_path.write_text(prepared_markdown, encoding="utf-8")

    if args.prepare_only:
        print(
            json.dumps(
                {
                    "prepared_markdown": str(prepared_path),
                    "local_images_rewritten": local_images,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return

    access_token = get_tenant_access_token(args.app_id, args.app_secret)
    document_id, create_payload = create_document(
        access_token=access_token,
        folder_token=args.folder_token,
        title=args.title or markdown_path.stem,
    )
    blocks, first_level_ids = convert_markdown_to_blocks(access_token, prepared_markdown)
    create_blocks_payload = create_nested_blocks(access_token, document_id, first_level_ids, blocks)

    image_results = patch_images(access_token, document_id, prepared_path)
    replacement_rules = load_replacements(args.replacements_file)
    if args.normalize_frontmatter:
        replacement_rules.extend(legacy_frontmatter_replacements())
    text_replacements_applied = []
    if replacement_rules:
        text_replacements_applied = apply_text_replacements(
            access_token,
            document_id,
            replacement_rules,
            block_limit=args.replacement_block_limit,
        )

    output = {
        "prepared_markdown": str(prepared_path),
        "document_url": f"https://jcnzgldxlxqe.feishu.cn/docx/{document_id}",
        "document_token": document_id,
        "local_images_rewritten": local_images,
        "patched_images": image_results,
        "text_replacements_applied": text_replacements_applied,
        "create_document_result": create_payload.get("data", {}),
        "create_blocks_result": create_blocks_payload,
    }
    # Windows 控制台默认 GBK(cp936)，输出含 emoji/中文的 JSON 会触发
    # UnicodeEncodeError。以 UTF-8 安全写出，避免文档已创建却因打印崩溃而拿不到链接。
    payload = json.dumps(output, ensure_ascii=False, indent=2)
    try:
        sys.stdout.buffer.write(payload.encode("utf-8"))
        sys.stdout.buffer.write(b"\n")
        sys.stdout.buffer.flush()
    except (AttributeError, ValueError):
        enc = getattr(sys.stdout, "encoding", None) or "utf-8"
        sys.stdout.write(payload.encode(enc, errors="replace").decode(enc, errors="replace"))
        sys.stdout.write("\n")


if __name__ == "__main__":
    try:
        main()
    except FeishuApiError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
