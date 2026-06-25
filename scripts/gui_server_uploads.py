from __future__ import annotations

from typing import Any, Callable

import gui_app_settings
import gui_upload_tasks
import gui_zotero


class UploadFacade:
    def __init__(
        self,
        *,
        store_getter: Callable[[], Any],
        detect_capabilities_getter: Callable[[], Callable[[], dict[str, object]]],
        current_timestamp_iso_getter: Callable[[], Callable[[], str]],
        server_instance_id_getter: Callable[[], str],
        is_process_alive_getter: Callable[[], Callable[[int], bool]],
        run_upload_task_getter: Callable[[], Callable[[str, Any], None]],
        create_upload_task_from_path_getter: Callable[[], Callable[[Any, str | None], dict[str, object]]],
        import_lock_getter: Callable[[], Any],
    ) -> None:
        self._store_getter = store_getter
        self._detect_capabilities_getter = detect_capabilities_getter
        self._current_timestamp_iso_getter = current_timestamp_iso_getter
        self._server_instance_id_getter = server_instance_id_getter
        self._is_process_alive_getter = is_process_alive_getter
        self._run_upload_task_getter = run_upload_task_getter
        self._create_upload_task_from_path_getter = create_upload_task_from_path_getter
        self._import_lock_getter = import_lock_getter

    def ensure_upload_ready(self, settings: dict[str, object] | None = None) -> None:
        gui_app_settings.ensure_upload_ready(
            detect_capabilities_func=self._detect_capabilities_getter(),
            settings=settings,
        )

    def import_zotero_paper(
        self,
        attachment_key: str,
        *,
        client=None,
        store: Any | None = None,
    ) -> dict[str, object]:
        return gui_zotero.import_zotero_paper(
            attachment_key,
            client=client,
            store=store or self._store_getter(),
            import_lock=self._import_lock_getter(),
            create_upload_task_from_path=self._create_upload_task_from_path_getter(),
            current_timestamp_iso=self._current_timestamp_iso_getter(),
        )

    def retry_upload_task(self, task_id: str) -> dict[str, object]:
        return gui_upload_tasks.retry_upload_task(
            task_id,
            store=self._store_getter(),
            server_instance_id=self._server_instance_id_getter(),
            current_timestamp_iso=self._current_timestamp_iso_getter(),
            is_process_alive=self._is_process_alive_getter(),
            run_upload_task_func=self._run_upload_task_getter(),
        )
