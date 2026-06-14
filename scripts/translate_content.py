import argparse
import os
import sys
import json
from pathlib import Path
import requests

def parse_args():
    parser = argparse.ArgumentParser(description="Translate markdown to bilingual format using DeepSeek/OpenAI compatible API.")
    parser.add_argument("input_md", help="Path to input linearized markdown file")
    parser.add_argument("output_md", nargs="?", help="Optional output bilingual markdown path")
    return parser.parse_args()

def split_into_chunks(markdown_text, max_chunk_length=1500):
    """Splits markdown into logical chunks to avoid LLM context limits."""
    blocks = markdown_text.split('\n\n')
    chunks = []
    current_chunk = []
    current_length = 0
    
    for block in blocks:
        if current_length + len(block) > max_chunk_length and current_chunk:
            chunks.append('\n\n'.join(current_chunk))
            current_chunk = []
            current_length = 0
        
        current_chunk.append(block)
        current_length += len(block)
        
    if current_chunk:
        chunks.append('\n\n'.join(current_chunk))
        
    return chunks

def translate_chunk(chunk, api_key, base_url, model, max_retries=3):
    """Translates a markdown chunk while preserving its structure.

    返回 (translated_text, ok)。ok=False 表示翻译失败、已退回原文。
    失败时按指数退避重试 max_retries 次。
    """
    import time

    if not chunk.strip() or chunk.strip().startswith('![]') or chunk.strip().startswith('|'):
        return chunk, True  # 图片/表格行无需翻译，视为成功

    prompt = f"""
Translate the following academic markdown text from English (or other source language) to Chinese.
Output the translation in a bilingual format: first the original paragraph, then the translated paragraph.
Preserve all Markdown formatting (headings, lists, bold, italics, math formulas, etc.) exactly as they are.
If it is a heading, format it as:
# Original Heading
# Translated Heading

If it is a paragraph, format it as:
Original paragraph

Translated paragraph

Here is the text to translate:

{chunk}
"""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a professional academic translator. Preserve all markdown formatting and LaTeX formulas."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.3
    }

    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            response = requests.post(f"{base_url.rstrip('/')}/chat/completions", headers=headers, json=payload, timeout=120)
            response.raise_for_status()
            result = response.json()
            return result["choices"][0]["message"]["content"].strip(), True
        except Exception as e:
            last_error = e
            if attempt < max_retries:
                backoff = 2 ** (attempt - 1)  # 1s, 2s, 4s...
                print(
                    f"Warning: chunk 翻译失败(第{attempt}/{max_retries}次), {backoff}s 后重试. Error: {e}",
                    file=sys.stderr,
                )
                time.sleep(backoff)
    print(f"Error: chunk 翻译重试 {max_retries} 次仍失败, 退回原文. Error: {last_error}", file=sys.stderr)
    return chunk, False

def translate_file(input_path, output_path=None):
    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.deepseek.com/v1")
    model = os.getenv("OPENAI_MODEL", "deepseek-chat").strip()

    if not api_key:
        raise ValueError("OPENAI_API_KEY environment variable is not set.")
    if not model:
        raise ValueError("OPENAI_MODEL environment variable is not set.")

    # 失败 chunk 占比超过此阈值则整体报错（避免产出"半翻译"文档却以为成功）。
    try:
        fail_ratio_limit = float(os.getenv("TRANSLATE_FAIL_RATIO_LIMIT", "0.2"))
    except ValueError:
        fail_ratio_limit = 0.2

    markdown_text = input_path.read_text(encoding="utf-8")
    chunks = split_into_chunks(markdown_text)

    translated_chunks = []
    failed_indices = []
    print(f"Translating {input_path.name} ({len(chunks)} chunks)...")
    for i, chunk in enumerate(chunks):
        print(f"  Translating chunk {i+1}/{len(chunks)}...")
        translated_chunk, ok = translate_chunk(chunk, api_key, base_url, model)
        translated_chunks.append(translated_chunk)
        if not ok:
            failed_indices.append(i + 1)

    bilingual_markdown = '\n\n'.join(translated_chunks)

    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(bilingual_markdown, encoding="utf-8")

    # 结尾如实汇总失败情况。
    if failed_indices:
        ratio = len(failed_indices) / max(1, len(chunks))
        msg = (
            f"翻译完成，但有 {len(failed_indices)}/{len(chunks)} 个 chunk 失败"
            f"（已退回原文）: chunk {failed_indices}"
        )
        print(f"WARNING: {msg}", file=sys.stderr)
        if ratio > fail_ratio_limit:
            raise RuntimeError(
                f"翻译失败比例 {ratio:.0%} 超过阈值 {fail_ratio_limit:.0%}，"
                f"判定翻译不可靠。{msg}。可检查网络/API额度后重试。"
            )
    else:
        print(f"翻译全部成功（{len(chunks)} chunks）。")

    return bilingual_markdown

def main():
    args = parse_args()
    input_path = Path(args.input_md).resolve()
    
    if not input_path.exists():
        print(f"Error: File not found: {input_path}", file=sys.stderr)
        sys.exit(1)
        
    output_path = Path(args.output_md).resolve() if args.output_md else input_path.with_name(input_path.stem + "_bilingual.md")
    
    try:
        translate_file(input_path, output_path)
        print(f"Translation complete. Output saved to: {output_path}")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
