"""在 Spyder、命令行或 PyInstaller 打包后的可执行文件中启动 ModelLab。"""

import multiprocessing
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

IS_FROZEN = getattr(sys, "frozen", False)
if IS_FROZEN:
    BUNDLE_ROOT = Path(getattr(sys, "_MEIPASS")).resolve()
    APP_ROOT = Path(sys.executable).resolve().parent
else:
    BUNDLE_ROOT = Path(__file__).resolve().parent
    APP_ROOT = BUNDLE_ROOT
    backend_str = str(BUNDLE_ROOT / "backend")
    if backend_str not in sys.path:
        sys.path.insert(0, backend_str)

HOST = "127.0.0.1"
PORT = 8000
URL = f"http://{HOST}:{PORT}"


def find_python() -> str:
    """优先使用项目虚拟环境中的 Python，便于在 Spyder 默认环境中直接运行。"""
    candidates = [
        APP_ROOT / ".venv" / "bin" / "python",
        APP_ROOT / ".venv" / "Scripts" / "python.exe",
    ]
    for path in candidates:
        if path.exists():
            return str(path)
    return sys.executable


def is_port_in_use(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def wait_until_ready(
    url: str, processes: list[subprocess.Popen], timeout: float = 20.0
) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if any(p.poll() is not None for p in processes):
            return False
        try:
            with urllib.request.urlopen(f"{url}/api/health", timeout=1.0) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.2)
    return False


def _run_api_process() -> None:
    import uvicorn
    from modellab.api import app

    uvicorn.run(app, host=HOST, port=PORT, log_level="info")


def _run_worker_process() -> None:
    from modellab.worker import main as worker_main

    worker_main()


def _run_local_solve(args: list[str]) -> None:
    if len(args) != 3:
        raise SystemExit("用法: --local-run <script> <result> <limit>")
    from modellab.local_runner import run_script

    run_script(args[0], args[1], args[2])


def main() -> None:
    if len(sys.argv) >= 2:
        mode = sys.argv[1]
        if mode == "--api":
            _run_api_process()
            return
        if mode == "--worker":
            _run_worker_process()
            return
        if mode == "--local-run":
            _run_local_solve(sys.argv[2:])
            return

    os.chdir(APP_ROOT)
    if not (BUNDLE_ROOT / "frontend" / "dist" / "index.html").exists():
        raise SystemExit("缺少 frontend/dist/index.html，请重新完整解压 ModelLab 安装包。")

    if is_port_in_use(HOST, PORT):
        try:
            with urllib.request.urlopen(f"{URL}/api/health", timeout=1.5) as resp:
                data = resp.read().decode("utf-8", errors="ignore")
                if resp.status == 200 and "database" in data:
                    print(f"检测到 ModelLab 已在运行 ({URL})，直接为你打开浏览器。", flush=True)
                    webbrowser.open(URL)
                    return
        except Exception:
            pass
        raise SystemExit(
            f"端口 {PORT} 已被其他程序占用，请先关闭占用 {PORT} 端口的程序后再启动 ModelLab。"
        )

    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"

    if IS_FROZEN:
        api_cmd = [sys.executable, "--api"]
        worker_cmd = [sys.executable, "--worker"]
        print("正在启动 ModelLab 独立版...", flush=True)
    else:
        python_exe = find_python()
        backend_dir = str(BUNDLE_ROOT / "backend")
        env["PYTHONPATH"] = (
            f"{backend_dir}{os.pathsep}{env['PYTHONPATH']}"
            if env.get("PYTHONPATH")
            else backend_dir
        )
        api_cmd = [
            python_exe,
            "-m",
            "uvicorn",
            "modellab.api:app",
            "--host",
            HOST,
            "--port",
            str(PORT),
        ]
        worker_cmd = [python_exe, "-m", "modellab.worker"]
        print(f"正在使用 {python_exe} 启动 ModelLab...", flush=True)

    processes: list[subprocess.Popen] = []

    def handle_sigterm(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, handle_sigterm)

    try:
        processes.append(subprocess.Popen(api_cmd, cwd=APP_ROOT, env=env))
        processes.append(subprocess.Popen(worker_cmd, cwd=APP_ROOT, env=env))

        if wait_until_ready(URL, processes):
            print(f"ModelLab 已就绪: {URL}", flush=True)
            print("关闭本窗口（或按 Ctrl+C）即可安全退出服务。", flush=True)
            webbrowser.open(URL)
        elif all(p.poll() is None for p in processes):
            print(f"服务启动中，请稍候访问: {URL}", flush=True)

        while all(p.poll() is None for p in processes):
            time.sleep(0.5)
        for p in processes:
            if p.returncode:
                raise SystemExit(p.returncode)
    except KeyboardInterrupt:
        print("\n正在关闭 ModelLab...", flush=True)
    finally:
        for p in processes:
            if p.poll() is None:
                p.terminate()
        for p in processes:
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()
        print("ModelLab 已停止。", flush=True)


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
