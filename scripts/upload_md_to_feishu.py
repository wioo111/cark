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
IMAGE_RE = re.compile(r"!\[(?P<alt>[^\]]*)\]\((?P<path>[^)]+)\)")


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


def parse_args():
    parser = argparse.ArgumentParser(description="Import a Markdown file into Feishu Docs.")
    parser.add_argument("markdown_file", help="Path to the markdown file to upload")
    parser.add_argument("--title", help="Optional title for the imported document")
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
        "--image-mode",
        choices=["strip", "note", "keep"],
        default="note",
        help="How to handle local image references before import.",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=2.0,
        help="Polling interval in seconds when waiting for import completion.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=300,
        help="Maximum wait time for import completion, in seconds.",
    )
    parser.add_argument(
        "--prepared-output",
        help="Optional path to write the prepared markdown file.",
    )
    parser.add_argument(
        "--prepare-only",
        action="store_true",
        help="Only prepare a Feishu-friendly markdown file and skip API calls.",
    )
    parser.add_argument(
        "--keep-uploaded-file",
        action="store_true",
        help="Keep the temporary uploaded source file in Feishu after import completes.",
    )
    return parser.parse_args()


def require_value(name, value):
    if not value:
        raise FeishuApiError(f"缺少必要参数：{name}")


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


def prepare_markdown(markdown_path, image_mode):
    text = markdown_path.read_text(encoding="utf-8")
    local_images = []

    def replace(match):
        alt = match.group("alt").strip()
        raw_path = match.group("path").strip()
        if raw_path.startswith(("http://", "https://")):
            return match.group(0)

        local_images.append(raw_path)
        label = alt or Path(raw_path).name
        if image_mode == "keep":
            return match.group(0)
        if image_mode == "strip":
            return ""
        # Keep a blank line after the note so the following caption stays
        # outside the quote block when Markdown is imported into Feishu.
        return f"> 本地图片占位：{label} (`{raw_path}`)\n"

    prepared = IMAGE_RE.sub(replace, text)
    prepared = re.sub(r"\n{3,}", "\n\n", prepared).strip() + "\n"
    return prepared, sorted(set(local_images))


def upload_file(access_token, file_path, folder_token):
    file_size = file_path.stat().st_size
    with file_path.open("rb") as fh:
        files = {
            "file": (
                file_path.name,
                fh,
                mimetypes.guess_type(file_path.name)[0] or "text/markdown",
            )
        }
        data = {
            "file_name": file_path.name,
            "parent_type": "explorer",
            "parent_node": folder_token,
            "size": str(file_size),
        }
        response = requests.post(
            f"{OPEN_FEISHU}/open-apis/drive/v1/files/upload_all",
            headers={"Authorization": f"Bearer {access_token}"},
            data=data,
            files=files,
            timeout=120,
        )
    payload = parse_json_response(response, "上传 Markdown 文件")
    if payload.get("code", -1) != 0:
        raise FeishuApiError(f"上传 Markdown 文件失败: {payload}")

    data = payload.get("data", {})
    file_token = data.get("file_token") or data.get("token")
    if not file_token:
        raise FeishuApiError(f"上传成功但未返回 file_token: {payload}")
    return file_token


def create_import_task(access_token, file_token, file_extension, title, folder_token):
    body = {
        "file_extension": file_extension,
        "file_token": file_token,
        "type": "docx",
        "point": {
            "mount_type": 1,
            "mount_key": folder_token,
        },
    }
    if title:
        body["file_name"] = title

    response = requests.post(
        f"{OPEN_FEISHU}/open-apis/drive/v1/import_tasks",
        headers=build_headers(access_token),
        json=body,
        timeout=30,
    )
    payload = parse_json_response(response, "创建导入任务")
    if payload.get("code", -1) != 0:
        raise FeishuApiError(f"创建导入任务失败: {payload}")

    ticket = payload.get("data", {}).get("ticket")
    if not ticket:
        raise FeishuApiError(f"导入任务未返回 ticket: {payload}")
    return ticket


