import importlib.util
from pathlib import Path
from subprocess import CompletedProcess

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "install_windows_deps.py"


@pytest.mark.parametrize(
    ("offline", "local_status", "online_status", "expected_calls", "expected_status"),
    [
        (False, 0, 0, 1, 0),
        (True, 1, 0, 1, 1),
        (False, 1, 0, 2, 0),
        (False, 1, 2, 2, 2),
    ],
)
def test_local_first_install(
    tmp_path, monkeypatch, offline, local_status, online_status, expected_calls, expected_status,
):
    spec = importlib.util.spec_from_file_location("install_windows_deps", SCRIPT)
    installer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(installer)
    monkeypatch.setattr(installer, "ROOT", tmp_path)
    (tmp_path / "wheelhouse").mkdir()
    monkeypatch.setenv("PIP_EXTRA_INDEX_URL", "https://example.invalid/simple")
    calls = []

    def run(command, *, cwd, env):
        assert cwd == tmp_path
        assert "PIP_EXTRA_INDEX_URL" not in env
        assert env["PIP_CONFIG_FILE"] == installer.os.devnull
        assert "--upgrade" not in command
        assert "--disable-pip-version-check" in command
        assert command[command.index("--find-links") + 1] == "wheelhouse"
        calls.append(command)
        return CompletedProcess(command, local_status if len(calls) == 1 else online_status)

    monkeypatch.setattr(installer.subprocess, "run", run)
    assert installer.install(offline) == expected_status
    assert len(calls) == expected_calls
    assert "--no-index" in calls[0] and "--only-binary=:all:" in calls[0]
    if len(calls) == 2:
        assert "--no-index" not in calls[1]
        assert calls[1][calls[1].index("--index-url") + 1] == "https://pypi.org/simple"
