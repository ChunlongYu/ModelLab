import io
import json
import os
import subprocess
import time
from pathlib import Path
import pytest
from modellab import worker
from modellab.providers import transcribe, normalize_refs
from modellab.storage import transaction, connect, home
from modellab.compiler import canonical
from test_api import client, connect_workspace, create, save, image


def test_container_command_is_restricted(tmp_path):
    c = worker.command("a" * 32, tmp_path / "input", tmp_path / "output", 30)
    for flag, val in [
        ("--network", "none"),
        ("--user", "65532:65532"),
        ("--cap-drop", "ALL"),
        ("--memory", "1g"),
        ("--pids-limit", "64"),
        ("--security-opt", "no-new-privileges"),
    ]:
        assert c[c.index(flag) + 1] == val
    assert "--read-only" in c
    assert len([x for x in c if x.startswith("type=bind")]) == 2
    assert not any("socket" in x or "API_KEY" in x for x in c)


def test_result_symlink_and_bad_schema(tmp_path):
    f = tmp_path / "result.json"
    f.symlink_to("/etc/hosts")
    with pytest.raises(OSError):
        worker.safe_result(f)
    f.unlink()
    f.write_text('{"termination":"optimal"}')
    with pytest.raises(RuntimeError):
        worker.safe_result(f)


def test_mock_transcription_adoption_and_stale_response(client, monkeypatch):
    monkeypatch.setenv("ALLOW_MOCK", "1")
    c = client
    connect_workspace(c)
    sid = create(c)
    aid = c.post(
        "/api/submissions/" + sid + "/assets",
        files=[("files", ("a.png", image(), "image/png"))],
    ).json()[0]["id"]
    assets = [dict(id=aid, rotation=90)]
    rid = save(c, sid, assets=assets).json()["id"]
    with transaction() as db:
        db.execute(
            "INSERT INTO runtime VALUES (?,?,?)",
            ("worker", canonical(dict(runner=False)), time.time()),
        )
    r = c.post(
        "/api/revisions/" + rid + "/transcriptions",
        json={"request_key": "transcript-1", "provider": "mock"},
    )
    assert r.status_code == 202
    j = worker.claim("transcribe")
    worker.process(j)
    result = c.get("/api/jobs/" + r.json()["id"]).json()
    assert result["state"] == "succeeded"
    assert result["result"]["provider"] == "mock"
    body = dict(
        expected_version=2,
        model=result["result"]["symbolic_model_draft"],
        data={},
        assets=assets,
        problem_text="",
    )
    adopted = c.post("/api/jobs/" + j["id"] + "/adopt", json=body)
    assert adopted.status_code == 200
    assert (
        c.post(
            "/api/revisions/" + adopted.json()["id"] + "/confirm", json={}
        ).status_code
        == 422
    )
    assert c.post("/api/jobs/" + j["id"] + "/adopt", json=body).status_code == 409
    s = c.get("/api/submissions/" + sid).json()
    assert s["version"] == 3
    assert s["revisions"][1]["assets"] == assets


def test_recover_does_not_retry_paid_jobs(client, monkeypatch):
    c = client
    connect_workspace(c)
    sid = create(c)
    rid = save(c, sid).json()["id"]
    with transaction() as db:
        db.execute(
            "INSERT INTO jobs(id,revision_id,actor,kind,state,request_key,payload,created) SELECT ?,?,owner_id,?,?,?,?,? FROM submissions WHERE id=?",
            (
                "x" * 32,
                rid,
                "transcribe",
                "running",
                "recover-123",
                "{}",
                time.time(),
                sid,
            ),
        )
    worker.recover()
    with connect() as db:
        j = db.execute("SELECT * FROM jobs").fetchone()
    assert j["state"] == "interrupted"


def test_rotation_source_coordinates():
    m = {
        "variables": [],
        "parameters": [],
        "constraints": [],
        "objective": {
            "source_refs": [dict(image_id="a", bbox=[0, 0.1, 0.3, 0.4], order=0)]
        },
    }
    r = normalize_refs(m, [dict(id="a", rotation=90)])["objective"]["source_refs"][0]
    assert r["bbox"] == pytest.approx([0.1, 0.7, 0.4, 1])


