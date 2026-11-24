"""Real local subprocesses: solve, cancellation, hard timeout and parent pipe EOF."""

import json
import subprocess
from pathlib import Path
import time
import pytest
from modellab import worker
from modellab.storage import transaction, home
from modellab.compiler import canonical
from test_api import client, connect_workspace, create, save
from test_math import fixture


def queued(c, name="production"):
    connect_workspace(c)
    sid = create(c)
    if name == "assignment":
        r = c.post(
            "/api/submissions", json={"title": "指派", "example_id": "assignment"}
        ).json()
        rid = r["revision"]["id"]
    else:
        rid = save(c, sid, model=fixture(name)).json()["id"]
    assert c.post("/api/revisions/" + rid + "/confirm", json={}).status_code == 200
    with transaction() as db:
        db.execute(
            "INSERT OR REPLACE INTO runtime VALUES (?,?,?)",
            ("worker", canonical(dict(runner=True, runner_mode="local")), time.time()),
        )
    job = c.post(
        "/api/revisions/" + rid + "/runs",
        json={"request_key": "local-" + name + "-123456"},
    ).json()
    return worker.claim("solve")


@pytest.mark.parametrize(
    "name,status,value",
    [
        ("production", "optimal", 10),
        ("production_lp", "optimal", 32 / 3),
        ("free_variable", "optimal", -3),
        ("infeasible", "infeasible", None),
        ("unbounded", "unbounded", None),
        ("assignment", "optimal", 9),
    ],
)
def test_real_api_worker_local_solve(client, name, status, value, monkeypatch):
    monkeypatch.setenv("SOLVER_MODE", "local")

    def no_docker(*_):
        raise AssertionError("local path must not invoke Docker")

    monkeypatch.setattr(worker, "docker_ready", no_docker)
    monkeypatch.setattr(worker, "remove", no_docker)
    j = queued(client, name)
    worker.process(j)
    job = client.get("/api/jobs/" + j["id"]).json()
    assert job["state"] == "succeeded", job
    r = job["result"]
    assert r["termination"] == status and r["execution_mode"] == "local"
    if value is None:
        assert r["objective_value"] is None and r["variables"] is None
    else:
        assert r["objective_value"] == pytest.approx(value)
        assert r["validation"]["passed"]
    assert (home() / "jobs" / j["id"] / "input" / "solve.py").exists()


def sleeper(tmp_path):
    inp = tmp_path / "input"
    out = tmp_path / "output"
    inp.mkdir()
    out.mkdir()
    (inp / "solve.py").write_text(
        "import time\nprint('ready',flush=True)\ntime.sleep(60)\n"
    )
    p = worker.launch_local(inp, out, 30)
    assert p.stdout.readline() == b"ready\n"
    return p


def test_running_cancel_kills_process(client, tmp_path):
    j = queued(client)
    p = sleeper(tmp_path)
    try:
        client.post("/api/jobs/" + j["id"] + "/cancel", json={})
        assert worker.monitor(p, j["id"], "local", 30) == "cancelled"
        assert p.poll() is not None
    finally:
        worker.stop_process(p, j["id"], "local")
        p.stdout.close()


def test_hard_timeout_kills_real_process(client, tmp_path, monkeypatch):
    j = queued(client)
    p = sleeper(tmp_path)
    clock = iter([0, 41])
    monkeypatch.setattr(worker.time, "monotonic", lambda: next(clock, 41))
    try:
        assert worker.monitor(p, j["id"], "local", 30) == "timeout"
        assert p.poll() is not None
    finally:
        worker.stop_process(p, j["id"], "local")
        p.stdout.close()


def test_parent_lifetime_pipe_eof_stops_orphan(tmp_path):
    p = sleeper(tmp_path)
    try:
        p.stdin.close()  # Same EOF produced by worker process exit/SIGKILL.
        assert p.wait(timeout=5) < 0
    finally:
        worker.stop_process(p, "test", "local")
        p.stdout.close()


def test_local_environment_has_no_keys(tmp_path, monkeypatch):
    monkeypatch.setenv("MODEL_API_KEY", "never-inherit-this")
    inp = tmp_path / "input"
    out = tmp_path / "output"
    inp.mkdir()
    out.mkdir()
    (inp / "solve.py").write_text(
        "import os,json,sys,resource\nprint(json.dumps(dict(env=dict(os.environ),isolated=sys.flags.isolated,cpu=resource.getrlimit(resource.RLIMIT_CPU)[0],filesize=resource.getrlimit(resource.RLIMIT_FSIZE)[0])),flush=True)"
    )
    p = worker.launch_local(inp, out, 30)
    try:
        # Keep lifetime stdin open while collecting stdout; communicate() closes it.
        result = json.loads(p.stdout.readline())
        assert p.wait(timeout=5) == 0
        assert (
            "MODEL_API_KEY" not in result["env"] and "PYTHONPATH" not in result["env"]
        )
        assert result["isolated"] == 1 and result["cpu"] == 40
        assert result["filesize"] == 10 * 1024 * 1024
    finally:
        worker.stop_process(p, "test", "local")
        p.stdout.close()


def test_local_capability_without_docker(monkeypatch):
    monkeypatch.setenv("SOLVER_MODE", "local")
    monkeypatch.setattr(
        worker,
        "docker_ready",
        lambda: (_ for _ in ()).throw(AssertionError("Docker is not needed")),
    )
    assert worker.runner_ready() == (True, "")
    assert not worker.runner_ready("bad-mode")[0]
