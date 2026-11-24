SHELL := /bin/bash
UV := $(if $(wildcard .tools/uv),.tools/uv,uv)
PY := .venv/bin/python
NPM := $(if $(wildcard .tools/node/bin/npm),.tools/node/bin/npm,npm)
export PATH := $(CURDIR)/.tools/node/bin:$(PATH)
.PHONY: setup setup-app runner dev frontend worker start test test-browser build schema cli
setup: setup-app
setup-app:
	$(UV) sync --frozen
	$(NPM) --prefix frontend ci --no-audit --no-fund
	$(MAKE) build
runner:
	@command -v docker >/dev/null || { echo 'Docker 未安装：默认本机求解不受影响；只有 Docker 模式需要先安装并启动 Docker。'; exit 1; }
	docker build -t modellab-solver:0.1 runner
build:
	$(NPM) --prefix frontend run build
schema:
	$(PY) scripts/export_schema.py
	frontend/node_modules/.bin/json2ts -i docs/model.schema.json -o frontend/src/model.generated.d.ts
dev:
	$(PY) -m uvicorn modellab.api:app --host 127.0.0.1 --port 8000 --reload
frontend:
	$(NPM) --prefix frontend run dev
worker:
	$(PY) -m modellab.worker
start:
	$(PY) scripts/start.py
cli:
	$(PY) -m modellab.cli fixtures/production.json --solve --out .runtime/cli

test:
	$(PY) -m pytest -m 'not browser' -q -ra

test-browser:
	RUN_BROWSER_TESTS=1 $(PY) -m pytest tests/test_browser.py -q -ra