@pytest.mark.docker
def test_real_docker_runner(tmp_path):
    ready, reason = worker.docker_ready()
    if not ready:
        pytest.skip(reason)
    from modellab.compiler import compile_model
    from modellab.exporter import write_bundle
    from modellab.validation import validate_result
    from test_math import fixture

    ir = compile_model(fixture("production"))
    inp = tmp_path / "input"
    out = tmp_path / "output"
    out.mkdir()
    out.chmod(0o777)
    write_bundle(ir, inp)
    r = subprocess.run(
        worker.command("test" + str(os.getpid()), inp, out, 30),
        capture_output=True,
        timeout=45,
    )
    assert r.returncode == 0, r.stderr.decode()
    result = worker.safe_result(out / "result.json")
    assert result["objective_value"] == 10
    assert validate_result(ir, result)["passed"]


@pytest.mark.llm
def test_real_llm_transcription(tmp_path, monkeypatch):
    if not all(os.getenv(k) for k in ("MODEL_ENDPOINT", "MODEL_NAME", "MODEL_API_KEY")):
        pytest.skip("未配置真实 LLM 凭据")
    monkeypatch.setenv("MODELLAB_DATA_DIR", str(tmp_path))
    folder = tmp_path / "assets"
    folder.mkdir()
    source = Path(__file__).resolve().parents[1] / "fixtures/handwriting/clear.png"
    (folder / "sample").write_bytes(source.read_bytes())
    result = transcribe([dict(id="sample", rotation=0)], "生产计划。学生模型优先。")
    assert result["provider"] == "remote"
    assert result["symbolic_model_draft"]
    assert result["transcript"]


@pytest.mark.docker
def test_real_docker_isolation(tmp_path):
    ready, reason = worker.docker_ready()
    if not ready:
        pytest.skip(reason)
    inp = tmp_path / "input"
    out = tmp_path / "output"
    inp.mkdir()
    out.mkdir()
    out.chmod(0o777)
    # Only the test harness writes this probe, never an API caller.
    (inp / "solve.py").write_text("""import os,json,socket
from pathlib import Path
checks={'nonroot':os.getuid()!=0,'no_key':'MODEL_API_KEY' not in os.environ,'no_socket':not Path('/var/run/docker.sock').exists()}
for name,path in [('readonly_root','/probe'),('readonly_input','/input/probe')]:
 try:Path(path).write_text('forbidden');checks[name]=False
 except OSError:checks[name]=True
s=socket.socket();s.settimeout(2)
try:s.connect(('1.1.1.1',443));checks['no_network']=False
except OSError:checks['no_network']=True
finally:s.close()
Path('/output/result.json').write_text(json.dumps(checks))
""")
    r = subprocess.run(
        worker.command("probe" + str(os.getpid()), inp, out, 10),
        capture_output=True,
        timeout=20,
    )
    assert r.returncode == 0, r.stderr.decode()
    assert all(json.loads((out / "result.json").read_text()).values())


def test_diagnose_mock_and_remote_protocol(tmp_path, monkeypatch):
    import httpx
    from modellab.providers import diagnose

    monkeypatch.setenv("MODELLAB_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ALLOW_MOCK", "1")
    model = json.loads((Path(__file__).resolve().parents[1] / "fixtures/production.json").read_text())

    mock_res = diagnose(model, {}, "生产计划", provider="mock")
    assert mock_res["provider"] == "mock"
    assert len(mock_res["issues"]) == 1

    # Remote text-only model (e.g. DeepSeek with vision=False) should work for diagnose.
    monkeypatch.setenv("MODEL_ENDPOINT", "https://api.deepseek.com/v1")
    monkeypatch.setenv("MODEL_NAME", "deepseek-chat")
    monkeypatch.setenv("MODEL_API_KEY", "sk-test-secret")
    monkeypatch.setenv("MODEL_VISION", "0")

    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "summary": "模型整体结构完整。",
                                    "issues": [
                                        {
                                            "severity": "low",
                                            "category": "variable_domain",
                                            "target_id": "x",
                                            "title": "确认整数性",
                                            "detail": "x 当前为整数变量。",
                                            "suggestion": "如允许小数生产可改为连续变量。",
                                        }
                                    ],
                                }
                            )
                        }
                    }
                ]
            },
        )

    orig_client = httpx.Client
    monkeypatch.setattr(
        httpx,
        "Client",
        lambda **kw: orig_client(transport=httpx.MockTransport(handler), **kw),
    )
    remote_res = diagnose(model, {}, "生产计划", provider="remote")
    assert seen["url"] == "https://api.deepseek.com/v1/chat/completions"
    assert seen["auth"] == "Bearer sk-test-secret"
    assert remote_res["summary"] == "模型整体结构完整。"
    assert remote_res["issues"][0]["target_id"] == "x"


