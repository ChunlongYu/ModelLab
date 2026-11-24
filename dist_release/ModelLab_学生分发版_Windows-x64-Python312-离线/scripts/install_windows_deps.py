"""Install the student runtime in the project virtual environment."""

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def install(offline: bool) -> int:
    env = {key: value for key, value in os.environ.items() if not key.upper().startswith("PIP_")}
    env["PIP_CONFIG_FILE"] = os.devnull
    pip = [
        sys.executable, "-I", "-m", "pip", "--disable-pip-version-check",
        "--no-input", "install", "-r", "requirements.txt",
    ]
    links = ["--find-links", "wheelhouse"] if (ROOT / "wheelhouse").is_dir() else []

    print("正在检查项目 .venv 中已安装的依赖及随包 wheelhouse …", flush=True)
    local = subprocess.run(
        pip + ["--no-index", "--only-binary=:all:"] + links, cwd=ROOT, env=env,
    )
    if local.returncode == 0:
        return 0
    if offline:
        print(
            "[错误] 离线安装失败，未尝试联网。请检查上方报错；"
            "确认 ZIP 已完整解压，并使用 64 位 CPython 3.12 和随包 wheelhouse。",
            file=sys.stderr,
        )
        return local.returncode

    print("本地无法完成安装；将保留本地 wheel 候选，并尝试从 PyPI 补齐依赖 …", flush=True)
    online = subprocess.run(
        pip + ["--index-url", "https://pypi.org/simple"] + links, cwd=ROOT, env=env,
    )
    if online.returncode:
        print("[错误] 联网安装也未完成。请检查网络、Python 版本及上方 pip 报错。", file=sys.stderr)
    return online.returncode


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true", help="禁止联网回退")
    return install(parser.parse_args().offline)


if __name__ == "__main__":
    raise SystemExit(main())
