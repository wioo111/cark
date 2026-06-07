"""MinerU 云 API 后端：把 PDF 上传到 MinerU 官方在线服务解析，下载结果。

这是 paper2lark 的**云端解析后端**，与本地 mineru.exe 后端并列。它彻底避免在本机
部署 14GB 模型和 GPU，代价是论文需上传到 MinerU 服务器（上海 OSS）、需联网、受
每账号每日 2000 页额度与单文件 ≤200MB/600 页限制。

产物结构与本地解析高度兼容：返回的 zip 内含标准 ``*_content_list.json`` + ``images/``，
字段（image 的 img_path/image_caption、table 的 table_body、文本内嵌的 ``$...$`` 公式
LaTeX）与本地一致，因此下游线性化/翻译/飞书链路可直接复用。

API 流程（异步：提交 → 轮询 → 下载）：
  1. POST /api/v4/file-urls/batch       申请上传 URL（拿 batch_id + 预签名 URL）
  2. PUT  <预签名 URL>                   上传 PDF 本体（不带 Authorization header）
  3. GET  /api/v4/extract-results/batch/{batch_id}   轮询，done 后拿 full_zip_url
  4. GET  <full_zip_url>                 下载 zip 并解压

Token 从参数或环境变量 ``MINERU_API_TOKEN`` 读取，全程不打印 token。
"""

from __future__ import annotations

import os
import time
import zipfile
from pathlib import Path

import requests

from upload_md_to_feishu import FeishuApiError

API_BASE = "https://mineru.net/api/v4"

# 这些限制来自 MinerU 官方文档（Precision Extract API），仅用于本地预检并给出友好报错，
# 真正的判定仍以服务端为准。
MAX_FILE_BYTES = 200 * 1024 * 1024  # 200MB


def _request_with_retry(method, url, *, max_retries=4, **kwargs):
    """对网络错误/5xx 指数退避重试（沿用 patch_feishu_doc_images 的退避风格）。

    仅在传输层错误或服务端 5xx 时重试；4xx（鉴权/参数错误）立即抛出，重试无意义。
    """
    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.request(method, url, **kwargs)
            if resp.status_code >= 500:
                last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
            else:
                return resp
        except requests.RequestException as exc:
            last_error = str(exc)
        if attempt < max_retries:
            backoff = min(2 ** (attempt - 1), 8)  # 1,2,4,8s
            time.sleep(backoff)
    raise FeishuApiError(f"云 API 请求重试 {max_retries} 次仍失败 ({method} {url}): {last_error}")


def _resolve_token(token):
    token = token or os.getenv("MINERU_API_TOKEN", "")
    token = token.strip()
    if not token:
        raise FeishuApiError(
            "云后端需要 MinerU API token。请设环境变量 MINERU_API_TOKEN，"
            "或用 --api-token 传入（token 在 https://mineru.net 申请）。"
        )
    return token


def _apply_upload_url(pdf_path, token, *, model_version, is_ocr, enable_formula,
                      enable_table, language):
    """申请上传 URL，返回 (batch_id, upload_url)。"""
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "*/*",
    }
    payload = {
        "files": [{"name": pdf_path.name, "is_ocr": is_ocr, "data_id": pdf_path.stem[:120]}],
        "model_version": model_version,
        "enable_formula": enable_formula,
        "enable_table": enable_table,
        "language": language,
    }
    resp = _request_with_retry("POST", f"{API_BASE}/file-urls/batch",
                               headers=headers, json=payload, timeout=30)
    if resp.status_code != 200:
        raise FeishuApiError(f"申请上传 URL 失败 (HTTP {resp.status_code}): {resp.text[:300]}")
    body = resp.json()
    if body.get("code") != 0:
        raise FeishuApiError(f"申请上传 URL 失败: code={body.get('code')} msg={body.get('msg')}")
    data = body["data"]
    urls = data.get("file_urls") or []
    if not urls:
        raise FeishuApiError(f"申请上传 URL 未返回 file_urls: {body}")
    return data["batch_id"], urls[0]


