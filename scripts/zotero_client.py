import os
import re
from pathlib import Path
from urllib.parse import unquote, urlparse
from urllib.request import url2pathname

import requests


DEFAULT_ZOTERO_API_URL = "http://127.0.0.1:23119/api"
ZOTERO_ITEM_KEY_RE = re.compile(r"^[A-Z0-9]{8}$", re.IGNORECASE)


class ZoteroUnavailableError(RuntimeError):
    pass


class ZoteroApiDisabledError(RuntimeError):
    pass


class ZoteroClient:
    def __init__(self, base_url: str | None = None, timeout: float = 4):
        self.base_url = (
            base_url
            or os.environ.get("CARK_ZOTERO_API_URL")
            or DEFAULT_ZOTERO_API_URL
        ).rstrip("/")
        self.timeout = timeout

    def _request(self, path: str, *, params: dict[str, object] | None = None):
        session = requests.Session()
        session.trust_env = False
        try:
            response = session.get(
                f"{self.base_url}/{path.lstrip('/')}",
                params=params,
                headers={
                    "Accept": "application/json",
                    "Zotero-API-Version": "3",
                },
                timeout=self.timeout,
            )
        except (requests.ConnectionError, requests.Timeout) as error:
            raise ZoteroUnavailableError(
                "未检测到 Zotero。请先启动 Zotero 后重试。"
            ) from error
        finally:
            session.close()

        if response.status_code == 403:
            raise ZoteroApiDisabledError(
                "Zotero 本地 API 未启用。请在 Zotero 高级设置中允许其他应用访问。"
            )
        if response.status_code >= 400:
            raise RuntimeError(f"Zotero 请求失败：HTTP {response.status_code}")
        return response

    def status(self) -> dict[str, object]:
        response = self._request(
            "users/0/items/top",
            params={"limit": 1, "format": "json", "include": "data"},
        )
        return {
            "available": True,
            "version": response.headers.get("Zotero-Version"),
            "message": "已连接到 Zotero",
        }

    def list_papers(self, query: str = "", limit: int = 20) -> list[dict[str, object]]:
        params: dict[str, object] = {
            "itemType": "-attachment",
            "sort": "dateModified",
            "direction": "desc",
            "limit": max(1, min(int(limit), 50)),
            "format": "json",
            "include": "data",
        }
        if query.strip():
            params["q"] = query.strip()
            params["qmode"] = "titleCreatorYear"

        response = self._request("users/0/items/top", params=params)
        items = response.json()
        if not isinstance(items, list):
            return []

        papers: list[dict[str, object]] = []
        for item in items:
            data = _item_data(item)
            item_key = _item_key(item, data)
            if not item_key:
                continue
            attachment = self._first_pdf_attachment(item_key)
            if attachment is None:
                continue
            papers.append(
                {
                    "itemKey": item_key,
                    "attachmentKey": attachment["key"],
                    "title": str(data.get("title") or "未命名论文").strip(),
                    "creators": _creator_names(data.get("creators")),
                    "year": _extract_year(data.get("date")),
                    "fileName": attachment["fileName"],
                }
            )
        return papers

    def resolve_pdf(self, attachment_key: str) -> tuple[Path, str, str | None]:
        key = normalize_item_key(attachment_key)
        metadata_response = self._request(
            f"users/0/items/{key}",
            params={"format": "json", "include": "data"},
        )
        metadata = metadata_response.json()
        data = _item_data(metadata)
        file_name = str(data.get("filename") or data.get("title") or f"{key}.pdf").strip()
        content_type = str(data.get("contentType") or "").lower()
        if content_type != "application/pdf" and not file_name.lower().endswith(".pdf"):
            raise ValueError("所选 Zotero 附件不是 PDF")

        location_response = self._request(f"users/0/items/{key}/file/view/url")
        file_path = file_url_to_path(location_response.text.strip())
        if not file_path.exists() or not file_path.is_file():
            raise FileNotFoundError("Zotero PDF 文件不存在或当前不可访问")
        if file_path.suffix.lower() != ".pdf":
            raise ValueError("所选 Zotero 附件不是 PDF")

        parent_key = data.get("parentItem")
        return file_path, file_name, str(parent_key) if parent_key else None

    def _first_pdf_attachment(self, item_key: str) -> dict[str, str] | None:
        response = self._request(
            f"users/0/items/{normalize_item_key(item_key)}/children",
            params={
                "itemType": "attachment",
                "limit": 100,
                "format": "json",
                "include": "data",
            },
        )
        children = response.json()
        if not isinstance(children, list):
            return None
        for child in children:
            data = _item_data(child)
            file_name = str(data.get("filename") or data.get("title") or "").strip()
            content_type = str(data.get("contentType") or "").lower()
            if content_type != "application/pdf" and not file_name.lower().endswith(".pdf"):
                continue
            key = _item_key(child, data)
            if key:
                return {
                    "key": key,
                    "fileName": file_name or f"{key}.pdf",
                }
        return None


def normalize_item_key(value: str) -> str:
    key = str(value or "").strip().upper()
    if not ZOTERO_ITEM_KEY_RE.fullmatch(key):
        raise ValueError("Zotero 附件标识无效")
    return key


def file_url_to_path(value: str) -> Path:
    parsed = urlparse(value)
    if parsed.scheme.lower() != "file":
        raise ValueError("Zotero 未返回本地 PDF 路径")
    decoded_path = url2pathname(unquote(parsed.path))
    if os.name == "nt" and re.match(r"^/[A-Za-z]:", decoded_path):
        decoded_path = decoded_path[1:]
    if parsed.netloc:
        decoded_path = f"//{parsed.netloc}{decoded_path}"
    return Path(decoded_path)


def _item_data(item: object) -> dict[str, object]:
    if not isinstance(item, dict):
        return {}
    data = item.get("data")
    return data if isinstance(data, dict) else item


def _item_key(item: object, data: dict[str, object]) -> str | None:
    candidates: list[object] = [data.get("key")]
    if isinstance(item, dict):
        candidates.append(item.get("key"))
    for candidate in candidates:
        try:
            return normalize_item_key(str(candidate or ""))
        except ValueError:
            continue
    return None


def _creator_names(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    names: list[str] = []
    for creator in value:
        if not isinstance(creator, dict):
            continue
        name = str(creator.get("name") or "").strip()
        if not name:
            name = " ".join(
                part
                for part in (
                    str(creator.get("firstName") or "").strip(),
                    str(creator.get("lastName") or "").strip(),
                )
                if part
            )
        if name:
            names.append(name)
        if len(names) >= 3:
            break
    return names


def _extract_year(value: object) -> str | None:
    match = re.search(r"\b(18|19|20|21)\d{2}\b", str(value or ""))
    return match.group(0) if match else None