def test_generate_from_text_mock_and_remote(tmp_path, monkeypatch):
    import httpx
    from modellab.providers import generate_from_text

    monkeypatch.setenv("MODELLAB_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ALLOW_MOCK", "1")
    mock_res = generate_from_text("生产两种产品，最大化利润。", provider="mock")
    assert mock_res["provider"] == "mock"
    assert mock_res["symbolic_model_draft"]["objective"]["sense"] == "max"
    assert mock_res["unresolved_items"]

    monkeypatch.setenv("MODEL_ENDPOINT", "https://api.deepseek.com/v1")
    monkeypatch.setenv("MODEL_NAME", "deepseek-chat")
    monkeypatch.setenv("MODEL_API_KEY", "sk-test-secret")
    model = json.loads((Path(__file__).resolve().parents[1] / "fixtures/production.json").read_text())

    def handler(request):
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "summary": "已生成生产计划 MILP 草稿。",
                                    "symbolic_model_draft": model,
                                    "data": {},
                                    "unresolved_items": [],
                                }
                            )
                        }
                    }
                ]
            },
        )

    orig_client = httpx.Client
    monkeypatch.setattr(
        httpx,
        "Client",
        lambda **kw: orig_client(transport=httpx.MockTransport(handler), **kw),
    )
    remote_res = generate_from_text("生产两种产品，最大化利润。", provider="remote")
    assert remote_res["summary"] == "已生成生产计划 MILP 草稿。"
    assert remote_res["symbolic_model_draft"]["objective"]["id"] == "profit"

    from modellab.providers import _clean_symbol_subscripts

    sample = {
        "variables": [{"id": "x", "symbol": "x_i", "sets": ["I"]}],
        "parameters": [{"id": "yield", "symbol": "a_{i,j}", "sets": ["I", "J"]}],
    }
    _clean_symbol_subscripts(sample)
    assert sample["variables"][0]["symbol"] == "x"
    assert sample["parameters"][0]["symbol"] == "a"


def test_chat_draft_mock_and_remote(tmp_path, monkeypatch):
    import httpx
    from modellab.providers import chat_draft

    monkeypatch.setenv("MODELLAB_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ALLOW_MOCK", "1")
    model = json.loads((Path(__file__).resolve().parents[1] / "fixtures/production.json").read_text())

    qa_res = chat_draft("生产计划", model, {}, [], "为什么有两条约束？", provider="mock")
    assert qa_res["updated"] is False
    assert qa_res["symbolic_model_draft"] is None

    mod_res = chat_draft("生产计划", model, {}, [], "把变量改为整数", provider="mock")
    assert mod_res["updated"] is True
    assert all(v["domain"] == "integer" for v in mod_res["symbolic_model_draft"]["variables"])

    monkeypatch.setenv("MODEL_ENDPOINT", "https://api.deepseek.com/v1")
    monkeypatch.setenv("MODEL_NAME", "deepseek-chat")
    monkeypatch.setenv("MODEL_API_KEY", "sk-test-secret")

    def handler(request):
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "reply": "变量 x 表示生产数量，已补充中文说明。",
                                    "updated": False,
                                    "changes": [],
                                    "symbolic_model_draft": None,
                                    "data": None,
                                }
                            )
                        }
                    }
                ]
            },
        )

    orig_client = httpx.Client
    monkeypatch.setattr(
        httpx,
        "Client",
        lambda **kw: orig_client(transport=httpx.MockTransport(handler), **kw),
    )
    remote_res = chat_draft("生产计划", model, {}, [], "x 是什么含义？", provider="remote")
    assert remote_res["updated"] is False
    assert "生产数量" in remote_res["reply"]


