from __future__ import annotations

import hashlib
import json
import re
import threading
from pathlib import Path
from typing import Any, Callable

import requests

import gui_agent_memory
import gui_copilot_runs
import gui_memory


def resolve_copilot_agent(settings: dict[str, object], agent_id: str) -> dict[str, object]:
    copilot = settings.get("copilot") if isinstance(settings.get("copilot"), dict) else {}
    agents = copilot.get("agents") if isinstance(copilot.get("agents"), list) else []
    for agent in agents:
        if isinstance(agent, dict) and str(agent.get("id") or "").strip() == agent_id:
            if not bool(agent.get("enabled", True)):
                raise ValueError("这个智能体当前已停用")
            missing_fields = [
                label
                for key, label in (
                    ("apiKey", "API Key"),
                    ("baseUrl", "Base URL"),
                    ("model", "模型"),
                )
                if not str(agent.get(key) or "").strip()
            ]
            if missing_fields:
                raise ValueError(f"智能体配置不完整，请补齐：{'、'.join(missing_fields)}")
            return agent
    raise ValueError("未找到指定智能体")


def resolve_annotation_source_markdown(
    record: Any,
    view: str,
    *,
    load_markdown: Callable[[Path | None], str | None],
) -> str:
    preferred_path = record.files.get("bilingual") if view == "bilingual" and record.files.get("bilingual") else record.files.get("linearized")
    markdown = load_markdown(preferred_path) or ""
    if not markdown.strip():
        fallback = load_markdown(record.files.get("linearized")) or load_markdown(record.files.get("bilingual")) or ""
        markdown = fallback
    if not markdown.strip():
        raise ValueError("当前论文还没有可供共读的正文内容")
    return markdown.strip()


def resolve_annotation_source_path(record: Any, view: str) -> Path | None:
    preferred_path = record.files.get("bilingual") if view == "bilingual" and record.files.get("bilingual") else record.files.get("linearized")
    if preferred_path and preferred_path.exists():
        return preferred_path
    fallback = record.files.get("linearized") or record.files.get("bilingual")
    if fallback and fallback.exists():
        return fallback
    return None


def copilot_context_cache_path(record: Any, memory_root: Path, view: str) -> Path:
    return gui_memory.paper_memory_dir(record, memory_root) / "copilot_cache" / f"{view}_context.json"


def normalize_copilot_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip().lower()


def tokenize_copilot_query(value: str) -> list[str]:
    normalized = normalize_copilot_text(value)
    if not normalized:
        return []
    raw_tokens = re.findall(r"[\u4e00-\u9fff]{2,}|[a-z0-9_/-]{2,}", normalized)
    tokens: list[str] = []
    for token in raw_tokens:
        if token not in tokens:
            tokens.append(token)
    return tokens[:24]


