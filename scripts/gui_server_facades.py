from __future__ import annotations

from typing import Any, Callable

import gui_annotations
import gui_copilot
import gui_copilot_runs
import gui_library
import gui_memory
import gui_papers
import gui_search


class PaperFacade:
    def __init__(
        self,
        *,
        store: Any,
        memory_root_getter: Callable[[], Any],
        timeout_seconds_getter: Callable[[], int],
        indexed_records_getter: Callable[[], Callable[..., dict[str, Any]]],
        load_markdown_getter: Callable[[], Callable[[Any], Any]],
        load_annotations_getter: Callable[[], Callable[[Any], list[dict[str, object]]]],
        load_blocks_getter: Callable[[], Callable[[Any], list[dict[str, object]]]],
        build_images_getter: Callable[[], Callable[[Any], list[dict[str, str]]]],
    ) -> None:
        self._store = store
        self._memory_root_getter = memory_root_getter
        self._timeout_seconds_getter = timeout_seconds_getter
        self._indexed_records_getter = indexed_records_getter
        self._load_markdown_getter = load_markdown_getter
        self._load_annotations_getter = load_annotations_getter
        self._load_blocks_getter = load_blocks_getter
        self._build_images_getter = build_images_getter

    def build_default_reading_state(self, record: Any) -> dict[str, object]:
        preferred_view = "bilingual" if "bilingual" in record.available_views else "linearized"
        return {
            "paperId": record.paper_id,
            "view": preferred_view,
            "scrollY": 0,
            "activeSectionId": None,
            "draft": None,
            "updatedAt": None,
        }

    def list_paper_copilot_runs(self, record: Any, annotation_filter: str | None = None) -> list[dict[str, object]]:
        gui_copilot_runs.expire_stale_active_runs(
            record,
            self._memory_root_getter(),
            timeout_seconds=self._timeout_seconds_getter(),
        )
        runs = gui_copilot_runs.list_runs(record, self._memory_root_getter())
        if annotation_filter:
            runs = [run for run in runs if run.get("annotationId") == annotation_filter]
        return runs

    def search_api_records(self, query: str, limit: int) -> list[dict[str, object]]:
        records = sorted(self._indexed_records_getter()(refresh=True).values(), key=lambda item: item.updated_at, reverse=True)
        return gui_search.search_records(
            records,
            query,
            memory_root=self._memory_root_getter(),
            load_markdown=self._load_markdown_getter(),
            load_annotations=self._load_annotations_getter(),
            search_store=self._store,
            limit=limit,
        )

    def build_paper_summary(self, record: Any) -> dict[str, object]:
        return gui_papers.build_paper_summary(
            record,
            get_reading_state=self._store.get_reading_state,
            load_library_meta=lambda current_record, reading_state: gui_library.load_library_meta(
                current_record,
                self._memory_root_getter(),
                reading_state=reading_state,
            ),
            load_annotations=self._load_annotations_getter(),
            load_memory_items=lambda current_record: gui_memory.load_memory_items(current_record, self._memory_root_getter()),
        )

    def list_papers(self) -> list[dict[str, object]]:
        return gui_papers.list_papers(
            indexed_records_func=self._indexed_records_getter(),
            build_paper_summary=self.build_paper_summary,
        )

    def build_detail(self, record: Any) -> dict[str, object]:
        return gui_papers.build_detail(
            record,
            load_blocks=self._load_blocks_getter(),
            load_markdown=self._load_markdown_getter(),
            build_images=self._build_images_getter(),
        )