def test_analyze_result_mock_and_remote(tmp_path, monkeypatch):
    import httpx
    from modellab.providers import analyze_result

    monkeypatch.setenv("MODELLAB_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ALLOW_MOCK", "1")
    model = json.loads((Path(__file__).resolve().parents[1] / "fixtures/production.json").read_text())
    solve_res = {
        "termination": "optimal",
        "objective_value": 10,
        "validation": {
            "variables": [
                {"id": "v_0", "source_id": "x", "label": "x", "value": 0},
                {"id": "v_1", "source_id": "y", "label": "y", "value": 2},
            ]
        },
    }
    mock_res = analyze_result("生产计划", model, {}, solve_res, "画柱状图", provider="mock")
    assert mock_res["charts"][0]["type"] == "bar"
    assert len(mock_res["tables"]) == 1

    monkeypatch.setenv("MODEL_ENDPOINT", "https://api.deepseek.com/v1")
    monkeypatch.setenv("MODEL_NAME", "deepseek-chat")
    monkeypatch.setenv("MODEL_API_KEY", "sk-test-secret")

    def handler(request):
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "summary": "建议生产 2 单位产品 y，总利润 10。",
                                    "highlights": ["工时约束处于紧平衡"],
                                    "tables": [
                                        {
                                            "title": "生产方案",
                                            "columns": ["产品", "产量"],
                                            "rows": [["x", 0], ["y", 2]],
                                        }
                                    ],
                                    "charts": [
                                        {
                                            "type": "pie",
                                            "title": "产量占比",
                                            "unit": "件",
                                            "data": [
                                                {"label": "x", "value": 0},
                                                {"label": "y", "value": 2},
                                            ],
                                        }
                                    ],
                                }
                            )
                        }
                    }
                ]
            },
        )

    orig_client = httpx.Client
    monkeypatch.setattr(
        httpx,
        "Client",
        lambda **kw: orig_client(transport=httpx.MockTransport(handler), **kw),
    )
    remote_res = analyze_result("生产计划", model, {}, solve_res, provider="remote")
    assert "总利润 10" in remote_res["summary"]
    assert remote_res["charts"][0]["type"] == "pie"


def test_compiler_harness_self_repair(tmp_path, monkeypatch):
    import httpx
    from modellab.providers import generate_from_text

    monkeypatch.setenv("MODELLAB_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("MODEL_ENDPOINT", "https://api.deepseek.com/v1")
    monkeypatch.setenv("MODEL_NAME", "deepseek-chat")
    monkeypatch.setenv("MODEL_API_KEY", "sk-test-secret")

    bad_model = json.loads((Path(__file__).resolve().parents[1] / "fixtures/production.json").read_text())
    # Introduce a compiler error: unknown symbol 'z' in objective
    bad_model["objective"]["expr"] = {"kind": "var", "id": "z", "indices": []}
    good_model = json.loads((Path(__file__).resolve().parents[1] / "fixtures/production.json").read_text())

    calls = []

    def handler(request):
        body = json.loads(request.content.decode())
        calls.append(body["messages"])
        chosen = bad_model if len(calls) == 1 else good_model
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "summary": "生成草稿。",
                                    "symbolic_model_draft": chosen,
                                    "data": {},
                                    "unresolved_items": [],
                                }
                            )
                        }
                    }
                ]
            },
        )

    orig_client = httpx.Client
    monkeypatch.setattr(
        httpx,
        "Client",
        lambda **kw: orig_client(transport=httpx.MockTransport(handler), **kw),
    )
    res = generate_from_text("生产计划。", provider="remote")
    assert len(calls) == 2
    assert "UNKNOWN_SYMBOL" in calls[1][-1]["content"]
    assert res["symbolic_model_draft"]["objective"]["expr"]["kind"] == "add"
