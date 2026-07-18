import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import requests


BLOCK_ID = "block_id"
TRANSLATION = "translation"
FENCE_RE = re.compile(r"^\s*(```|~~~)")
HEADING_RE = re.compile(r"^(\s{0,3}#{1,6}\s+)")
LIST_RE = re.compile(r"^(\s*(?:[-+*]|\d+[.)])\s+)")
QUOTE_RE = re.compile(r"^(\s*>+\s*)")
URL_RE = re.compile(r"https?://[^\s)>]+")
IMAGE_RE = re.compile(r"!\[[^\]]*\]\([^\n)]+\)")
LINK_DESTINATION_RE = re.compile(r"(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
INLINE_CODE_RE = re.compile(r"`+[^`\n]+`+")
HTML_TAG_RE = re.compile(r"</?[A-Za-z][^>]*>")
STRONG_MARKER_RE = re.compile(r"(?<!\\)(?:\*\*|__|~~)")
INLINE_MATH_RE = re.compile(r"(?<!\\)\$\$.*?\$\$|(?<!\\)\$(?!\s).*?(?<!\s)\$", re.DOTALL)
LATEX_MATH_RE = re.compile(r"\\\(.*?\\\)|\\\[.*?\\\]", re.DOTALL)
CJK_RE = re.compile(r"[\u3400-\u9fff]")


class TranslationValidationError(ValueError):
    pass


def parse_args():
    parser = argparse.ArgumentParser(
        description="Translate markdown to bilingual format using an OpenAI-compatible API."
    )
    parser.add_argument("input_md", help="Path to input linearized markdown file")
    parser.add_argument("output_md", nargs="?", help="Optional output bilingual markdown path")
    return parser.parse_args()


def split_into_chunks(markdown_text, max_chunk_length=4000):
    """Split markdown on block boundaries without mixing unrelated block types."""
    del max_chunk_length  # A block is atomic; splitting inside it risks damaging Markdown.
    blocks: list[str] = []
    current: list[str] = []
    fence_marker: str | None = None

    for line in markdown_text.splitlines():
        fence = FENCE_RE.match(line)
        if fence:
            marker = fence.group(1)
            if fence_marker is None:
                fence_marker = marker
            elif marker == fence_marker:
                fence_marker = None

        if not line.strip() and fence_marker is None:
            if current:
                blocks.append("\n".join(current).strip("\n"))
                current = []
            continue
        current.append(line)

    if current:
        blocks.append("\n".join(current).strip("\n"))
    return blocks


def is_translatable_block(block: str) -> bool:
    stripped = block.strip()
    if not stripped:
        return False
    if FENCE_RE.match(stripped):
        return False
    nonempty_lines = [line for line in block.splitlines() if line.strip()]
    if nonempty_lines and all(line.startswith(("    ", "\t")) for line in nonempty_lines):
        return False

    semantic_text = stripped
    for pattern in (IMAGE_RE, INLINE_CODE_RE, INLINE_MATH_RE, LATEX_MATH_RE, URL_RE, HTML_TAG_RE):
        semantic_text = pattern.sub("", semantic_text)
    semantic_text = re.sub(r"[\s#>*_~`|:()\[\]{}-]+", "", semantic_text)
    if not any(char.isalpha() for char in semantic_text):
        return False
    if len(semantic_text) <= 10 and re.fullmatch(r"[A-Z0-9.+/-]+", semantic_text):
        return False
    return True


def _extract_json_object(content: str) -> dict[str, object]:
    candidate = content.strip()
    if candidate.startswith("```"):
        candidate = re.sub(r"^```(?:json)?\s*", "", candidate, count=1, flags=re.IGNORECASE)
        candidate = re.sub(r"\s*```$", "", candidate, count=1)
    try:
        payload = json.loads(candidate)
        if isinstance(payload, dict):
            return payload
    except json.JSONDecodeError:
        pass

    decoder = json.JSONDecoder()
    for index, char in enumerate(candidate):
        if char != "{":
            continue
        try:
            payload, _ = decoder.raw_decode(candidate[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    raise TranslationValidationError("模型未返回有效 JSON 对象")


def _prefixes(pattern: re.Pattern[str], text: str) -> list[str]:
    return [match.group(1) for line in text.splitlines() if (match := pattern.match(line))]


def _protected_tokens(text: str) -> list[str]:
    tokens: list[str] = []
    for pattern in (
        IMAGE_RE,
        LINK_DESTINATION_RE,
        URL_RE,
        INLINE_CODE_RE,
        HTML_TAG_RE,
        INLINE_MATH_RE,
        LATEX_MATH_RE,
    ):
        tokens.extend(pattern.findall(text))
    return tokens


def validate_translation(source: str, translated: str, block_id: str) -> None:
    translated = translated.strip()
    if not translated:
        raise TranslationValidationError(f"{block_id}: 译文为空")
    if translated.strip() == source.strip() and re.search(r"[A-Za-z]{3,}", source):
        raise TranslationValidationError(f"{block_id}: 模型原样返回了原文")
    if re.search(r"\b(?:original|translated)\s+(?:heading|paragraph|text)\b", translated, re.IGNORECASE):
        raise TranslationValidationError(f"{block_id}: 译文包含模型说明标签")
    if re.search(r"[A-Za-z]{3,}", source) and not CJK_RE.search(translated):
        raise TranslationValidationError(f"{block_id}: 未检测到中文译文")

    if _prefixes(HEADING_RE, source) != _prefixes(HEADING_RE, translated):
        raise TranslationValidationError(f"{block_id}: Markdown 标题层级发生变化")
    if _prefixes(LIST_RE, source) != _prefixes(LIST_RE, translated):
        raise TranslationValidationError(f"{block_id}: Markdown 列表结构发生变化")
    if _prefixes(QUOTE_RE, source) != _prefixes(QUOTE_RE, translated):
        raise TranslationValidationError(f"{block_id}: Markdown 引用结构发生变化")
    if STRONG_MARKER_RE.findall(source) != STRONG_MARKER_RE.findall(translated):
        raise TranslationValidationError(f"{block_id}: Markdown 强调结构发生变化")

    source_table = [line.count("|") for line in source.splitlines() if "|" in line]
    translated_table = [line.count("|") for line in translated.splitlines() if "|" in line]
    if source_table != translated_table:
        raise TranslationValidationError(f"{block_id}: Markdown 表格结构发生变化")

    source_tokens = _protected_tokens(source)
    translated_tokens = _protected_tokens(translated)
    if source_tokens != translated_tokens:
        raise TranslationValidationError(f"{block_id}: 公式、链接或图片引用发生变化")

    source_length = max(1, len(source.strip()))
    ratio = len(translated) / source_length
    if ratio < 0.15 or ratio > 5:
        raise TranslationValidationError(f"{block_id}: 译文长度异常（{ratio:.1f}x）")


def _translation_prompt(chunk: str, block_id: str, validation_feedback: str | None) -> str:
    feedback = f"\n上一次输出未通过校验：{validation_feedback}\n请修正。" if validation_feedback else ""
    request = {BLOCK_ID: block_id, "source_markdown": chunk}
    return f"""
把输入中的学术文本翻译成简体中文。只返回一个 JSON 对象，不要返回代码围栏或解释：
{{"block_id":"原样返回输入 ID","translation":"仅中文译文"}}

要求：
1. translation 只放译文，不重复原文；双语排版由程序完成。
2. 保持标题级别、列表标记、表格分隔符及换行结构。
3. 公式、URL、Markdown 图片引用必须逐字不变。
4. 专业术语准确、表达克制，不补充原文没有的信息。{feedback}

输入：
{json.dumps(request, ensure_ascii=False)}
""".strip()


def translate_chunk(chunk, api_key, base_url, model, max_retries=3, block_id="block-0001"):
    """Translate one atomic Markdown block and return bilingual Markdown plus status."""
    if not is_translatable_block(chunk):
        return chunk, True

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    last_error: Exception | None = None
    validation_feedback: str | None = None

    for attempt in range(1, max_retries + 1):
        payload = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": "你是严谨的学术翻译器。必须返回符合要求的 JSON，并严格保持 Markdown 结构。",
                },
                {
                    "role": "user",
                    "content": _translation_prompt(chunk, block_id, validation_feedback),
                },
            ],
            "temperature": 0,
        }
        try:
            response = requests.post(
                f"{base_url.rstrip('/')}/chat/completions",
                headers=headers,
                json=payload,
                timeout=120,
            )
            response.raise_for_status()
            result = response.json()
            content = result["choices"][0]["message"]["content"]
            parsed = _extract_json_object(str(content))
            returned_id = str(parsed.get(BLOCK_ID) or "")
            translated = str(parsed.get(TRANSLATION) or "").strip()
            if returned_id != block_id:
                raise TranslationValidationError(
                    f"块 ID 不匹配：期望 {block_id}，实际 {returned_id or '空'}"
                )
            validate_translation(chunk, translated, block_id)
            return f"{chunk}\n\n{translated}", True
        except Exception as error:
            last_error = error
            validation_feedback = str(error)
            if attempt < max_retries:
                backoff = 2 ** (attempt - 1)
                print(
                    f"Warning: {block_id} 翻译或校验失败(第{attempt}/{max_retries}次), "
                    f"{backoff}s 后重试. Error: {error}",
                    file=sys.stderr,
                )
                time.sleep(backoff)

    print(
        f"Error: {block_id} 重试 {max_retries} 次仍未通过，保留原文. Error: {last_error}",
        file=sys.stderr,
    )
    return chunk, False


