"""Local-only launcher; cleanup both child processes on exit."""

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

root = Path(__file__).resolve().parents[1]
os.chdir(root)
if not (root / "frontend/dist/index.html").exists():
    raise SystemExit("请先运行 make setup-app 或 make build")
processes = []


def stop(*_):
    raise KeyboardInterrupt


signal.signal(signal.SIGTERM, stop)
try:
    processes.append(
        subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "modellab.api:app",
                "--host",
                "127.0.0.1",
                "--port",
                "8000",
            ]
        )
    )
    processes.append(subprocess.Popen([sys.executable, "-m", "modellab.worker"]))
    print("ModelLab: http://127.0.0.1:8000  /  Ctrl+C 关闭 API 与 worker", flush=True)
    while all(p.poll() is None for p in processes):
        time.sleep(0.5)
except KeyboardInterrupt:
    pass
finally:
    for p in processes:
        if p.poll() is None:
            p.terminate()
    for p in processes:
        try:
            p.wait(timeout=15)
        except subprocess.TimeoutExpired:
            p.kill()
            p.wait()