class CopilotFacade:
    def __init__(
        self,
        *,
        memory_root_getter: Callable[[], Any],
        load_settings_getter: Callable[[], Callable[[], dict[str, object]]],
        load_annotation_getter: Callable[[], Callable[[Any, str], tuple[Any, dict[str, object]]]],
        create_annotation_getter: Callable[[], Callable[[Any, dict[str, object]], Any]],
        append_annotation_comment_getter: Callable[[], Callable[[Any, str, dict[str, object]], Any]],
        load_copilot_context_cache_getter: Callable[[], Callable[[Any, str], dict[str, object]]],
        spawn_worker_getter: Callable[[], Callable[[str, str], Any]],
        get_record_getter: Callable[[], Callable[[str], Any]],
        indexed_records_getter: Callable[[], Callable[..., dict[str, Any]]],
        invoke_annotation_agent_getter: Callable[[], Callable[[Any, dict[str, object], Any], Any]],
        timeout_seconds_getter: Callable[[], int],
        load_markdown_getter: Callable[[], Callable[[Any], Any]],
    ) -> None:
        self._memory_root_getter = memory_root_getter
        self._load_settings_getter = load_settings_getter
        self._load_annotation_getter = load_annotation_getter
        self._create_annotation_getter = create_annotation_getter
        self._append_annotation_comment_getter = append_annotation_comment_getter
        self._load_copilot_context_cache_getter = load_copilot_context_cache_getter
        self._spawn_worker_getter = spawn_worker_getter
        self._get_record_getter = get_record_getter
        self._indexed_records_getter = indexed_records_getter
        self._invoke_annotation_agent_getter = invoke_annotation_agent_getter
        self._timeout_seconds_getter = timeout_seconds_getter
        self._load_markdown_getter = load_markdown_getter

    def build_copilot_context_cache(self, record: Any, view: str) -> dict[str, object]:
        return gui_copilot.build_copilot_context_cache(
            record,
            self._memory_root_getter(),
            view,
            load_markdown=self._load_markdown_getter(),
        )

    def load_copilot_context_cache(self, record: Any, view: str) -> dict[str, object]:
        return gui_copilot.load_copilot_context_cache(
            record,
            self._memory_root_getter(),
            view,
            load_markdown=self._load_markdown_getter(),
        )

    def build_agent_messages(
        self,
        record: Any,
        annotation: dict[str, object],
        agent: dict[str, object],
        user_message: str = "",
        follow_up_comment: dict[str, object] | None = None,
        context_cache: dict[str, object] | None = None,
        relevant_chunks: list[dict[str, object]] | None = None,
        run_mode: str = "comment",
    ) -> list[dict[str, str]]:
        return gui_copilot.build_agent_messages(
            record,
            annotation,
            agent,
            memory_root=self._memory_root_getter(),
            load_copilot_context_cache_func=self.load_copilot_context_cache,
            user_message=user_message,
            follow_up_comment=follow_up_comment,
            context_cache=context_cache,
            relevant_chunks=relevant_chunks,
            run_mode=run_mode,
        )

    def invoke_annotation_agent(self, record: Any, payload: dict[str, object], should_cancel=None):
        return gui_copilot.invoke_annotation_agent(
            record,
            payload,
            memory_root=self._memory_root_getter(),
            load_settings=self._load_settings_getter(),
            load_annotation_func=self._load_annotation_getter(),
            create_annotation_func=self._create_annotation_getter(),
            append_annotation_comment_func=self._append_annotation_comment_getter(),
            load_copilot_context_cache_func=self.load_copilot_context_cache,
            should_cancel=should_cancel,
        )

    def resolve_copilot_agents_for_run(self, payload: dict[str, object]) -> list[dict[str, object]]:
        return gui_copilot.resolve_copilot_agents_for_run(
            payload,
            load_settings=self._load_settings_getter(),
        )

    def create_copilot_run(self, record: Any, payload: dict[str, object]) -> dict[str, object]:
        return gui_copilot.create_copilot_run(
            record,
            payload,
            memory_root=self._memory_root_getter(),
            load_settings=self._load_settings_getter(),
            spawn_worker=self._spawn_worker_getter(),
        )

    def retry_copilot_run(self, record: Any, run_id: str, agent_id: str | None = None) -> dict[str, object]:
        return gui_copilot.retry_copilot_run(
            record,
            run_id,
            memory_root=self._memory_root_getter(),
            spawn_worker=self._spawn_worker_getter(),
            agent_id=agent_id,
        )

    def spawn_copilot_run_worker(self, paper_id: str, run_id: str):
        return gui_copilot.spawn_copilot_run_worker(
            paper_id,
            run_id,
            execute_copilot_run_func=self.execute_copilot_run,
        )

    def execute_copilot_run(self, paper_id: str, run_id: str):
        return gui_copilot.execute_copilot_run(
            paper_id,
            run_id,
            get_record_func=self._get_record_getter(),
            memory_root=self._memory_root_getter(),
            invoke_annotation_agent_func=self._invoke_annotation_agent_getter(),
        )

    def resume_active_copilot_runs(self) -> dict[str, int]:
        return gui_copilot.resume_active_copilot_runs(
            indexed_records_func=self._indexed_records_getter(),
            memory_root=self._memory_root_getter(),
            timeout_seconds=self._timeout_seconds_getter(),
            spawn_worker=self._spawn_worker_getter(),
        )


class AnnotationFacade:
    def __init__(self, *, memory_root_getter: Callable[[], Any]) -> None:
        self._memory_root_getter = memory_root_getter

    def load_paper_annotations(self, record: Any) -> list[dict[str, object]]:
        return gui_annotations.load_paper_annotations(record, self._memory_root_getter())

    def annotation_file_path(self, record: Any, annotation_id: str):
        return gui_annotations.annotation_file_path(record, self._memory_root_getter(), annotation_id)

    def load_annotation(self, record: Any, annotation_id: str):
        return gui_annotations.load_annotation(record, self._memory_root_getter(), annotation_id)

    def create_annotation(self, record: Any, payload: dict[str, object]):
        return gui_annotations.create_annotation(record, self._memory_root_getter(), payload)

    def append_annotation_comment(self, record: Any, annotation_id: str, payload: dict[str, object]):
        return gui_annotations.append_annotation_comment(record, self._memory_root_getter(), annotation_id, payload)

    def update_annotation_comment(self, record: Any, annotation_id: str, comment_id: str, payload: dict[str, object]):
        return gui_annotations.update_annotation_comment(record, self._memory_root_getter(), annotation_id, comment_id, payload)

    def update_annotation(self, record: Any, annotation_id: str, payload: dict[str, object]):
        return gui_annotations.update_annotation(record, self._memory_root_getter(), annotation_id, payload)

    def delete_annotation(self, record: Any, annotation_id: str):
        return gui_annotations.delete_annotation(record, self._memory_root_getter(), annotation_id)
