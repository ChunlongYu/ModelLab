import io
import json
import time
import zipfile
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from modellab.api import app
from modellab.storage import initialize, transaction
from modellab.compiler import canonical
from test_math import fixture


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("MODELLAB_DATA_DIR", str(tmp_path))
    for key in ("MODEL_API_KEY", "MODEL_ENDPOINT", "MODEL_NAME"):
        monkeypatch.delenv(key, raising=False)
    initialize()
    with TestClient(app) as c:
        yield c


def connect_workspace(c):
    r = c.get("/api/workspace")
    assert r.status_code == 200
    c.headers["X-CSRF-Token"] = r.json()["csrf"]
    return r.json()


def create(c):
    return c.post("/api/submissions", json={"title": "生产实验"}).json()["id"]


def save(c, sid, version=1, model=None, assets=[]):
    return c.post(
        "/api/submissions/" + sid + "/revisions",
        json=dict(
            expected_version=version,
            model=model or fixture("production"),
            data={},
            assets=assets,
            problem_text="这是原始题目",
        ),
    )


def image():
    b = io.BytesIO()
    Image.new("RGB", (100, 100), "white").save(b, format="PNG")
    return b.getvalue()


def test_no_login_and_removed_course_apis(client):
    c = client
    connect_workspace(c)
    assert create(c)
    for path in ("/api/auth/login", "/api/courses", "/api/assignments"):
        assert c.post(path, json={}).status_code in (404, 405)
    c.cookies.clear()
    connect_workspace(c)
    assert len(c.get("/api/submissions").json()) == 1


def test_revision_confirm_export(client):
    c = client
    connect_workspace(c)
    sid = create(c)
    r = save(c, sid)
    assert r.status_code == 200
    r1 = r.json()["id"]
    assert c.post("/api/revisions/" + r1 + "/compile", json={}).status_code == 409
    assert c.post("/api/revisions/" + r1 + "/confirm", json={}).status_code == 200
    assert (
        c.post("/api/revisions/" + r1 + "/compile", json={}).json()["ir"]["objective"][
            "sense"
        ]
        == "max"
    )
    z = c.get("/api/submissions/" + sid + "/export")
    assert z.status_code == 200
    with zipfile.ZipFile(io.BytesIO(z.content)) as f:
        assert {
            "solve.py",
            "model_ir.json",
            "source_map.json",
            "audit.json",
            "requirements.txt",
        }.issubset(f.namelist())
    assert save(c, sid, version=1).status_code == 409
    r2 = save(c, sid, version=2).json()["id"]
    assert c.post("/api/revisions/" + r1 + "/compile", json={}).status_code == 409
    assert c.post("/api/revisions/" + r2 + "/compile", json={}).status_code == 409
    assert (
        c.get("/api/submissions/" + sid + "/export?revision_id=" + r1).status_code
        == 200
    )


def test_csrf_host_and_cross_site(client):
    c = client
    connect_workspace(c)
    token = c.headers.pop("X-CSRF-Token")
    assert c.post("/api/submissions", json={"title": "bad"}).status_code == 403
    c.headers["X-CSRF-Token"] = token
    assert (
        c.post(
            "/api/submissions",
            json={"title": "bad"},
            headers={"Origin": "https://attacker.invalid"},
        ).status_code
        == 403
    )
    assert (
        c.get("/api/workspace", headers={"Sec-Fetch-Site": "cross-site"}).status_code
        == 403
    )
    assert (
        c.get("/api/workspace", headers={"Host": "attacker.invalid"}).status_code == 400
    )
    c.cookies.clear()
    assert c.get("/api/settings/model").status_code == 401


def test_missing_worker_blocks_run(client):
    c = client
    connect_workspace(c)
    sid = create(c)
    rid = save(c, sid).json()["id"]
    c.post("/api/revisions/" + rid + "/confirm", json={})
    r = c.post("/api/revisions/" + rid + "/runs", json={"request_key": "request-1234"})
    assert r.status_code == 503
    assert r.json()["code"] == "RUNNER_UNAVAILABLE"


def test_assets_validation_and_project_binding(client):
    c = client
    connect_workspace(c)
    sid = create(c)
    assert (
        c.post(
            "/api/submissions/" + sid + "/assets",
            files=[("files", ("fake.png", b"not-image", "image/png"))],
        ).status_code
        == 422
    )
    r = c.post(
        "/api/submissions/" + sid + "/assets",
        files=[("files", ("../../image.png", image(), "image/png"))],
    )
    assert r.status_code == 200
    aid = r.json()[0]["id"]
    assert c.get("/api/assets/" + aid).status_code == 200
    assert save(c, sid, assets=[dict(id=aid, rotation=90)]).status_code == 200
    sid2 = create(c)
    assert save(c, sid2, assets=[dict(id=aid, rotation=0)]).status_code == 422


def test_examples_are_executable_and_independent(client):
    c = client
    connect_workspace(c)
    items = c.get("/api/examples").json()
    assert len(items) == 10
    for item in items:
        example = c.get("/api/examples/" + item["id"]).json()
        from modellab.compiler import compile_model

        compile_model(example["model"], example["data"])
        result = c.post(
            "/api/submissions", json={"title": item["title"], "example_id": item["id"]}
        )
        assert result.status_code == 200
        r = c.get("/api/submissions/" + result.json()["id"]).json()["revisions"][0]
        assert r["data"] == example["data"]
        assert r["problem_text"] == example["problem_text"]
        assert r["confirmation"] is None
    assert (
        c.post(
            "/api/submissions", json={"title": "bad", "example_id": "not-real"}
        ).status_code
        == 404
    )


