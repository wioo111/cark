import argparse
import json
import mimetypes
import os
import re
import sys
import time
from pathlib import Path

import requests


OPEN_FEISHU = "https://open.feishu.cn"
PLACEHOLDER_PREFIX = "本地图片占位："
DOC_WRITE_INTERVAL_SECONDS = 0.4


class FeishuApiError(RuntimeError):
    pass


def response_details(response):
    try:
        payload = response.json()
        body = json.dumps(payload, ensure_ascii=False)
    except ValueError:
        body = response.text.strip()
    return f"HTTP {response.status_code} {response.reason}; body={body or '<empty>'}"


def ensure_http_ok(response, action):
    if response.ok:
        return
    raise FeishuApiError(f"{action}失败: {response_details(response)}")


def parse_json_response(response, action):
    ensure_http_ok(response, action)
    try:
        return response.json()
    except ValueError as exc:
        raise FeishuApiError(f"{action}失败: 响应不是合法 JSON: {response_details(response)}") from exc


def require_value(name, value):
    if not value:
        raise FeishuApiError(f"缺少必要参数：{name}")


def parse_args():
    parser = argparse.ArgumentParser(description="Patch images into an imported Feishu docx document.")
    parser.add_argument("markdown_file", help="Prepared markdown file used for the Feishu import")
    parser.add_argument("--document-token", required=True, help="Target Feishu docx token")
    parser.add_argument("--app-id", default=os.getenv("FEISHU_APP_ID", ""), help="Feishu app id")
    parser.add_argument("--app-secret", default=os.getenv("FEISHU_APP_SECRET", ""), help="Feishu app secret")
    parser.add_argument(
        "--replacements-file",
        help="Optional JSON file describing text replacements to apply after import.",
    )
    parser.add_argument(
        "--replacement-block-limit",
        type=int,
        default=40,
        help="Only inspect the first N text-like blocks when applying configured replacements.",
    )
    return parser.parse_args()


def get_tenant_access_token(app_id, app_secret):
    require_value("FEISHU_APP_ID / --app-id", app_id)
    require_value("FEISHU_APP_SECRET / --app-secret", app_secret)

    response = requests.post(
        f"{OPEN_FEISHU}/open-apis/auth/v3/tenant_access_token/internal",
        json={"app_id": app_id, "app_secret": app_secret},
        timeout=30,
    )
    payload = parse_json_response(response, "获取 tenant_access_token")
    if payload.get("code", -1) != 0:
        raise FeishuApiError(f"获取 tenant_access_token 失败: {payload}")
    return payload["tenant_access_token"]


def build_headers(access_token, content_type="application/json; charset=utf-8"):
    return {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": content_type,
    }


def sleep_after_doc_write():
    time.sleep(DOC_WRITE_INTERVAL_SECONDS)


def get_block_payload_key(block):
    for key in (
        "text",
        "heading1",
        "heading2",
        "heading3",
        "heading4",
        "heading5",
        "heading6",
        "heading7",
        "heading8",
        "heading9",
        "quote",
    ):
        if key in block:
            return key
    return ""


def get_block_elements(block):
    payload_key = get_block_payload_key(block)
    if not payload_key:
        return []
    return block.get(payload_key, {}).get("elements", [])


def block_plain_text(block):
    parts = []
    for element in get_block_elements(block):
        text_run = element.get("text_run")
        if text_run:
            parts.append(text_run.get("content", ""))
    return "".join(parts)


def make_text_elements(text):
    return [{"text_run": {"content": text}}]


def fetch_all_blocks(access_token, document_token):
    items = []
    page_token = ""
    while True:
        params = {"page_size": 500}
        if page_token:
            params["page_token"] = page_token
        response = requests.get(
            f"{OPEN_FEISHU}/open-apis/docx/v1/documents/{document_token}/blocks",
            headers=build_headers(access_token),
            params=params,
            timeout=30,
        )
        payload = parse_json_response(response, "获取文档 blocks")
        if payload.get("code", -1) != 0:
            raise FeishuApiError(f"获取文档 blocks 失败: {payload}")
        data = payload.get("data", {})
        items.extend(data.get("items", []))
        if not data.get("has_more"):
            break
        page_token = data.get("page_token", "")
        if not page_token:
            break
    return items