def extract_markdown_paragraphs(markdown: str) -> list[dict[str, str]]:
    paragraphs: list[dict[str, str]] = []
    current_heading = ""
    for raw_block in re.split(r"\n\s*\n+", markdown):
        block = raw_block.strip()
        if not block:
            continue
        if block.startswith("```"):
            continue
        if block.startswith("#"):
            heading = re.sub(r"^#+\s*", "", block).strip()
            if heading:
                current_heading = heading
            continue
        cleaned = re.sub(r"!\[[^\]]*\]\([^)]+\)", " ", block)
        cleaned = re.sub(r"\[[^\]]+\]\([^)]+\)", " ", cleaned)
        cleaned = re.sub(r"[>#*_`~\-]+", " ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        if len(cleaned) < 24:
            continue
        paragraphs.append(
            {
                "heading": current_heading,
                "text": cleaned[:1200],
                "normalized": normalize_copilot_text(cleaned),
            }
        )
    return paragraphs


def build_copilot_context_cache(
    record: Any,
    memory_root: Path,
    view: str,
    *,
    load_markdown: Callable[[Path | None], str | None],
) -> dict[str, object]:
    source_path = resolve_annotation_source_path(record, view)
    markdown = resolve_annotation_source_markdown(record, view, load_markdown=load_markdown)
    stats = source_path.stat() if source_path and source_path.exists() else None
    digest = hashlib.sha256(markdown.encode("utf-8")).hexdigest()
    paragraphs = extract_markdown_paragraphs(markdown)
    headings: list[str] = []
    for paragraph in paragraphs:
        heading = paragraph.get("heading") or ""
        if heading and heading not in headings:
            headings.append(heading)
        if len(headings) >= 10:
            break
    intro_parts = [item["text"] for item in paragraphs[:3]]
    overview_parts: list[str] = [f"论文标题：{record.title}"]
    if headings:
        overview_parts.append("章节结构：" + " / ".join(headings[:8]))
    if intro_parts:
        overview_parts.append("开篇摘要：" + " ".join(intro_parts)[:1200])
    chunks: list[dict[str, object]] = []
    for index, paragraph in enumerate(paragraphs):
        text = paragraph["text"]
        heading = paragraph.get("heading") or ""
        chunks.append(
            {
                "id": f"chunk-{index}",
                "heading": heading,
                "text": text,
                "normalized": paragraph["normalized"],
            }
        )
    cache_payload = {
        "version": 1,
        "paperId": record.paper_id,
        "title": record.title,
        "view": view,
        "sourcePath": str(source_path) if source_path else None,
        "sourceMtime": stats.st_mtime if stats else None,
        "sourceSize": stats.st_size if stats else None,
        "digest": digest,
        "overview": "\n\n".join(part for part in overview_parts if part),
        "headings": headings,
        "chunks": chunks,
    }
    gui_memory.ensure_paper_memory(record, memory_root)
    copilot_context_cache_path(record, memory_root, view).parent.mkdir(parents=True, exist_ok=True)
    gui_memory.write_json_file(copilot_context_cache_path(record, memory_root, view), cache_payload)
    return cache_payload


def load_copilot_context_cache(
    record: Any,
    memory_root: Path,
    view: str,
    *,
    load_markdown: Callable[[Path | None], str | None],
) -> dict[str, object]:
    cache_path = copilot_context_cache_path(record, memory_root, view)
    source_path = resolve_annotation_source_path(record, view)
    source_stats = source_path.stat() if source_path and source_path.exists() else None
    if cache_path.exists():
        payload = gui_memory.read_json_file(cache_path, default={})
        if isinstance(payload, dict) and payload:
            same_source = str(payload.get("sourcePath") or "") == str(source_path) if source_path else not payload.get("sourcePath")
            same_mtime = payload.get("sourceMtime") == (source_stats.st_mtime if source_stats else None)
            same_size = payload.get("sourceSize") == (source_stats.st_size if source_stats else None)
            if same_source and same_mtime and same_size:
                return payload
    return build_copilot_context_cache(record, memory_root, view, load_markdown=load_markdown)


def render_relevant_chunks(chunks: list[dict[str, object]]) -> str:
    parts: list[str] = []
    for index, chunk in enumerate(chunks, start=1):
        heading = str(chunk.get("heading") or "").strip()
        text = str(chunk.get("text") or "").strip()
        if not text:
            continue
        label = f"片段 {index}"
        if heading:
            label += f" | {heading}"
        parts.append(f"[{label}]\n{text}")
    return "\n\n".join(parts)


def select_copilot_chunks_by_ids(
    cache_payload: dict[str, object],
    chunk_ids: list[str],
    *,
    limit: int = 4,
) -> list[dict[str, object]]:
    chunks = cache_payload.get("chunks") if isinstance(cache_payload.get("chunks"), list) else []
    if not chunks or not chunk_ids:
        return []
    chunk_map: dict[str, dict[str, object]] = {}
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        chunk_id = str(chunk.get("id") or "").strip()
        if chunk_id:
            chunk_map[chunk_id] = chunk
    selected: list[dict[str, object]] = []
    for chunk_id in chunk_ids:
        chunk = chunk_map.get(chunk_id)
        if chunk:
            selected.append(chunk)
        if len(selected) >= limit:
            break
    return selected


def select_relevant_copilot_chunks(
    cache_payload: dict[str, object],
    annotation: dict[str, object],
    user_message: str,
    *,
    limit: int = 4,
) -> list[dict[str, object]]:
    chunks = cache_payload.get("chunks") if isinstance(cache_payload.get("chunks"), list) else []
    if not chunks:
        return []
    quote = str(annotation.get("quote") or "").strip()
    context_before = str(annotation.get("contextBefore") or "").strip()
    context_after = str(annotation.get("contextAfter") or "").strip()
    query_tokens = tokenize_copilot_query("\n".join(part for part in (quote, context_before, context_after, user_message) if part))
    scored: list[tuple[float, dict[str, object]]] = []
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        text = str(chunk.get("text") or "").strip()
        normalized = str(chunk.get("normalized") or "").strip()
        if not text or not normalized:
            continue
        score = 0.0
        if quote and quote in text:
            score += 10
        if context_before and context_before[:24] and context_before[:24] in text:
            score += 4
        if context_after and context_after[:24] and context_after[:24] in text:
            score += 4
        for token in query_tokens:
            if token in normalized:
                score += min(3.0, 0.8 + (len(token) / 12))
        if score <= 0:
            continue
        scored.append((score, chunk))
    scored.sort(key=lambda item: item[0], reverse=True)
    selected = [chunk for _score, chunk in scored[:limit]]
    if selected:
        return selected
    fallback = chunks[: min(limit, len(chunks))]
    return [item for item in fallback if isinstance(item, dict)]


def merge_copilot_chunks(
    primary_chunks: list[dict[str, object]],
    secondary_chunks: list[dict[str, object]],
    *,
    limit: int = 4,
) -> list[dict[str, object]]:
    merged: list[dict[str, object]] = []
    seen_ids: set[str] = set()
    for chunk in [*primary_chunks, *secondary_chunks]:
        if not isinstance(chunk, dict):
            continue
        chunk_id = str(chunk.get("id") or "").strip()
        if not chunk_id or chunk_id in seen_ids:
            continue
        seen_ids.add(chunk_id)
        merged.append(chunk)
        if len(merged) >= limit:
            break
    return merged


def resolve_agent_relevant_chunks(
    cache_payload: dict[str, object],
    annotation: dict[str, object],
    user_message: str,
    follow_up_comment: dict[str, object] | None = None,
    *,
    limit: int = 4,
) -> list[dict[str, object]]:
    fresh_chunks = select_relevant_copilot_chunks(cache_payload, annotation, user_message, limit=limit)
    if not isinstance(follow_up_comment, dict):
        return fresh_chunks
    reused_chunk_ids = gui_memory.normalize_string_list(follow_up_comment.get("contextChunkIds"), limit=limit)
    reused_chunks = select_copilot_chunks_by_ids(cache_payload, reused_chunk_ids, limit=limit)
    if not reused_chunks:
        return fresh_chunks
    reused_budget = min(len(reused_chunks), max(limit - 1, 1))
    return merge_copilot_chunks(reused_chunks[:reused_budget], fresh_chunks, limit=limit)


def resolve_annotation_comment(annotation: dict[str, object], comment_id: str) -> dict[str, object]:
    comments = annotation.get("comments")
    if not isinstance(comments, list):
        raise FileNotFoundError("未找到指定评论")
    for comment in comments:
        if isinstance(comment, dict) and str(comment.get("id") or "") == comment_id:
            return comment
    raise FileNotFoundError("未找到指定评论")


def build_annotation_conversation_context(annotation: dict[str, object], agent_id: str, *, max_turns: int = 6) -> str:
    comments = annotation.get("comments")
    if not isinstance(comments, list):
        return ""

    relevant_lines: list[str] = []
    for comment in comments:
        if not isinstance(comment, dict):
            continue
        author_type = str(comment.get("authorType") or "").strip()
        content = str(comment.get("content") or "").strip()
        if not content:
            continue
        if author_type == "agent":
            comment_agent_id = str(comment.get("agentId") or "").strip()
            comment_author = str(comment.get("authorLabel") or "共读助手").strip() or "共读助手"
            if comment_agent_id and agent_id and comment_agent_id != agent_id:
                continue
            relevant_lines.append(f"{comment_author}：{content}")
            continue

        if author_type == "user":
            reply_to_agent_id = str(comment.get("replyToAgentId") or "").strip()
            if reply_to_agent_id and agent_id and reply_to_agent_id != agent_id:
                continue
            relevant_lines.append(f"用户：{content}")

    if not relevant_lines:
        return ""
    return "\n".join(relevant_lines[-max_turns:])


def resolve_latest_user_comment_for_agent(annotation: dict[str, object], agent_id: str) -> dict[str, object] | None:
    comments = annotation.get("comments")
    if not isinstance(comments, list):
        return None
    for comment in reversed(comments):
        if not isinstance(comment, dict):
            continue
        if str(comment.get("authorType") or "").strip() != "user":
            continue
        reply_to_agent_id = str(comment.get("replyToAgentId") or "").strip()
        if reply_to_agent_id and agent_id and reply_to_agent_id != agent_id:
            continue
        content = str(comment.get("content") or "").strip()
        if content:
            return comment
    return None


def build_run_mode_instruction(run_mode: str) -> str:
    normalized = gui_copilot_runs.normalize_run_mode(run_mode)
    if normalized == "explain":
        return "本次动作是解释：说明划线句子在全文论证、方法或证据链中的作用。"
    if normalized == "critique":
        return "本次动作是质疑：指出划线句子的限制、可能反例、证据缺口或需要谨慎解释的地方。"
    if normalized == "memory_candidate":
        return "本次动作是沉淀：把划线句子和上下文转成可长期复用的研究记忆候选项。"
    return "本次动作是评论：围绕划线句子给出短判断，必要时提出可沉淀的记忆候选。"


def build_structured_output_instruction() -> str:
    return "\n".join(
        [
            "请严格返回一个 JSON 对象，不要使用 Markdown 代码块，不要在 JSON 前后添加解释。",
            '格式：{"comment":"面向用户的短评论","memoryCandidates":[{"type":"insight","text":"可长期保留的判断","tags":["method"],"confidence":0.78,"evidenceQuote":"原文证据短句"}],"openQuestions":["后续需要验证的问题"]}',
            "comment 必须是中文短评论。memoryCandidates 只能包含值得长期保留、且能由当前证据支撑的项目；没有就返回空数组。",
            "memoryCandidates.type 只能是 note、question、action、insight 之一。openQuestions 没有就返回空数组。",
        ]
    )


def extract_json_object(text: str) -> str | None:
    stripped = str(text or "").strip()
    if not stripped:
        return None
    if stripped.startswith("```"):
        stripped = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", stripped)
        stripped = re.sub(r"\s*```$", "", stripped).strip()
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start < 0 or end <= start:
        return None
    return stripped[start : end + 1]


def parse_copilot_structured_output(text: str) -> dict[str, object]:
    raw_text = str(text or "").strip()
    json_text = extract_json_object(raw_text)
    if json_text is None:
        return {
            "structuredOutput": False,
            "comment": raw_text,
            "memoryCandidates": [],
            "openQuestions": [],
            "parseError": "not_json",
            "rawText": raw_text,
        }
    try:
        payload = json.loads(json_text)
    except json.JSONDecodeError as error:
        return {
            "structuredOutput": False,
            "comment": raw_text,
            "memoryCandidates": [],
            "openQuestions": [],
            "parseError": f"invalid_json: {error.msg}",
            "rawText": raw_text,
        }
    if not isinstance(payload, dict):
        return {
            "structuredOutput": False,
            "comment": raw_text,
            "memoryCandidates": [],
            "openQuestions": [],
            "parseError": "json_root_not_object",
            "rawText": raw_text,
        }

    comment = payload.get("comment")
    normalized_comment = str(comment).strip() if isinstance(comment, str) and comment.strip() else raw_text
    candidates: list[dict[str, object]] = []
    raw_candidates = payload.get("memoryCandidates")
    if isinstance(raw_candidates, list):
        for item in raw_candidates:
            if not isinstance(item, dict):
                continue
            normalized = gui_memory.normalize_memory_candidate_input(item)
            if normalized is None:
                continue
            evidence_quote = item.get("evidenceQuote")
            if isinstance(evidence_quote, str) and evidence_quote.strip():
                normalized["evidenceQuote"] = evidence_quote.strip()
            candidates.append(normalized)
            if len(candidates) >= 6:
                break
    return {
        "structuredOutput": True,
        "comment": normalized_comment,
        "memoryCandidates": candidates,
        "openQuestions": gui_memory.normalize_string_list(payload.get("openQuestions"), limit=6),
        "parseError": None,
        "rawText": raw_text,
    }


def render_copilot_comment(parsed: dict[str, object]) -> str:
    comment = str(parsed.get("comment") or "").strip() or str(parsed.get("rawText") or "").strip()
    open_questions = gui_memory.normalize_string_list(parsed.get("openQuestions"), limit=6)
    if open_questions:
        question_lines = "\n".join(f"- {question}" for question in open_questions)
        comment = f"{comment}\n\n待验证问题：\n{question_lines}" if comment else f"待验证问题：\n{question_lines}"
    return comment.strip() or "模型未返回可展示内容。"


def create_copilot_memory_candidates(
    record: Any,
    memory_root: Path,
    annotation: dict[str, object],
    comment: dict[str, object],
    parsed: dict[str, object],
    *,
    agent_id: str,
    run_id: str | None,
    run_mode: str,
) -> tuple[list[dict[str, object]], list[str]]:
    candidates = parsed.get("memoryCandidates")
    if not isinstance(candidates, list) or not candidates:
        return [], []
    comment_id = str(comment.get("id") or "").strip()
    annotation_id = str(annotation.get("id") or "").strip()
    if not comment_id or not annotation_id:
        return [], []
    try:
        payload = gui_memory.create_memory_candidates_from_agent_comment(
            record,
            memory_root,
            annotation,
            {
                "sourceCommentId": comment_id,
                "agentId": agent_id,
                "runId": run_id,
                "runMode": run_mode,
                "items": candidates,
            },
        )
    except (ValueError, FileNotFoundError) as error:
        return [], [str(error)]
    created = payload.get("created") if isinstance(payload, dict) else []
    return [item for item in created if isinstance(item, dict)], []


def build_agent_messages(
    record: Any,
    annotation: dict[str, object],
    agent: dict[str, object],
    *,
    memory_root: Path,
    load_copilot_context_cache_func: Callable[[Any, str], dict[str, object]],
    user_message: str = "",
    follow_up_comment: dict[str, object] | None = None,
    context_cache: dict[str, object] | None = None,
    relevant_chunks: list[dict[str, object]] | None = None,
    run_mode: str = "comment",
) -> list[dict[str, str]]:
    view = str(annotation.get("view") or "linearized")
    active_context_cache = context_cache or load_copilot_context_cache_func(record, view)
    context_before = str(annotation.get("contextBefore") or "").strip()
    context_after = str(annotation.get("contextAfter") or "").strip()
    follow_up_content = str(follow_up_comment.get("content") or "").strip() if isinstance(follow_up_comment, dict) else ""
    conversation_context = build_annotation_conversation_context(annotation, str(agent.get("id") or "").strip())
    active_relevant_chunks = relevant_chunks or resolve_agent_relevant_chunks(active_context_cache, annotation, user_message, follow_up_comment)
    agent_memory_query = "\n".join(
        part
        for part in (
            record.title,
            str(annotation.get("quote") or "").strip(),
            context_before,
            context_after,
            conversation_context,
            follow_up_content,
            user_message.strip(),
        )
        if part
    )
    agent_memory_context = gui_agent_memory.render_agent_memory_context(
        memory_root,
        agent_memory_query,
        limit=8,
    )
    paper_memory_context = gui_memory.render_paper_memory_context(
        record,
        memory_root,
        agent_memory_query,
        limit=8,
    )
    shared_context = "\n\n".join(
        part
        for part in (
            f"论文标题：{record.title}",
            f"当前阅读视图：{'译文版本' if view == 'bilingual' else '原文'}",
            "以下是长期全局记忆，优先用于理解用户偏好、研究方向和项目上下文；不要机械复述：\n\n" + agent_memory_context if agent_memory_context else "",
            "以下是当前论文中已经由用户确认的研究记忆；只在和本次划线或问题相关时使用：\n\n" + paper_memory_context if paper_memory_context else "",
            "以下是论文的本地结构摘要，请先建立整体理解：\n\n" + str(active_context_cache.get("overview") or "").strip(),
            "以下是当前线程优先复用并补充后的相关正文片段：\n\n" + render_relevant_chunks(active_relevant_chunks) if active_relevant_chunks else "",
        )
        if part
    )
    focus_prompt = "\n".join(
        part
        for part in (
            f"你的身份设定：{str(agent.get('rolePrompt') or '').strip()}",
            f"当前用户划线句子：{str(annotation.get('quote') or '').strip()}",
            f"划线前文：{context_before}" if context_before else "",
            f"划线后文：{context_after}" if context_after else "",
            f"当前线程最近几轮对话：\n{conversation_context}" if conversation_context else "",
            f"你上一轮的回复：{follow_up_content}" if follow_up_content else "",
            f"用户这次的问题：{user_message.strip()}" if user_message.strip() else "",
            build_run_mode_instruction(run_mode),
            "请把焦点放在用户实际选中的这句话，不要偷换成整段概括。",
            "如果用户是在追问你上一轮的回复，先承接你上一次的判断，再直接回答这次问题。",
            "先判断这句话在全文中的作用，再围绕用户的问题，从你的角色出发给出具体看法。",
            "不要复述整篇论文，不要空泛鼓励，优先给出判断、疑点、启发或可落地的提醒。",
            build_structured_output_instruction(),
        )
        if part
    )
    return [
        {
            "role": "system",
            "content": "你是论文共读智能体。输出中文，保持克制、具体、少废话。",
        },
        {
            "role": "user",
            "content": shared_context,
        },
        {
            "role": "user",
            "content": focus_prompt,
        },
    ]


def request_copilot_completion(agent: dict[str, object], messages: list[dict[str, str]]) -> str:
    response = requests.post(
        f"{str(agent.get('baseUrl') or '').rstrip('/')}/chat/completions",
        headers={
            "Authorization": f"Bearer {str(agent.get('apiKey') or '').strip()}",
            "Content-Type": "application/json",
        },
        json={
            "model": str(agent.get("model") or "").strip(),
            "messages": messages,
            "temperature": 0.5,
            "max_tokens": 900,
        },
        timeout=120,
    )
    response.raise_for_status()
    result = response.json()
    content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    text = str(content).strip()
    if not text:
        raise RuntimeError("智能体没有返回内容")
    return text


def invoke_annotation_agent(
    record: Any,
    payload: dict[str, object],
    *,
    memory_root: Path,
    load_settings: Callable[[], dict[str, object]],
    load_annotation_func: Callable[[Any, str], tuple[Path, dict[str, object]]],
    create_annotation_func: Callable[[Any, dict[str, object]], Any],
    append_annotation_comment_func: Callable[[Any, str, dict[str, object]], Any],
    load_copilot_context_cache_func: Callable[[Any, str], dict[str, object]],
    should_cancel: Callable[[], bool] | None = None,
) -> Any:
    agent_id = payload.get("agentId")
    if not isinstance(agent_id, str) or not agent_id.strip():
        raise ValueError("缺少智能体标识")
    settings = load_settings()
    agent = resolve_copilot_agent(settings, agent_id.strip())

    annotation_id = payload.get("annotationId")
    if isinstance(annotation_id, str) and annotation_id.strip():
        _file_path, annotation = load_annotation_func(record, annotation_id.strip())
    else:
        draft = payload.get("draft")
        if not isinstance(draft, dict):
            raise ValueError("缺少划线上下文")
        annotation = {
            "view": draft.get("view"),
            "quote": draft.get("quote"),
            "contextBefore": draft.get("contextBefore"),
            "contextAfter": draft.get("contextAfter"),
            "anchorTop": draft.get("anchorTop"),
            "anchorHeight": draft.get("anchorHeight"),
        }

    user_message = str(payload.get("userMessage") or "").strip()
    run_mode = gui_copilot_runs.normalize_run_mode(payload.get("runMode"))
    run_id = str(payload.get("runId") or "").strip() or None
    follow_up_comment = None
    follow_up_comment_id = str(payload.get("followUpCommentId") or "").strip()
    if follow_up_comment_id:
        follow_up_comment = resolve_annotation_comment(annotation, follow_up_comment_id)
        if str(follow_up_comment.get("authorType") or "") != "agent":
            raise ValueError("追问目标必须是一条智能体评论")
        target_agent_id = str(follow_up_comment.get("agentId") or "").strip()
        target_author_label = str(follow_up_comment.get("authorLabel") or "").strip()
        current_agent_name = str(agent.get("name") or "").strip()
        if target_agent_id and target_agent_id != agent_id.strip():
            raise ValueError("追问目标与当前智能体不一致")
        if not target_agent_id and target_author_label and target_author_label != current_agent_name:
            raise ValueError("追问目标与当前智能体不一致")

    if should_cancel and should_cancel():
        raise RuntimeError("共读任务已取消")

    context_cache = load_copilot_context_cache_func(record, str(annotation.get("view") or "linearized"))
    relevant_chunks = resolve_agent_relevant_chunks(context_cache, annotation, user_message, follow_up_comment)
    content = request_copilot_completion(
        agent,
        build_agent_messages(
            record,
            annotation,
            agent,
            memory_root=memory_root,
            load_copilot_context_cache_func=load_copilot_context_cache_func,
            user_message=user_message,
            follow_up_comment=follow_up_comment,
            context_cache=context_cache,
            relevant_chunks=relevant_chunks,
            run_mode=run_mode,
        ),
    )
    if should_cancel and should_cancel():
        raise RuntimeError("共读任务已取消")

    parsed_output = parse_copilot_structured_output(content)
    comment_content = render_copilot_comment(parsed_output)
    trigger_user_comment = resolve_latest_user_comment_for_agent(annotation, agent_id.strip())
    comment_payload = {
        "authorType": "agent",
        "agentId": agent_id.strip(),
        "replyToCommentId": str(trigger_user_comment.get("id") or "").strip() if isinstance(trigger_user_comment, dict) else None,
        "contextChunkIds": [
            str(chunk.get("id") or "").strip()
            for chunk in relevant_chunks
            if isinstance(chunk, dict) and str(chunk.get("id") or "").strip()
        ],
        "authorLabel": str(agent.get("name") or "共读助手").strip() or "共读助手",
        "content": comment_content,
        "status": "ready",
    }

    if isinstance(annotation_id, str) and annotation_id.strip():
        comment = append_annotation_comment_func(record, annotation_id.strip(), comment_payload)
    else:
        annotation = create_annotation_func(
            record,
            {
                **annotation,
                "initialComment": comment_payload,
            },
        )
        comment = annotation["comments"][0]
    created_candidates, candidate_errors = create_copilot_memory_candidates(
        record,
        memory_root,
        annotation,
        comment,
        parsed_output,
        agent_id=agent_id.strip(),
        run_id=run_id,
        run_mode=run_mode,
    )
    memory_candidate_ids = [str(item.get("id") or "").strip() for item in created_candidates if str(item.get("id") or "").strip()]
    if isinstance(comment, dict):
        comment["runMode"] = run_mode
        comment["structuredOutput"] = bool(parsed_output.get("structuredOutput"))
        if parsed_output.get("parseError"):
            comment["structuredOutputError"] = str(parsed_output.get("parseError"))
        comment["openQuestions"] = gui_memory.normalize_string_list(parsed_output.get("openQuestions"), limit=6)
        comment["memoryCandidateIds"] = memory_candidate_ids
        comment["memoryCandidateCount"] = len(memory_candidate_ids)
        comment["memoryCandidateErrors"] = candidate_errors
    return comment


def resolve_copilot_agents_for_run(
    payload: dict[str, object],
    *,
    load_settings: Callable[[], dict[str, object]],
) -> list[dict[str, object]]:
    raw_agent_ids = gui_memory.normalize_string_list(payload.get("agentIds"), limit=8)
    if not raw_agent_ids and isinstance(payload.get("agentId"), str):
        raw_agent_ids = [str(payload.get("agentId") or "").strip()]
    agent_ids: list[str] = []
    for agent_id in raw_agent_ids:
        if agent_id and agent_id not in agent_ids:
            agent_ids.append(agent_id)
    if not agent_ids:
        raise ValueError("缺少智能体标识")

    settings = load_settings()
    return [resolve_copilot_agent(settings, agent_id) for agent_id in agent_ids]


def create_copilot_run(
    record: Any,
    payload: dict[str, object],
    *,
    memory_root: Path,
    load_settings: Callable[[], dict[str, object]],
    spawn_worker: Callable[[str, str], None],
) -> dict[str, object]:
    agents = resolve_copilot_agents_for_run(payload, load_settings=load_settings)
    run = gui_copilot_runs.create_run(record, memory_root, payload, agents)
    spawn_worker(record.paper_id, str(run["runId"]))
    return run


def retry_copilot_run(
    record: Any,
    run_id: str,
    *,
    memory_root: Path,
    spawn_worker: Callable[[str, str], None],
    agent_id: str | None = None,
) -> dict[str, object]:
    run = gui_copilot_runs.prepare_retry(record, memory_root, run_id, agent_id)
    spawn_worker(record.paper_id, str(run["runId"]))
    return run


def spawn_copilot_run_worker(
    paper_id: str,
    run_id: str,
    *,
    execute_copilot_run_func: Callable[[str, str], None],
) -> None:
    thread = threading.Thread(
        target=execute_copilot_run_func,
        args=(paper_id, run_id),
        daemon=True,
        name=f"cark-copilot-run-{run_id}",
    )
    thread.start()


def execute_copilot_run(
    paper_id: str,
    run_id: str,
    *,
    get_record_func: Callable[[str], Any],
    memory_root: Path,
    invoke_annotation_agent_func: Callable[..., Any],
) -> None:
    try:
        record = get_record_func(paper_id)
    except FileNotFoundError:
        return

    try:
        run = gui_copilot_runs.mark_run_running(record, memory_root, run_id)
    except FileNotFoundError:
        return

    annotation_id = str(run.get("annotationId") or "").strip()
    run_mode = gui_copilot_runs.normalize_run_mode(run.get("runMode"))
    user_message = str(run.get("userMessage") or "").strip()
    follow_up_comment_id = str(run.get("followUpCommentId") or "").strip() or None
    follow_up_agent_id = str(run.get("FollowUpAgentId") or run.get("followUpAgentId") or "").strip() or None

    for agent_run in gui_copilot_runs.normalize_agent_runs(run.get("agents")):
        agent_id = str(agent_run.get("agentId") or "").strip()
        if not agent_id:
            continue
        try:
            latest_run = gui_copilot_runs.load_run(record, memory_root, run_id)
        except FileNotFoundError:
            return
        if latest_run.get("status") == "canceled":
            return
        latest_agent = next(
            (
                item
                for item in gui_copilot_runs.normalize_agent_runs(latest_run.get("agents"))
                if item.get("agentId") == agent_id
            ),
            None,
        )
        if not latest_agent or latest_agent.get("status") == "done":
            continue
        if latest_agent.get("status") not in {"queued", "running", "failed", "canceled"}:
            continue

        try:
            gui_copilot_runs.mark_agent_running(record, memory_root, run_id, agent_id)
            comment = invoke_annotation_agent_func(
                record,
                {
                    "agentId": agent_id,
                    "annotationId": annotation_id,
                    "runId": run_id,
                    "runMode": run_mode,
                    "userMessage": user_message,
                    "followUpCommentId": (
                        follow_up_comment_id
                        if follow_up_comment_id and (not follow_up_agent_id or follow_up_agent_id == agent_id)
                        else None
                    ),
                },
                should_cancel=lambda: gui_copilot_runs.is_canceled(record, memory_root, run_id),
            )
            comment_id = str(comment.get("id") or "").strip() if isinstance(comment, dict) else None
            result_payload = {
                "runMode": run_mode,
                "structuredOutput": bool(comment.get("structuredOutput")) if isinstance(comment, dict) else False,
                "structuredOutputError": comment.get("structuredOutputError") if isinstance(comment, dict) else None,
                "memoryCandidateIds": comment.get("memoryCandidateIds") if isinstance(comment, dict) else [],
                "memoryCandidateCount": comment.get("memoryCandidateCount") if isinstance(comment, dict) else 0,
                "memoryCandidateErrors": comment.get("memoryCandidateErrors") if isinstance(comment, dict) else [],
                "openQuestions": comment.get("openQuestions") if isinstance(comment, dict) else [],
            }
            gui_copilot_runs.mark_agent_done(record, memory_root, run_id, agent_id, comment_id, result_payload)
        except Exception as error:
            if gui_copilot_runs.is_canceled(record, memory_root, run_id):
                return
            gui_copilot_runs.mark_agent_failed(record, memory_root, run_id, agent_id, str(error))


def resume_active_copilot_runs(
    *,
    indexed_records_func: Callable[..., dict[str, Any]],
    memory_root: Path,
    timeout_seconds: int,
    spawn_worker: Callable[[str, str], None],
) -> dict[str, int]:
    resumed_count = 0
    expired_count = 0
    for record in indexed_records_func(refresh=True).values():
        expired_count += gui_copilot_runs.expire_stale_active_runs(
            record,
            memory_root,
            timeout_seconds=timeout_seconds,
        )
        for run in gui_copilot_runs.list_active_runs(record, memory_root):
            run_id = str(run.get("runId") or "").strip()
            if not run_id:
                continue
            resumed = gui_copilot_runs.prepare_resume(record, memory_root, run_id)
            if resumed.get("status") in {"queued", "running"}:
                spawn_worker(record.paper_id, run_id)
                resumed_count += 1
    return {"resumed": resumed_count, "expired": expired_count}
