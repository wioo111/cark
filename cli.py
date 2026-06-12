import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SCRIPTS_DIR = ROOT / "scripts"
CONFIG_DIR = ROOT / "config"
VENV_SCRIPTS = ROOT / ".venv" / "Scripts"
PROXY_ENV_KEYS = (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
)

CONFIG_TEMPLATES = {
    "pdf": ("pdf_docx_pipeline.example.json", "pdf_docx_pipeline.json"),
    "docx": ("docx_pipeline.example.json", "docx_pipeline.json"),
    "replacements": ("feishu_text_replacements.example.json", "feishu_text_replacements.json"),
    "mineru": ("mineru.example.json", "mineru.json"),
}


def build_direct_network_env():
    env = os.environ.copy()
    for key in PROXY_ENV_KEYS:
        env.pop(key, None)

    # Force requests/httpx based tooling to bypass any machine-level proxy fallback.
    env["NO_PROXY"] = "*"
    env["no_proxy"] = "*"
    return env


def run_python_script(script_name, args):
    script_path = SCRIPTS_DIR / script_name
    if not script_path.exists():
        print(f"未找到脚本: {script_path}", file=sys.stderr)
        return 2

    command = [sys.executable, str(script_path), *args]
    return subprocess.call(command, cwd=str(ROOT), env=build_direct_network_env())


def add_publish_args(parser):
    parser.add_argument("--title", help="飞书文档标题。")
    parser.add_argument("--config", help="JSON 配置文件路径。")
    parser.add_argument("--folder-token", help="飞书目标文件夹 token。")
    parser.add_argument("--app-id", help="飞书 app id。")
    parser.add_argument("--app-secret", help="飞书 app secret。")
    parser.add_argument(
        "--image-mode",
        choices=["strip", "note", "keep"],
        help="图片处理策略。",
    )
    parser.add_argument("--linearized-output", help="线性化 Markdown 输出路径。")
    parser.add_argument("--prepared-output", help="飞书导入 Markdown 输出路径。")
    parser.add_argument("--replacements-file", help="文本替换规则 JSON 文件。")
    parser.add_argument(
        "--replacement-block-limit",
        type=int,
        help="文本替换最多检查的块数。",
    )
    parser.add_argument(
        "--prepare-only",
        action="store_true",
        help="只生成本地 Markdown，不调用飞书 API。",
    )
    parser.add_argument(
        "--translate",
        action="store_true",
        help="生成中英双语版本。",
    )


def add_config_subcommands(subparsers):
    config_parser = subparsers.add_parser(
        "config",
        help="初始化或检查配置。",
    )
    config_subparsers = config_parser.add_subparsers(dest="config_command", required=True)

    init_parser = config_subparsers.add_parser(
        "init",
        help="从模板生成配置文件。",
    )
    init_parser.add_argument(
        "--profile",
        choices=["pdf", "docx", "replacements", "mineru", "all"],
        default="all",
        help="要初始化的配置模板。",
    )
    init_parser.add_argument(
        "--force",
        action="store_true",
        help="覆盖已存在的配置文件。",
    )
    init_parser.set_defaults(handler=handle_config_init)

    check_parser = config_subparsers.add_parser(
        "check",
        help="检查当前环境与配置是否齐全。",
    )
    check_parser.add_argument(
        "--backend",
        choices=["local", "cloud"],
        default="cloud",
        help="按指定后端检查依赖，默认 cloud。",
    )
    check_parser.add_argument(
        "--translate",
        action="store_true",
        help="额外检查翻译相关环境变量。",
    )
    check_parser.add_argument(
        "--prepare-only",
        action="store_true",
        help="只检查本地产物链路，跳过飞书凭据。",
    )
    check_parser.add_argument(
        "--json",
        action="store_true",
        help="以 JSON 输出检查结果。",
    )
    check_parser.set_defaults(handler=handle_config_check)


