import json
import stat
import httpx
import pytest
from test_api import client, connect_workspace, create, save
from modellab.settings import load_connection
from modellab.storage import home
from modellab import providers

CONFIG = dict(
    connection="compatible",
    endpoint="https://example.invalid/v1",
    model="vision-example",
    api_key="test-only-key-abcdef",
    vision=True,
    json_mode=False,
)


def test_settings_persist_redact_and_clear(client, monkeypatch):
    c = client
    connect_workspace(c)
    r = c.put("/api/settings/model", json=CONFIG)
    assert r.status_code == 200
    assert r.json()["key_configured"] and r.json()["configured"]
    assert CONFIG["api_key"] not in r.text
    assert load_connection()["api_key"] == CONFIG["api_key"]
    assert stat.S_IMODE((home() / "model-service.json").stat().st_mode) == 0o600
    c.cookies.clear()
    connect_workspace(c)
    assert CONFIG["api_key"] not in c.get("/api/settings/model").text
    assert c.get("/api/health").json()["provider"] == "remote"
    body = {k: v for k, v in CONFIG.items() if k != "api_key"}
    body["model"] = "next-model"
    assert c.put("/api/settings/model", json=body).status_code == 200
    assert load_connection()["api_key"] == CONFIG["api_key"]
    body["endpoint"] = "https://different.invalid/v1"
    assert c.put("/api/settings/model", json=body).status_code == 422
    monkeypatch.setenv("MODEL_API_KEY", "environment-secret")
    assert not c.delete("/api/settings/model").json()["key_configured"]
    assert c.get("/api/health").json()["provider"] == "unconfigured"
    assert load_connection()["api_key"] == ""


def test_local_connection_and_url_validation(client):
    c = client
    connect_workspace(c)
    local = dict(
        connection="local",
        endpoint="http://127.0.0.1:1234/v1/chat/completions",
        model="local-vision",
    )
    r = c.put("/api/settings/model", json=local)
    assert r.status_code == 200
    assert r.json()["configured"] and not r.json()["key_configured"]
    assert r.json()["endpoint"] == "http://127.0.0.1:1234/v1"
    for url in (
        "file:///tmp/a",
        "http://remote.invalid/v1",
        "https://example.invalid/v1?api_key=secret",
        "https://user:pass@example.invalid/v1",
    ):
        assert (
            c.put("/api/settings/model", json={**CONFIG, "endpoint": url}).status_code
            == 422
        )


def test_key_absent_from_export_and_schema_errors(client):
    c = client
    connect_workspace(c)
    c.put("/api/settings/model", json=CONFIG)
    sid = create(c)
    rid = save(c, sid).json()["id"]
    c.post("/api/revisions/" + rid + "/confirm", json={})
    import zipfile, io

    with zipfile.ZipFile(
        io.BytesIO(c.get("/api/submissions/" + sid + "/export").content)
    ) as z:
        assert all(CONFIG["api_key"].encode() not in z.read(n) for n in z.namelist())
    r = c.put("/api/settings/model", json={**CONFIG, "endpoint": "bad"})
    assert r.status_code == 422 and CONFIG["api_key"] not in r.text


def test_configured_provider_request_and_no_key_echo(client, monkeypatch):
    c = client
    connect_workspace(c)
    c.put("/api/settings/model", json=CONFIG)
    real_client = httpx.Client
    seen = []

    def respond(request):
        seen.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})

    monkeypatch.setattr(
        providers.httpx,
        "Client",
        lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs),
    )
    r = c.post("/api/settings/model/test", json={})
    assert r.status_code == 200
    assert seen[0].url == CONFIG["endpoint"] + "/chat/completions"
    assert seen[0].headers["Authorization"] == "Bearer " + CONFIG["api_key"]
    assert CONFIG["api_key"] not in r.text

    def denied(request):
        return httpx.Response(401, text="echo secret " + CONFIG["api_key"])

    monkeypatch.setattr(
        providers.httpx,
        "Client",
        lambda **kwargs: real_client(transport=httpx.MockTransport(denied), **kwargs),
    )
    r = c.post("/api/settings/model/test", json={})
    assert r.status_code == 502 and CONFIG["api_key"] not in r.text


def test_worker_loads_saved_settings_and_stale_config_is_rejected(client, monkeypatch):
    c = client
    connect_workspace(c)
    c.put("/api/settings/model", json=CONFIG)
    from test_math import fixture
    from test_api import image

    (home() / "assets").mkdir()
    (home() / "assets" / "test-image").write_bytes(image())
    real_client = httpx.Client
    seen = []

    def respond(request):
        seen.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                dict(
                                    transcript="模型转录",
                                    symbolic_model_draft=fixture("production"),
                                    unresolved_items=[],
                                )
                            )
                        }
                    }
                ]
            },
        )

    monkeypatch.setattr(
        providers.httpx,
        "Client",
        lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs),
    )
    revision = load_connection()["revision"]
    result = providers.transcribe(
        [dict(id="test-image", rotation=0)], "example", connection_revision=revision
    )
    assert result["model"] == CONFIG["model"] and result["provider"] == "remote"
    assert seen[0]["messages"][1]["content"][2]["type"] == "image_url"
    c.put("/api/settings/model", json={**CONFIG, "model": "changed-model"})
    with pytest.raises(RuntimeError, match="已变更"):
        providers.transcribe([], "", connection_revision=revision)
