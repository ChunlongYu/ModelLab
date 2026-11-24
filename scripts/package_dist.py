"""Build the student ZIP with a Windows x64 CPython 3.12 wheelhouse."""

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "dist_release"
STAGE_NAME = "ModelLab_学生分发版_Windows-x64-Python312-离线"
PUBLIC_INDEXES = (
    "https://pypi.org/simple",
    "https://pypi.tuna.tsinghua.edu.cn/simple",
)
UV_TARGET = [
    "--python-version", "3.12", "--python-platform", "x86_64-pc-windows-msvc",
    "--only-binary", ":all:",
]

INCLUDE_FILES = [
    "main.py",
    "requirements.txt",
    "start_windows.bat",
    "安装依赖.bat",
    "scripts/install_windows_deps.py",
    "start_mac.command",
    "Windows_学生启动说明.txt",
    ".gitattributes",
    "README.md",
    "THIRD_PARTY_NOTICES.md",
]

INCLUDE_DIRS = [
    "backend",
]

# Only shipped example inputs, not whatever else has been saved in fixtures.
FIXTURE_FILES = [
    "assignment.json", "assignment_data.json", "blending_oil.json", "data_template.json",
    "facility_location.json", "free_variable.json", "infeasible.json", "lot_sizing.json",
    "production.json", "production_lp.json", "unbounded.json", "workforce_shift.json",
]


def ignore_junk(_dir, names):
    ignored = set()
    for name in names:
        if name in (
            "__pycache__",
            ".DS_Store",
            ".pytest_cache",
            ".ruff_cache",
            ".runtime",
            ".env",
            "node_modules",
        ) or name.endswith((".pyc", ".pyo")):
            ignored.add(name)
    return ignored


def build_wheels(work: Path, wheels: Path, index: str):
    local_uv = ROOT / ".tools" / ("uv.exe" if os.name == "nt" else "uv")
    uv = str(local_uv) if local_uv.is_file() else shutil.which("uv")
    if not uv:
        raise SystemExit("未找到 uv，请先安装 uv 再生成离线分发包。")
    env = {key: value for key, value in os.environ.items() if not key.upper().startswith(("UV_", "PIP_"))}
    env.update(PIP_CONFIG_FILE=os.devnull, UV_PYTHON_DOWNLOADS="never", UV_HTTP_TIMEOUT="25")

    requirements = ROOT / "requirements.txt"
    windows_compat = work / "windows-compat.txt"
    # Recent Click no longer requires Colorama; supply it for compatible older Click releases.
    windows_compat.write_text('colorama>=0.4.6,<1 ; sys_platform == "win32"\n', encoding="ascii")
    pins = work / "resolved.txt"
    uv_cmd = [uv, "--no-config", "--no-cache", "--no-progress"]
    subprocess.run(
        uv_cmd + ["pip", "compile", *UV_TARGET, "--default-index", index, "--generate-hashes",
                  "--no-header", "--no-annotate", "-o", str(pins), str(requirements), str(windows_compat)],
        cwd=ROOT, env=env, check=True,
    )
    # uv evaluated target markers; only use pip to fetch these pinned artifacts, not to resolve.
    subprocess.run(
        [sys.executable, "-I", "-m", "pip", "--disable-pip-version-check", "--no-input",
         "--no-cache-dir", "download", "--index-url", index, "--only-binary=:all:",
         "--no-deps", "--require-hashes", "--platform", "win_amd64", "--python-version", "3.12",
         "--implementation", "cp", "--abi", "cp312", "--dest", str(wheels), "-r", str(pins)],
        cwd=ROOT, env=env, check=True,
    )
    if not any(wheels.glob("colorama-*.whl")) or not any(wheels.glob("highspy-*-win_amd64.whl")):
        raise RuntimeError("wheelhouse 缺少 Windows 兼容依赖 Colorama 或 HiGHS。")
    subprocess.run(
        uv_cmd + ["--offline", "pip", "install", *UV_TARGET, "--no-index", "--find-links", str(wheels),
                  "--target", str(work / "empty"), "--dry-run", "-r", str(requirements), "-r", str(windows_compat)],
        cwd=ROOT, env=env, check=True,
    )


def stage_app(stage: Path):
    for rel in INCLUDE_FILES + [f"fixtures/{name}" for name in FIXTURE_FILES]:
        src = ROOT / rel
        dst = stage / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if rel.endswith(".bat"):
            dst.write_bytes(src.read_text(encoding="utf-8").replace("\n", "\r\n").encode("utf-8"))
        else:
            shutil.copy2(src, dst)

    for rel in INCLUDE_DIRS:
        shutil.copytree(ROOT / rel, stage / rel, ignore=ignore_junk, symlinks=True)

    shutil.copytree(
        ROOT / "frontend" / "dist",
        stage / "frontend" / "dist",
        ignore=ignore_junk,
        symlinks=True,
    )

    forbidden = {".runtime", ".venv", "model-service.json"}
    for item in stage.rglob("*"):
        if (item.is_symlink() or item.name in forbidden or item.name.startswith(".env")
                or item.suffix.lower() in {".sqlite", ".sqlite3", ".db", ".pem", ".key"}):
            raise RuntimeError(f"发现敏感或运行时文件，已中止打包：{item}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--index-url", choices=PUBLIC_INDEXES, default=PUBLIC_INDEXES[0])
    parser.add_argument("--name", default=STAGE_NAME, help="新 ZIP 和其中顶层目录的名称（不带 .zip）")
    args = parser.parse_args()
    if not re.fullmatch(r"ModelLab_[\w-]+", args.name):
        parser.error("--name 必须以 ModelLab_ 开头，只能包含字母、数字、下划线和连字符。")
    if not (ROOT / "frontend" / "dist" / "index.html").is_file():
        raise SystemExit("未找到 frontend/dist/index.html，请先运行 make build")
    zip_path = OUT_DIR / f"{args.name}.zip"
    if zip_path.exists():
        raise SystemExit(f"分发包已存在，不会覆盖：{zip_path}。可用 --name 指定新名称。")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".offline-build-", dir=OUT_DIR) as scratch:
        work = Path(scratch)
        stage = work / args.name
        stage.mkdir()
        stage_app(stage)
        build_wheels(work, stage / "wheelhouse", args.index_url)
        temp_zip = work / "release.zip"
        with zipfile.ZipFile(temp_zip, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for file in sorted(stage.rglob("*")):
                if file.is_file():
                    archive.write(file, file.relative_to(work))
        with zipfile.ZipFile(temp_zip) as archive:
            bad_entry = archive.testzip()
            if bad_entry:
                raise RuntimeError(f"ZIP 完整性检查失败：{bad_entry}")
        os.link(temp_zip, zip_path)  # Publish only a complete ZIP, without replacing an existing file.
    size_mb = zip_path.stat().st_size / (1024 * 1024)
    print(f"已生成学生离线分发包：{zip_path} ({size_mb:.2f} MiB)")


if __name__ == "__main__":
    main()