def translate_file(input_path, output_path=None):
    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.deepseek.com/v1")
    model = os.getenv("OPENAI_MODEL", "deepseek-chat").strip()

    if not api_key:
        raise ValueError("OPENAI_API_KEY environment variable is not set.")
    if not model:
        raise ValueError("OPENAI_MODEL environment variable is not set.")

    markdown_text = input_path.read_text(encoding="utf-8")
    blocks = split_into_chunks(markdown_text)
    translated_blocks: list[str] = []
    failed_indices: list[int] = []
    translatable_count = sum(1 for block in blocks if is_translatable_block(block))
    print(f"Translating {input_path.name} ({translatable_count} text blocks)...")

    text_index = 0
    for block in blocks:
        if not is_translatable_block(block):
            translated_blocks.append(block)
            continue
        text_index += 1
        block_id = f"block-{text_index:04d}"
        print(f"  Translating {block_id} ({text_index}/{translatable_count})...")
        translated_block, ok = translate_chunk(
            block,
            api_key,
            base_url,
            model,
            block_id=block_id,
        )
        translated_blocks.append(translated_block)
        if not ok:
            failed_indices.append(text_index)

    if failed_indices:
        ratio = len(failed_indices) / max(1, translatable_count)
        msg = (
            f"翻译完成，但有 {len(failed_indices)}/{translatable_count} 个文本块未通过校验"
            f"（已保留原文）: {failed_indices}"
        )
        print(f"WARNING: {msg}", file=sys.stderr)
        raise RuntimeError(
            f"翻译有 {ratio:.0%} 的文本块未通过校验，未发布双语文件。{msg}。"
        )

    bilingual_markdown = "\n\n".join(translated_blocks)
    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_output = output_path.with_name(f".{output_path.name}.tmp")
        temporary_output.write_text(bilingual_markdown, encoding="utf-8")
        temporary_output.replace(output_path)

    print(f"翻译全部通过结构校验（{translatable_count} blocks）。")

    return bilingual_markdown


def main():
    args = parse_args()
    input_path = Path(args.input_md).resolve()
    if not input_path.exists():
        print(f"Error: File not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    output_path = (
        Path(args.output_md).resolve()
        if args.output_md
        else input_path.with_name(input_path.stem + "_bilingual.md")
    )
    try:
        translate_file(input_path, output_path)
        print(f"Translation complete. Output saved to: {output_path}")
    except Exception as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