def test_existing_local_projects_remain_editable(client):
    c = client
    connect_workspace(c)
    with transaction() as db:
        db.execute(
            "INSERT INTO users VALUES ('legacy','legacy','!disabled','teacher',0)"
        )
        db.execute(
            "INSERT INTO submissions VALUES ('old','legacy',NULL,'旧模型',NULL,0,0)"
        )
    assert any(s["id"] == "old" for s in c.get("/api/submissions").json())
    assert save(c, "old", version=0).status_code == 200
    assert not c.get("/api/submissions/old").json()["readonly"]


def test_idempotency_and_cancellation(client):
    c = client
    connect_workspace(c)
    sid = create(c)
    rid = save(c, sid).json()["id"]
    c.post("/api/revisions/" + rid + "/confirm", json={})
    with transaction() as db:
        db.execute(
            "INSERT INTO runtime VALUES (?,?,?)",
            ("worker", canonical(dict(runner=True)), time.time()),
        )
    a = c.post("/api/revisions/" + rid + "/runs", json={"request_key": "request-1234"})
    b = c.post("/api/revisions/" + rid + "/runs", json={"request_key": "request-1234"})
    assert a.status_code == b.status_code == 202
    assert a.json()["id"] == b.json()["id"]
    assert (
        c.post(
            "/api/revisions/" + rid + "/runs",
            json={"request_key": "request-1234", "time_limit": 10},
        ).status_code
        == 409
    )
    assert c.post("/api/jobs/" + a.json()["id"] + "/cancel", json={}).status_code == 200
    assert c.get("/api/jobs/" + a.json()["id"]).json()["state"] == "cancelled"


def test_import_rename_and_delete_submission(client):
    c = client
    connect_workspace(c)
    model = c.get("/api/fixtures/production").json()
    imp = c.post(
        "/api/submissions/import",
        json={"title": "导入测试模型", "problem_text": "测试", "model": model, "data": {}},
    )
    assert imp.status_code == 200
    sid = imp.json()["id"]
    assert c.patch(f"/api/submissions/{sid}", json={"title": "已重命名模型"}).status_code == 200
    assert c.get(f"/api/submissions/{sid}").json()["title"] == "已重命名模型"
    assert c.delete(f"/api/submissions/{sid}").status_code == 200
    assert c.get(f"/api/submissions/{sid}").status_code == 404


def test_compile_lp_export_and_unavailable_solver(client):
    c = client
    connect_workspace(c)
    sid = create(c)
    rid = save(c, sid).json()["id"]
    c.post(f"/api/revisions/{rid}/confirm", json={})

    comp = c.post(f"/api/revisions/{rid}/compile", json={})
    assert comp.status_code == 200
    body = comp.json()
    assert body["stats"]["variables"] == 2
    assert "Maximize" in body["lp_text"]

    lp_resp = c.get(f"/api/revisions/{rid}/export-lp")
    assert lp_resp.status_code == 200
    assert "Subject To" in lp_resp.text

    with transaction() as db:
        db.execute(
            "INSERT INTO runtime VALUES (?,?,?)",
            (
                "worker",
                canonical(
                    dict(
                        runner=True,
                        solvers={"highs": True, "gurobi": False, "cplex": False},
                    )
                ),
                time.time(),
            ),
        )
    bad_solver = c.post(
        f"/api/revisions/{rid}/runs",
        json={"request_key": "req-gurobi-1234", "solver": "gurobi"},
    )
    assert bad_solver.status_code == 422
    assert bad_solver.json()["code"] == "SOLVER_UNAVAILABLE"


def test_upload_preview_xlsx_and_csv(client):
    import io
    import openpyxl

    c = client
    connect_workspace(c)
    sid = create(c)

    # 1. Upload CSV
    csv_bytes = "plant,cap\nP1,100\nP2,150\n".encode("utf-8")
    r_csv = c.post(
        f"/api/submissions/{sid}/data-files",
        files=[("files", ("plants.csv", csv_bytes, "text/csv"))],
    )
    assert r_csv.status_code == 200
    csv_id = r_csv.json()[0]["id"]
    prev_csv = c.get(f"/api/assets/{csv_id}/preview")
    assert prev_csv.status_code == 200
    assert prev_csv.json()["sheets"][0]["rows"] == [
        ["plant", "cap"],
        ["P1", "100"],
        ["P2", "150"],
    ]

    # 2. Upload XLSX
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Cost"
    ws.append(["from", "C1", "C2"])
    ws.append(["W1", 2.5, 3.0])
    buf = io.BytesIO()
    wb.save(buf)
    r_xlsx = c.post(
        f"/api/submissions/{sid}/data-files",
        files=[
            (
                "files",
                (
                    "cost.xlsx",
                    buf.getvalue(),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                ),
            )
        ],
    )
    assert r_xlsx.status_code == 200
    xlsx_id = r_xlsx.json()[0]["id"]
    prev_xlsx = c.get(f"/api/assets/{xlsx_id}/preview")
    assert prev_xlsx.status_code == 200
    assert prev_xlsx.json()["sheets"][0]["sheet_name"] == "Cost"
    assert prev_xlsx.json()["sheets"][0]["rows"][1] == ["W1", 2.5, 3]