def _upload_file(pdf_path, upload_url):
    """PUT 上传文件本体到 OSS 预签名 URL。注意：不能带 Authorization header。"""
    with pdf_path.open("rb") as fh:
        resp = _request_with_retry("PUT", upload_url, data=fh, timeout=600)
    if resp.status_code != 200:
        raise FeishuApiError(f"上传文件失败 (HTTP {resp.status_code}): {resp.text[:300]}")


def _poll_until_done(batch_id, token, *, timeout, on_progress=None):
    """轮询 batch 结果，done 后返回 full_zip_url。失败/超时抛错。"""
    headers = {"Authorization": f"Bearer {token}", "Accept": "*/*"}
    result_url = f"{API_BASE}/extract-results/batch/{batch_id}"
    deadline = time.time() + timeout
    last_state = None
    while time.time() < deadline:
        resp = _request_with_retry("GET", result_url, headers=headers, timeout=30)
        if resp.status_code != 200:
            time.sleep(5)
            continue
        body = resp.json()
        if body.get("code") != 0:
            time.sleep(5)
            continue
        results = body.get("data", {}).get("extract_result") or []
        if results:
            item = results[0]
            state = item.get("state")
            if state != last_state:
                if on_progress:
                    on_progress(state, item.get("extract_progress") or {})
                last_state = state
            if state == "done":
                full_zip = item.get("full_zip_url")
                if not full_zip:
                    raise FeishuApiError(f"任务完成但缺少 full_zip_url: {item}")
                return full_zip
            if state == "failed":
                raise FeishuApiError(f"云端解析失败: {item.get('err_msg') or '未知原因'}")
        time.sleep(5)
    raise FeishuApiError(f"云端解析轮询超时（>{timeout}s），batch_id={batch_id}")


def _download_and_extract(full_zip_url, output_dir):
    """下载结果 zip 并解压到 output_dir，返回解压出的 content_list.json 路径。"""
    output_dir.mkdir(parents=True, exist_ok=True)
    resp = _request_with_retry("GET", full_zip_url, timeout=600)
    if resp.status_code != 200:
        raise FeishuApiError(f"下载结果 zip 失败 (HTTP {resp.status_code})")
    zip_path = output_dir / "mineru_cloud_result.zip"
    zip_path.write_bytes(resp.content)
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        zf.extractall(output_dir)

    content_list = next(
        (output_dir / n for n in names if n.endswith("content_list.json") and "_v2" not in n),
        None,
    )
    if content_list is None or not content_list.exists():
        raise FeishuApiError(f"结果 zip 内未找到 content_list.json，文件清单: {names}")
    return content_list


def parse_pdf_via_cloud(pdf_path, output_dir, *, token="", model_version="pipeline",
                        is_ocr=True, enable_formula=True, enable_table=True,
                        language="en", timeout=1800, on_progress=None):
    """用 MinerU 云 API 解析一个 PDF，返回解压目录里的 content_list.json 路径。

    pdf_path     : 待解析 PDF（必须是 ASCII 路径更稳，但云端按文件名上传，非 ASCII 也可）。
    output_dir   : 解压目录（zip 内的 content_list.json / images/ 落在这里）。
    token        : API token；为空则读环境变量 MINERU_API_TOKEN。
    model_version: pipeline（默认，与本地同款）/ vlm（更全，多识别 chart）。
    on_progress  : 可选回调 (state, progress_dict)，用于打印进度。
    """
    pdf_path = Path(pdf_path)
    output_dir = Path(output_dir)
    if not pdf_path.exists():
        raise FeishuApiError(f"PDF 不存在: {pdf_path}")
    try:
        size = pdf_path.stat().st_size
        if size > MAX_FILE_BYTES:
            raise FeishuApiError(
                f"PDF 大小 {size // (1024*1024)}MB 超过云 API 上限 200MB，请改用本地后端。"
            )
    except OSError:
        pass

    token = _resolve_token(token)

    batch_id, upload_url = _apply_upload_url(
        pdf_path, token, model_version=model_version, is_ocr=is_ocr,
        enable_formula=enable_formula, enable_table=enable_table, language=language,
    )
    _upload_file(pdf_path, upload_url)
    full_zip_url = _poll_until_done(batch_id, token, timeout=timeout, on_progress=on_progress)
    return _download_and_extract(full_zip_url, output_dir)