def delete_file(access_token, file_token, file_type):
    response = requests.delete(
        f"{OPEN_FEISHU}/open-apis/drive/v1/files/{file_token}",
        headers={"Authorization": f"Bearer {access_token}"},
        params={"type": file_type},
        timeout=30,
    )
    payload = parse_json_response(response, "删除上传源文件")
    if payload.get("code", -1) != 0:
        raise FeishuApiError(f"删除上传源文件失败: {payload}")


def poll_import_task(access_token, ticket, poll_interval, timeout_seconds):
    deadline = time.time() + timeout_seconds
    last_payload = None
    while time.time() < deadline:
        response = requests.get(
            f"{OPEN_FEISHU}/open-apis/drive/v1/import_tasks/{ticket}",
            headers=build_headers(access_token),
            timeout=30,
        )
        payload = parse_json_response(response, "查询导入任务")
        last_payload = payload
        if payload.get("code", -1) != 0:
            raise FeishuApiError(f"查询导入任务失败: {payload}")

        data = payload.get("data", {})
        if is_import_done(data):
            return data
        time.sleep(poll_interval)

    raise FeishuApiError(f"导入任务超时，最后一次返回: {last_payload}")


def is_import_done(data):
    text = json.dumps(data, ensure_ascii=False).lower()
    if any(key in text for key in ["failed", "success", "completed", "finish"]):
        if "failed" in text:
            raise FeishuApiError(f"导入任务失败: {data}")
        if any(key in text for key in ["success", "completed", "finish"]):
            return True
    return bool(extract_document_url(data) or extract_document_token(data))


def extract_document_url(data):
    if isinstance(data, dict):
        for key, value in data.items():
            if isinstance(value, str) and value.startswith("http"):
                return value
            if isinstance(value, dict):
                found = extract_document_url(value)
                if found:
                    return found
            if isinstance(value, list):
                for item in value:
                    found = extract_document_url(item)
                    if found:
                        return found
    elif isinstance(data, list):
        for item in data:
            found = extract_document_url(item)
            if found:
                return found
    return ""


def extract_document_token(data):
    if isinstance(data, dict):
        for key, value in data.items():
            lowered = key.lower()
            if lowered in {"token", "document_token", "document_id", "obj_token"} and isinstance(value, str):
                return value
            if isinstance(value, dict):
                found = extract_document_token(value)
                if found:
                    return found
            if isinstance(value, list):
                for item in value:
                    found = extract_document_token(item)
                    if found:
                        return found
    elif isinstance(data, list):
        for item in data:
            found = extract_document_token(item)
            if found:
                return found
    return ""


def main():
    args = parse_args()
    markdown_path = Path(args.markdown_file).resolve()
    if not markdown_path.exists():
        raise FeishuApiError(f"Markdown 文件不存在: {markdown_path}")

    prepared_markdown, local_images = prepare_markdown(markdown_path, args.image_mode)

    prepared_path = (
        Path(args.prepared_output).resolve()
        if args.prepared_output
        else markdown_path.with_name(markdown_path.stem + "_feishu_ready.md")
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

    extension = prepared_path.suffix.lstrip(".")
    if not extension:
        extension = "md"

    access_token = get_tenant_access_token(args.app_id, args.app_secret)
    file_token = upload_file(access_token, prepared_path, args.folder_token)
    ticket = create_import_task(
        access_token=access_token,
        file_token=file_token,
        file_extension=extension,
        title=args.title or markdown_path.stem,
        folder_token=args.folder_token,
    )
    result = poll_import_task(
        access_token=access_token,
        ticket=ticket,
        poll_interval=args.poll_interval,
        timeout_seconds=args.timeout,
    )

    cleanup_error = ""
    uploaded_source_deleted = False
    if not args.keep_uploaded_file:
        try:
            delete_file(access_token, file_token, "file")
            uploaded_source_deleted = True
        except FeishuApiError as exc:
            cleanup_error = str(exc)

    output = {
        "prepared_markdown": str(prepared_path),
        "ticket": ticket,
        "document_url": extract_document_url(result),
        "document_token": extract_document_token(result),
        "local_images_rewritten": local_images,
        "uploaded_source_deleted": uploaded_source_deleted,
        "cleanup_error": cleanup_error,
        "result": result,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except FeishuApiError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