def build_parser():
    parser = argparse.ArgumentParser(
        prog="cark",
        description="cark 统一命令行入口。",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    doctor_parser = subparsers.add_parser(
        "doctor",
        help="运行环境体检。",
    )
    doctor_parser.set_defaults(handler=handle_doctor)

    gui_parser = subparsers.add_parser(
        "gui",
        help="启动本地阅读器 GUI。",
    )
    gui_parser.add_argument("--host", default="127.0.0.1", help="GUI 监听地址。默认 127.0.0.1。")
    gui_parser.add_argument("--port", type=int, default=8765, help="GUI 端口。默认 8765。")
    gui_parser.add_argument(
        "--no-browser",
        action="store_true",
        help="只启动本地服务，不自动打开浏览器。",
    )
    gui_parser.set_defaults(handler=handle_gui)

    upload_parser = subparsers.add_parser(
        "upload",
        help="从 PDF 跑完整管线。",
    )
    upload_parser.add_argument("pdf", help="待处理 PDF 路径。")
    upload_parser.add_argument(
        "--backend",
        choices=["local", "cloud"],
        help="解析后端：local 或 cloud。",
    )
    upload_parser.add_argument(
        "--model-version",
        choices=["pipeline", "vlm"],
        help="云后端模型版本。",
    )
    upload_parser.add_argument(
        "--parse-method",
        choices=["auto", "txt", "ocr"],
        help="MinerU 解析模式。",
    )
    upload_parser.add_argument("--api-token", help="MinerU 云 API token。")
    upload_parser.add_argument("--mineru-output-dir", help="MinerU 输出目录。")
    upload_parser.add_argument(
        "--reuse-existing-parse",
        action="store_true",
        help="复用已有解析结果。",
    )
    add_publish_args(upload_parser)
    upload_parser.set_defaults(handler=handle_upload)

    docx_parser = subparsers.add_parser(
        "docx",
        help="从 content_list.json 继续生成飞书 docx。",
    )
    docx_parser.add_argument("content_list_json", help="MinerU 产出的 content_list.json 路径。")
    add_publish_args(docx_parser)
    docx_parser.set_defaults(handler=handle_docx)

    add_config_subcommands(subparsers)

    return parser


def handle_doctor(_args):
    return run_python_script("preflight.py", [])


def handle_gui(args):
    forwarded = ["--host", args.host, "--port", str(args.port)]
    if args.no_browser:
        forwarded.append("--no-browser")
    return run_python_script("gui_server.py", forwarded)


def forward_common_publish_args(args):
    forwarded = []
    option_pairs = [
        ("title", "--title"),
        ("config", "--config"),
        ("folder_token", "--folder-token"),
        ("app_id", "--app-id"),
        ("app_secret", "--app-secret"),
        ("image_mode", "--image-mode"),
        ("linearized_output", "--linearized-output"),
        ("prepared_output", "--prepared-output"),
        ("replacements_file", "--replacements-file"),
    ]

    for attr_name, flag in option_pairs:
        value = getattr(args, attr_name, None)
        if value not in (None, ""):
            forwarded.extend([flag, str(value)])

    if getattr(args, "replacement_block_limit", None) is not None:
        forwarded.extend(["--replacement-block-limit", str(args.replacement_block_limit)])
    if getattr(args, "prepare_only", False):
        forwarded.append("--prepare-only")
    if getattr(args, "translate", False):
        forwarded.append("--translate")
    return forwarded


def handle_upload(args):
    forwarded = ["--input-pdf", args.pdf]
    option_pairs = [
        ("backend", "--backend"),
        ("model_version", "--model-version"),
        ("parse_method", "--parse-method"),
        ("api_token", "--api-token"),
        ("mineru_output_dir", "--mineru-output-dir"),
    ]

    for attr_name, flag in option_pairs:
        value = getattr(args, attr_name)
        if value not in (None, ""):
            forwarded.extend([flag, str(value)])

    if args.reuse_existing_parse:
        forwarded.append("--reuse-existing-parse")

    forwarded.extend(forward_common_publish_args(args))
    return run_python_script("pdf_to_feishu_docx.py", forwarded)


def handle_docx(args):
    forwarded = ["--content-list-json", args.content_list_json]
    forwarded.extend(forward_common_publish_args(args))
    return run_python_script("content_list_to_feishu_docx.py", forwarded)


def copy_template(profile, force):
    template_name, output_name = CONFIG_TEMPLATES[profile]
    source = CONFIG_DIR / template_name
    target = CONFIG_DIR / output_name

    if not source.exists():
        raise FileNotFoundError(f"未找到模板文件: {source}")

    if target.exists() and not force:
        return {"profile": profile, "path": str(target), "status": "skip"}

    shutil.copyfile(source, target)
    return {"profile": profile, "path": str(target), "status": "written"}


def handle_config_init(args):
    profiles = list(CONFIG_TEMPLATES.keys()) if args.profile == "all" else [args.profile]
    results = [copy_template(profile, args.force) for profile in profiles]

    for item in results:
        if item["status"] == "written":
            print(f"[OK] 已生成 {item['profile']} 配置: {item['path']}")
        else:
            print(f"[SKIP] 已存在，未覆盖: {item['path']}")
    return 0


def check_path_exists(path):
    return path.exists()


def handle_config_check(args):
    report = {
        "backend": args.backend,
        "prepare_only": args.prepare_only,
        "translate": args.translate,
        "checks": [],
    }

    def add_check(name, ok, detail, required=True):
        report["checks"].append(
            {
                "name": name,
                "ok": ok,
                "required": required,
                "detail": detail,
            }
        )

    add_check(
        "python",
        True,
        sys.executable,
        required=True,
    )
    add_check(
        "venv_scripts",
        check_path_exists(VENV_SCRIPTS),
        str(VENV_SCRIPTS),
        required=False,
    )
    add_check(
        "pdf_config_template",
        check_path_exists(CONFIG_DIR / "pdf_docx_pipeline.example.json"),
        str(CONFIG_DIR / "pdf_docx_pipeline.example.json"),
        required=False,
    )

    if args.backend == "cloud":
        ok = bool(os.getenv("MINERU_API_TOKEN"))
        add_check("MINERU_API_TOKEN", ok, "云后端需要该环境变量。", required=True)
    else:
        mineru_exe = VENV_SCRIPTS / "mineru.exe"
        add_check("mineru.exe", check_path_exists(mineru_exe), str(mineru_exe), required=True)

    if not args.prepare_only:
        add_check("FEISHU_APP_ID", bool(os.getenv("FEISHU_APP_ID")), "飞书 app id。", required=True)
        add_check("FEISHU_APP_SECRET", bool(os.getenv("FEISHU_APP_SECRET")), "飞书 app secret。", required=True)
        add_check("FEISHU_FOLDER_TOKEN", bool(os.getenv("FEISHU_FOLDER_TOKEN")), "飞书目标文件夹 token。", required=True)

    if args.translate:
        add_check("OPENAI_API_KEY", bool(os.getenv("OPENAI_API_KEY")), "翻译需要该环境变量。", required=True)
        add_check(
            "OPENAI_BASE_URL",
            bool(os.getenv("OPENAI_BASE_URL")),
            "未设置时脚本会默认使用 https://api.deepseek.com/v1 。",
            required=False,
        )

    failed_required = [item for item in report["checks"] if item["required"] and not item["ok"]]

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"backend: {args.backend}")
        for item in report["checks"]:
            status = "OK" if item["ok"] else ("WARN" if not item["required"] else "MISSING")
            print(f"[{status}] {item['name']}: {item['detail']}")

    return 1 if failed_required else 0


def main():
    parser = build_parser()
    args = parser.parse_args()
    return args.handler(args)


if __name__ == "__main__":
    raise SystemExit(main())
