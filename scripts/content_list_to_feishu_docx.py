import argparse
import json
import os
import sys
from pathlib import Path

from linearize_content_list import linearize_content_list
from patch_feishu_doc_images import apply_text_replacements, load_replacements, patch_images
from upload_md_to_feishu import FeishuApiError, get_tenant_access_token, prepare_markdown
from upload_md_to_feishu_docx import (
    convert_markdown_to_blocks,
    create_document,
    create_nested_blocks,
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="One-shot pipeline: content_list.json -> linearized markdown -> native Feishu docx."
    )
    parser.add_argument("--config", help="Optional JSON config file for the pipeline.")
    parser.add_argument("--content-list-json", help="Path to MinerU content_list.json")
    parser.add_argument("--linearized-output", help="Optional output path for the linearized markdown.")
    parser.add_argument("--prepared-output", help="Optional output path for the Feishu-ready markdown.")
    parser.add_argument("--title", help="Optional Feishu document title.")
    parser.add_argument(
        "--folder-token",
        default=os.getenv("FEISHU_FOLDER_TOKEN", ""),
        help="Target Feishu folder token. Defaults to FEISHU_FOLDER_TOKEN.",
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
        "--image-mode",
        choices=["strip", "note", "keep"],
        default=None,
        help="How to handle local image references before docx conversion. Defaults to config or note.",
    )
    parser.add_argument(
        "--replacements-file",
        help="Optional JSON file describing post-import text replacements.",
    )
    parser.add_argument(
        "--replacement-block-limit",
        type=int,
        default=None,
        help="Only inspect the first N text-like blocks when applying configured replacements.",
    )
    parser.add_argument(
        "--prepare-only",
        action="store_true",
        help="Stop after producing local markdown artifacts and skip Feishu API calls.",
    )
    parser.add_argument(
        "--translate",
        action="store_true",
        help="Translate the linearized markdown into a bilingual version before Feishu import.",
    )
    return parser.parse_args()


def load_config(config_path):
    if not config_path:
        return {}
    path = Path(config_path).resolve()
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise FeishuApiError("config 文件必须是 JSON 对象")
    payload["_config_dir"] = str(path.parent)
    return payload


def coalesce(cli_value, config_value, default=None):
    if cli_value not in (None, ""):
        return cli_value
    if config_value not in (None, ""):
        return config_value
    return default


def resolve_path(value, base_dir):
    if not value:
        return None
    path = Path(value)
    if path.is_absolute():
        return path.resolve()
    return (Path(base_dir) / path).resolve()


def build_runtime_settings(args):
    config = load_config(args.config)
    config_dir = config.get("_config_dir", os.getcwd())

    content_list_json = resolve_path(coalesce(args.content_list_json, config.get("content_list_json")), config_dir)
    if not content_list_json or not content_list_json.exists():
        raise FeishuApiError("缺少有效的 content_list.json 路径")

    linearized_output = resolve_path(args.linearized_output or config.get("linearized_output"), config_dir)
    if not linearized_output:
        linearized_output = content_list_json.with_name(content_list_json.stem.replace("_content_list", "") + "_linearized.md")

    prepared_output = resolve_path(args.prepared_output or config.get("prepared_output"), config_dir)
    if not prepared_output:
        prepared_output = linearized_output.with_name(linearized_output.stem + "_feishu_docx_ready.md")

    replacements_file = resolve_path(args.replacements_file or config.get("replacements_file"), config_dir)

    settings = {
        "content_list_json": content_list_json,
        "linearized_output": linearized_output,
        "prepared_output": prepared_output,
        "title": coalesce(args.title, config.get("title"), linearized_output.stem),
        "folder_token": coalesce(args.folder_token, config.get("folder_token"), ""),
        "app_id": coalesce(args.app_id, config.get("app_id"), ""),
        "app_secret": coalesce(args.app_secret, config.get("app_secret"), ""),
        "image_mode": coalesce(args.image_mode, config.get("image_mode"), "note"),
        "replacements_file": replacements_file,
        "replacement_block_limit": coalesce(args.replacement_block_limit, config.get("replacement_block_limit"), 40),
        "prepare_only": args.prepare_only or bool(config.get("prepare_only", False)),
        "translate": args.translate or bool(config.get("translate", False)),
    }
    return settings


def linearize_content_list_file(input_path, output_path):
    items = json.loads(input_path.read_text(encoding="utf-8"))
    markdown = linearize_content_list(items)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(markdown, encoding="utf-8")
    return markdown


def prepare_markdown_file(linearized_output, prepared_output, image_mode):
    prepared_markdown, local_images = prepare_markdown(linearized_output, image_mode)
    
    # Add the cark reading template before the paper body.
    title = linearized_output.stem.replace("_linearized", "").replace("_bilingual", "")
    
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

    prepared_output.parent.mkdir(parents=True, exist_ok=True)
    prepared_output.write_text(template, encoding="utf-8")
    return template, local_images


def publish_native_docx(settings, prepared_markdown):
    access_token = get_tenant_access_token(settings["app_id"], settings["app_secret"])
    document_id, create_payload = create_document(
        access_token=access_token,
        folder_token=settings["folder_token"],
        title=settings["title"],
    )
    blocks, first_level_ids = convert_markdown_to_blocks(access_token, prepared_markdown)
    create_blocks_payload = create_nested_blocks(access_token, document_id, first_level_ids, blocks)
    image_results = patch_images(access_token, document_id, settings["prepared_output"])

    text_replacements_applied = []
    if settings["replacements_file"]:
        replacement_rules = load_replacements(settings["replacements_file"])
        if replacement_rules:
            text_replacements_applied = apply_text_replacements(
                access_token,
                document_id,
                replacement_rules,
                block_limit=settings["replacement_block_limit"],
            )

    return {
        "document_url": f"https://jcnzgldxlxqe.feishu.cn/docx/{document_id}",
        "document_token": document_id,
        "patched_images": image_results,
        "text_replacements_applied": text_replacements_applied,
        "create_document_result": create_payload.get("data", {}),
        "create_blocks_result": create_blocks_payload,
    }


def main():
    args = parse_args()
    settings = build_runtime_settings(args)

    linearize_content_list_file(settings["content_list_json"], settings["linearized_output"])
    
    input_for_feishu = settings["linearized_output"]
    
    if settings["translate"]:
        from translate_content import translate_file
        bilingual_output = settings["linearized_output"].with_name(settings["linearized_output"].stem + "_bilingual.md")
        translate_file(settings["linearized_output"], bilingual_output)
        input_for_feishu = bilingual_output

    prepared_markdown, local_images = prepare_markdown_file(
        input_for_feishu,
        settings["prepared_output"],
        settings["image_mode"],
    )

    output = {
        "content_list_json": str(settings["content_list_json"]),
        "linearized_markdown": str(settings["linearized_output"]),
        "prepared_markdown": str(settings["prepared_output"]),
        "image_mode": settings["image_mode"],
        "local_images_rewritten": local_images,
    }

    if not settings["prepare_only"]:
        output.update(publish_native_docx(settings, prepared_markdown))

    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except FeishuApiError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
