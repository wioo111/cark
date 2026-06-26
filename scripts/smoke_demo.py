from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any

import gui_annotations
import gui_exports
import gui_memory
import gui_memory_candidates
import gui_papers
import gui_search
from gui_server_common import PaperRecord, current_timestamp_iso, encode_paper_id
from gui_storage import WorkbenchStore


WORKSPACE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RUNTIME_ROOT = WORKSPACE_ROOT / "runtime" / "demo-smoke"
DEMO_TITLE = "Demo Research Memory"
DEMO_TASK_ID = "00000000-0000-0000-0000-000000000001"
DEMO_PAPER_ID = encode_paper_id(DEMO_TASK_ID, DEMO_TITLE)
DEMO_QUOTE = "Alignment drift should be treated as a boundary condition, not only as a training artifact."
DEMO_MEMORY_TEXT = (
    "Alignment drift should be treated as a boundary condition when evaluating long-running research agents."
)


class SmokeFailure(RuntimeError):
    pass


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        summary = run_smoke(
            Path(args.runtime_root),
            reset=not args.no_reset,
            force_reset=args.force_reset,
        )
    except Exception as error:
        print(f"[smoke-demo] FAILED: {error}", file=sys.stderr)
        return 1

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print("[smoke-demo] OK: demo research memory flow completed without API keys.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="smoke_demo.py",
        description="Build and verify an isolated cark demo research-memory runtime.",
    )
    parser.add_argument(
        "--runtime-root",
        default=str(DEFAULT_RUNTIME_ROOT),
        help="Demo runtime directory. Defaults to runtime/demo-smoke.",
    )
    parser.add_argument(
        "--no-reset",
        action="store_true",
        help="Reuse the runtime directory instead of recreating it first.",
    )
    parser.add_argument(
        "--force-reset",
        action="store_true",
        help="Allow resetting a custom runtime directory outside repository runtime/.",
    )
    return parser