def create_image_block(access_token, document_token, parent_id, index):
    response = requests.post(
        f"{OPEN_FEISHU}/open-apis/docx/v1/documents/{document_token}/blocks/{parent_id}/children",
        headers=build_headers(access_token),
        params={"document_revision_id": -1},
        json={
            "index": index,
            "children": [
                {
                    "block_type": 27,
                    "image": {},
                }
            ],
        },
        timeout=30,
    )
    payload = parse_json_response(response, "创建图片块")
    if payload.get("code", -1) != 0:
        raise FeishuApiError(f"创建图片块失败: {payload}")
    children = payload.get("data", {}).get("children", [])
    if not children:
        raise FeishuApiError(f"创建图片块成功但未返回 block_id: {payload}")
    sleep_after_doc_write()
    return children[0]["block_id"]


def upload_image_media(access_token, image_path, image_block_id, max_retries=4):
    """上传图片素材到飞书。

    对飞书服务端临时错误(5xx)/网络错误按指数退避重试，避免单张图的 502
    导致整个发布流程崩溃。
    """
    import time

    file_size = image_path.stat().st_size
    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            with image_path.open("rb") as fh:
                files = {
                    "file": (
                        image_path.name,
                        fh,
                        mimetypes.guess_type(image_path.name)[0] or "image/jpeg",
                    )
                }
                data = {
                    "file_name": image_path.name,
                    "parent_type": "docx_image",
                    "parent_node": image_block_id,
                    "size": str(file_size),
                }
                response = requests.post(
                    f"{OPEN_FEISHU}/open-apis/drive/v1/medias/upload_all",
                    headers={"Authorization": f"Bearer {access_token}"},
                    data=data,
                    files=files,
                    timeout=120,
                )
            # 5xx 视为可重试的临时错误。
            if response.status_code >= 500:
                raise FeishuApiError(
                    f"上传图片素材临时失败: HTTP {response.status_code}"
                )
            payload = parse_json_response(response, "上传图片素材")
            if payload.get("code", -1) != 0:
                raise FeishuApiError(f"上传图片素材失败: {payload}")
            token = payload.get("data", {}).get("file_token")
            if not token:
                raise FeishuApiError(f"上传图片素材成功但未返回 file_token: {payload}")
            return token
        except (FeishuApiError, requests.RequestException) as exc:
            last_error = exc
            if attempt < max_retries:
                backoff = min(2 ** (attempt - 1), 8)  # 1,2,4,8s
                print(
                    f"  图片上传失败(第{attempt}/{max_retries}次, {image_path.name}), "
                    f"{backoff}s 后重试: {exc}",
                    file=sys.stderr,
                )
                time.sleep(backoff)
    raise FeishuApiError(f"上传图片素材重试 {max_retries} 次仍失败 ({image_path.name}): {last_error}")


def replace_image(access_token, document_token, image_block_id, media_token):
    response = requests.patch(
        f"{OPEN_FEISHU}/open-apis/docx/v1/documents/{document_token}/blocks/{image_block_id}",
        headers=build_headers(access_token),
        json={"replace_image": {"token": media_token}},
        timeout=30,
    )
    payload = parse_json_response(response, "绑定图片素材到图片块")
    if payload.get("code", -1) != 0:
        raise FeishuApiError(f"绑定图片素材到图片块失败: {payload}")
    sleep_after_doc_write()


def update_block_text(access_token, document_token, block_id, text):
    response = requests.patch(
        f"{OPEN_FEISHU}/open-apis/docx/v1/documents/{document_token}/blocks/{block_id}",
        headers=build_headers(access_token),
        json={"update_text_elements": {"elements": make_text_elements(text)}},
        timeout=30,
    )
    payload = parse_json_response(response, "更新文本块")
    if payload.get("code", -1) != 0:
        raise FeishuApiError(f"更新文本块失败: {payload}")
    sleep_after_doc_write()


def load_replacements(path):
    if not path:
        return []
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise FeishuApiError("replacements-file 必须是 JSON 数组")

    replacements = []
    for index, item in enumerate(payload):
        if not isinstance(item, dict):
            raise FeishuApiError(f"replacements-file 第 {index + 1} 项必须是对象")
        match_type = item.get("match", "exact")
        source = item.get("from", "")
        target = item.get("to", "")
        if match_type not in {"exact", "contains", "regex"}:
            raise FeishuApiError(f"replacements-file 第 {index + 1} 项 match 非法: {match_type}")
        if not source:
            raise FeishuApiError(f"replacements-file 第 {index + 1} 项缺少 from")
        if not isinstance(target, str):
            raise FeishuApiError(f"replacements-file 第 {index + 1} 项 to 必须是字符串")
        replacements.append({"match": match_type, "from": source, "to": target})
    return replacements


def replacement_matches(rule, text):
    source = rule["from"]
    match_type = rule["match"]
    if match_type == "exact":
        return text == source
    if match_type == "contains":
        return source in text
    return re.search(source, text) is not None


