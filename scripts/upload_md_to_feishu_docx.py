import argparse
import json
import os
import sys
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
    batches = build_block_batches(first_level_ids, blocks, max_descendants=1000)
    results = []
    for batch_index, batch in enumerate(batches):
        response = requests.post(
            f"{OPEN_FEISHU}/open-apis/docx/v1/documents/{document_id}/blocks/{document_id}/descendant",
            headers=build_headers(access_token),
            params={"document_revision_id": -1},
            json={
                "index": 0 if batch_index == 0 else -1,
                "children_id": batch["children_id"],
                "descendants": batch["descendants"],
            },
            timeout=120,
        )
        payload = parse_json_response(response, f"写入飞书原生块（第 {batch_index + 1} 批）")
        if payload.get("code", -1) != 0:
            raise FeishuApiError(f"写入飞书原生块失败: {payload}")
        results.append(payload.get("data", {}))
    return results


def collect_subtree_ids(block_id, children_map):
    subtree = [block_id]
    for child_id in children_map.get(block_id, []):
        subtree.extend(collect_subtree_ids(child_id, children_map))
    return subtree


def build_block_batches(first_level_ids, blocks, max_descendants):
    by_id = {block["block_id"]: sanitize_block_for_create(block) for block in blocks}
    children_map = {block_id: list(block.get("children", [])) for block_id, block in by_id.items()}
    batches = []
    current_child_ids = []
    current_descendants = []

    for root_id in first_level_ids:
        subtree_ids = collect_subtree_ids(root_id, children_map)
        subtree_blocks = [by_id[subtree_id] for subtree_id in subtree_ids]

        if len(subtree_blocks) > max_descendants:
            raise FeishuApiError(f"单个顶层块子树超过 {max_descendants} 个节点，暂不支持自动拆分: {root_id}")

        if current_descendants and len(current_descendants) + len(subtree_blocks) > max_descendants:
            batches.append({"children_id": current_child_ids, "descendants": current_descendants})
            current_child_ids = []
            current_descendants = []

        current_child_ids.append(root_id)
        current_descendants.extend(subtree_blocks)

    if current_descendants:
        batches.append({"children_id": current_child_ids, "descendants": current_descendants})

    return batches


def prepare_markdown(markdown_path, image_mode):
    # This is imported from upload_md_to_feishu, but we'll override it here 
    # to inject the Hermes-style academic template.
    from upload_md_to_feishu import prepare_markdown as original_prepare
    prepared_markdown, local_images = original_prepare(markdown_path, image_mode)
    
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