def run_smoke(
    runtime_root: Path,
    *,
    reset: bool = True,
    force_reset: bool = False,
) -> dict[str, object]:
    runtime_root = runtime_root.resolve()
    prepare_runtime_root(runtime_root, reset=reset, force_reset=force_reset)

    memory_root = runtime_root / "memory"
    database_path = runtime_root / "cark.sqlite3"
    record = seed_demo_paper(runtime_root)
    store = WorkbenchStore(database_path)
    index_record(store, record, memory_root)

    annotation = gui_annotations.create_annotation(
        record,
        memory_root,
        {
            "view": "linearized",
            "quote": DEMO_QUOTE,
            "contextBefore": "The evaluation section separates deployment failures from model fit.",
            "contextAfter": "The authors later connect this failure mode to evidence review.",
            "anchorTop": 128,
            "anchorHeight": 32,
            "blockId": "block-1",
            "initialComment": {
                "authorType": "user",
                "authorLabel": "Demo User",
                "content": "这句话能否沉淀为后续研究判断？",
            },
        },
    )
    agent_comment = gui_annotations.append_annotation_comment(
        record,
        memory_root,
        str(annotation["id"]),
        {
            "authorType": "agent",
            "authorLabel": "Demo Agent",
            "agentId": "agent-demo",
            "content": "这是一条可复用判断：评价长期智能体时，应把 alignment drift 当作边界条件。",
        },
    )
    created_payload = gui_memory.create_memory_candidates_from_agent_comment(
        record,
        memory_root,
        annotation,
        {
            "sourceCommentId": agent_comment["id"],
            "agentId": "agent-demo",
            "runId": "run-demo",
            "runMode": "memory_candidate",
            "items": [
                {
                    "type": "insight",
                    "text": DEMO_MEMORY_TEXT,
                    "tags": ["alignment", "evaluation"],
                    "confidence": 0.82,
                    "evidenceQuote": DEMO_QUOTE,
                }
            ],
        },
    )
    created = created_payload["created"]
    require(isinstance(created, list) and len(created) == 1, "expected one candidate memory")
    candidate = created[0]
    require(candidate.get("activationStatus") == "candidate", "created memory must start as candidate")
    require(candidate_has_evidence(candidate), "candidate memory must keep quote/context/block evidence")

    candidates = gui_memory_candidates.list_memory_candidates(memory_root, [record])
    require(candidates.get("count") == 1, "candidate inbox should list the created memory")

    activated = gui_memory_candidates.activate_memory_candidate(memory_root, str(candidate["id"]), [record])
    require(activated.get("activationStatus") == "active", "candidate should activate")
    require(activated.get("status") == "active", "activated memory should be active")
    require(activated.get("revisionHistory"), "activation should preserve revision history")

    index_record(store, record, memory_root)
    search_results = gui_search.search_records(
        [record],
        "boundary condition",
        memory_root=memory_root,
        load_markdown=load_markdown,
        load_annotations=lambda current_record: gui_annotations.load_paper_annotations(current_record, memory_root),
        search_store=store,
    )
    memory_result = next(
        (
            result
            for result in search_results
            if result.get("source") == "memory" and result.get("memoryItemId") == activated.get("id")
        ),
        None,
    )
    require(memory_result is not None, "search should find the activated memory")
    require(
        isinstance(memory_result.get("locator"), dict) and memory_result["locator"].get("memoryItemId") == activated.get("id"),
        "search result should carry a memory locator",
    )

    export_payload = gui_exports.export_paper_memory_markdown(record, memory_root)
    export_path = Path(str(export_payload["filePath"]))
    require(export_path.exists(), "markdown export should create a file")
    require(DEMO_MEMORY_TEXT in export_path.read_text(encoding="utf-8"), "markdown export should include active memory")

    summary = {
        "runtimeRoot": str(runtime_root),
        "guiCommand": f"python cli.py demo --gui --no-reset --runtime-root \"{runtime_root}\"",
        "paperId": record.paper_id,
        "annotationId": annotation["id"],
        "candidateId": candidate["id"],
        "activationStatus": activated["activationStatus"],
        "searchResultId": memory_result["id"],
        "exportPath": str(export_path),
        "checks": [
            "seeded mock paper",
            "created annotation",
            "created candidate memory with evidence",
            "activated candidate memory",
            "searched activated memory through FTS-backed search",
            "exported memory markdown",
        ],
    }
    (runtime_root / "smoke-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return summary


def prepare_runtime_root(runtime_root: Path, *, reset: bool, force_reset: bool) -> None:
    if not reset:
        runtime_root.mkdir(parents=True, exist_ok=True)
        return
    if runtime_root.exists():
        repo_runtime = (WORKSPACE_ROOT / "runtime").resolve()
        if not is_relative_to(runtime_root, repo_runtime) and not force_reset:
            raise SmokeFailure(
                f"refusing to reset custom runtime outside repository runtime/: {runtime_root}"
            )
        try:
            shutil.rmtree(runtime_root)
        except OSError as error:
            raise SmokeFailure(
                f"cannot reset demo runtime because it is in use: {runtime_root}. Close any demo GUI window and retry."
            ) from error
    runtime_root.mkdir(parents=True, exist_ok=True)


def seed_demo_paper(runtime_root: Path) -> PaperRecord:
    root_dir = runtime_root / "output" / DEMO_TASK_ID / "demo-paper"
    auto_dir = root_dir / "auto"
    auto_dir.mkdir(parents=True, exist_ok=True)

    linearized_path = auto_dir / f"{DEMO_TITLE}_linearized.md"
    content_list_path = auto_dir / f"{DEMO_TITLE}_content_list.json"
    linearized_path.write_text(
        "\n".join(
            [
                f"# {DEMO_TITLE}",
                "",
                "## Abstract",
                "This demo paper is intentionally small and local-only.",
                "",
                "## Evaluation",
                DEMO_QUOTE,
                "Confirmed memories should remain traceable to their source evidence.",
                "",
            ]
        ),
        encoding="utf-8",
    )
    content_list_path.write_text(
        json.dumps(
            [
                {"type": "title", "text": DEMO_TITLE, "text_level": 1, "page_idx": 0},
                {"type": "text", "text": DEMO_QUOTE, "page_idx": 1},
            ],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return PaperRecord(
        paper_id=DEMO_PAPER_ID,
        title=DEMO_TITLE,
        task_id=DEMO_TASK_ID,
        root_dir=root_dir,
        auto_dir=auto_dir,
        updated_at=linearized_path.stat().st_mtime,
        available_views=["linearized"],
        source_pdf=None,
        files={
            "linearized": linearized_path,
            "bilingual": None,
            "feishuReady": None,
            "contentListJson": content_list_path,
        },
    )


def index_record(store: WorkbenchStore, record: PaperRecord, memory_root: Path) -> None:
    indexed_at = current_timestamp_iso()
    store.upsert_papers([gui_papers.serialize_paper_record(record)], indexed_at)
    store.replace_search_entries_for_papers(
        [record.paper_id],
        gui_search.build_record_search_index(
            record,
            memory_root=memory_root,
            load_markdown=load_markdown,
            load_annotations=lambda current_record: gui_annotations.load_paper_annotations(current_record, memory_root),
        ),
        indexed_at,
    )


def load_markdown(path: Path | None) -> str | None:
    if not path or not path.exists():
        return None
    return path.read_text(encoding="utf-8")


def candidate_has_evidence(candidate: dict[str, object]) -> bool:
    evidence = candidate.get("evidence")
    if not isinstance(evidence, list) or not evidence:
        return False
    first = evidence[0]
    if not isinstance(first, dict):
        return False
    return bool(
        first.get("quote")
        and first.get("contextBefore")
        and first.get("contextAfter")
        and first.get("blockId")
    )


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SmokeFailure(message)


def is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


if __name__ == "__main__":
    raise SystemExit(main())