def apply_text_replacements(access_token, document_token, replacements, block_limit=None):
    blocks = fetch_all_blocks(access_token, document_token)
    updates = []
    scanned = 0

    for block in blocks:
        text = block_plain_text(block).strip()
        if not text:
            continue

        scanned += 1
        for rule in replacements:
            if replacement_matches(rule, text):
                if text != rule["to"]:
                    update_block_text(access_token, document_token, block["block_id"], rule["to"])
                    updates.append(
                        {
                            "block_id": block["block_id"],
                            "before": text,
                            "after": rule["to"],
                            "match": rule["match"],
                        }
                    )
                break

        if block_limit and scanned >= block_limit:
            break

    return updates


def delete_child_range(access_token, document_token, parent_id, start_index, end_index):
    response = requests.delete(
        f"{OPEN_FEISHU}/open-apis/docx/v1/documents/{document_token}/blocks/{parent_id}/children/batch_delete",
        headers=build_headers(access_token),
        params={"document_revision_id": -1},
        json={"start_index": start_index, "end_index": end_index},
        timeout=30,
    )
    payload = parse_json_response(response, "删除占位块")
    if payload.get("code", -1) != 0:
        raise FeishuApiError(f"删除占位块失败: {payload}")
    sleep_after_doc_write()


def detect_placeholder(block):
    text = block_plain_text(block)
    if PLACEHOLDER_PREFIX not in text:
        return None

    rel_path = ""
    for element in get_block_elements(block):
        text_run = element.get("text_run")
        if not text_run:
            continue
        content = text_run.get("content", "").strip()
        style = text_run.get("text_element_style", {})
        if style.get("inline_code") and content.startswith("images/"):
            rel_path = content
            break

    if not rel_path:
        match = re.search(r"(images/[^\s)]+)", text)
        if match:
            rel_path = match.group(1)

    caption = ""
    if "\n" in text:
        caption = text.split("\n", 1)[1].strip()

    if not rel_path:
        return None

    return {
        "rel_path": rel_path,
        "caption": caption,
        "raw_text": text,
    }


def patch_images(access_token, document_token, markdown_path):
    blocks = fetch_all_blocks(access_token, document_token)
    by_id = {block["block_id"]: block for block in blocks}
    results = []

    for block in blocks:
        placeholder = detect_placeholder(block)
        if not placeholder:
            continue

        parent_id = block.get("parent_id")
        parent = by_id.get(parent_id)
        if not parent:
            raise FeishuApiError(f"无法找到占位块的父块: {block['block_id']}")

        children = parent.get("children", [])
        if block["block_id"] not in children:
            raise FeishuApiError(f"无法在父块 children 中定位占位块: {block['block_id']}")

        image_path = (markdown_path.parent / placeholder["rel_path"]).resolve()
        if not image_path.exists():
            raise FeishuApiError(f"图片文件不存在: {image_path}")

        insert_index = children.index(block["block_id"])
        image_block_id = create_image_block(
            access_token=access_token,
            document_token=document_token,
            parent_id=parent_id,
            index=insert_index,
        )
        media_token = upload_image_media(access_token, image_path, image_block_id)
        replace_image(access_token, document_token, image_block_id, media_token)

        if placeholder["caption"]:
            update_block_text(access_token, document_token, block["block_id"], placeholder["caption"])
        else:
            next_text = ""
            if insert_index + 1 < len(children):
                next_block = by_id.get(children[insert_index + 1])
                if next_block:
                    next_text = block_plain_text(next_block).strip()
            if next_text.startswith("图 "):
                delete_child_range(access_token, document_token, parent_id, insert_index + 1, insert_index + 2)

        results.append(
            {
                "placeholder_block_id": block["block_id"],
                "image_block_id": image_block_id,
                "image_path": str(image_path),
                "caption": placeholder["caption"],
            }
        )

    return results


def main():
    args = parse_args()
    markdown_path = Path(args.markdown_file).resolve()
    if not markdown_path.exists():
        raise FeishuApiError(f"Markdown 文件不存在: {markdown_path}")

    access_token = get_tenant_access_token(args.app_id, args.app_secret)
    image_results = patch_images(access_token, args.document_token, markdown_path)
    replacement_rules = load_replacements(args.replacements_file)
    text_replacements_applied = []
    if replacement_rules:
        text_replacements_applied = apply_text_replacements(
            access_token,
            args.document_token,
            replacement_rules,
            block_limit=args.replacement_block_limit,
        )

    output = {
        "document_token": args.document_token,
        "markdown_file": str(markdown_path),
        "patched_images": image_results,
        "text_replacements_applied": text_replacements_applied,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except FeishuApiError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
