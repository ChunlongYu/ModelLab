"""Real browser + real API/SQLite, no intercepted API responses."""

import os
import socket
import subprocess
import sys
import time
from pathlib import Path
import httpx
import pytest

pytest.importorskip("playwright")
from playwright.sync_api import sync_playwright, expect  # noqa: E402
from modellab.storage import initialize, transaction


@pytest.mark.browser
def test_browser_manual_and_mock(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[1]
    if not (root / "frontend/dist/index.html").exists():
        pytest.skip("请先构建前端")
    if os.getenv("RUN_BROWSER_TESTS") != "1":
        pytest.skip("设置 RUN_BROWSER_TESTS=1 运行浏览器验收")
    monkeypatch.setenv("MODELLAB_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ALLOW_MOCK", "1")
    monkeypatch.setenv("SOLVER_MODE", "local")
    initialize()
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    monkeypatch.setenv("MODELLAB_ORIGINS", f"http://127.0.0.1:{port}")
    server = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "modellab.api:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    worker = subprocess.Popen(
        [sys.executable, "-m", "modellab.worker"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    try:
        for _ in range(100):
            try:
                if httpx.get(f"http://127.0.0.1:{port}/api/health").status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            time.sleep(0.1)
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="chrome", headless=True)
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            errors = []
            page.on(
                "pageerror",
                lambda e: (errors.append(str(e)), print("BROWSER ERROR", str(e))),
            )
            page.goto(f"http://127.0.0.1:{port}")
            expect(page.get_by_role("heading", name="ModelLab 建模工作台")).to_be_visible()
            expect(page.get_by_text("课程管理", exact=True)).to_have_count(0)
            expect(page.get_by_label("用户名", exact=True)).to_have_count(0)
            page.get_by_role("button", name="模型设置", exact=False).click()
            page.get_by_label("API 地址", exact=True).fill("https://example.invalid/v1")
            page.get_by_label("模型名称", exact=True).fill("vision-demo")
            page.get_by_label("API Key", exact=True).fill("browser-test-key-not-real")
            page.get_by_label("该模型支持图像输入，用于识别手写模型").check()
            page.get_by_role("button", name="保存连接", exact=True).click()
            expect(
                page.get_by_text("连接配置已保存，可以返回工作区识别图片。")
            ).to_be_visible()
            expect(page.get_by_label("API Key", exact=True)).to_have_value("")
            shots = root / "docs/screenshots"
            shots.mkdir(exist_ok=True)
            page.screenshot(path=str(shots / "model-settings.png"), full_page=True)
            page.reload()
            page.get_by_role("button", name="模型设置", exact=False).click()
            expect(page.get_by_label("模型名称", exact=True)).to_have_value(
                "vision-demo"
            )
            expect(page.get_by_label("API Key", exact=True)).to_have_value("")
            page.once("dialog", lambda dialog: dialog.accept())
            page.get_by_role("button", name="删除所有已保存 API Key", exact=True).click()
            expect(page.get_by_text("已清空所有已保存的 API Key 与连接配置。")).to_be_visible()
            page.get_by_role("button", name="参考案例", exact=False).click()
            expect(page.locator(".example-card")).to_have_count(10)
            page.locator(".example-card").first.get_by_role(
                "button", name="查看模型与数据"
            ).click()
            expect(page.locator(".case-detail")).to_be_visible()
            page.screenshot(path=str(shots / "examples.png"), full_page=True)
            page.locator(".example-card").first.get_by_role(
                "button", name="以此开始建模"
            ).click()
            page.get_by_role("button", name="3. 决策变量", exact=False).click()
            expect(page.get_by_label("变量 0 标识符", exact=True)).to_have_value("x")
            page.get_by_role("button", name="＋ 新建", exact=True).click()
            page.get_by_label("模型名称", exact=True).fill("浏览器生产计划")
            page.get_by_role("button", name="创建模型", exact=True).click()
            page.get_by_role("button", name="载入示例").click()
            page.get_by_role("button", name="保存新版本", exact=True).click()
            expect(page.get_by_text("当前版本已保存", exact=True)).to_be_visible()
            # Preview can be applied without executing source strings.
            page.get_by_role("button", name="4. 目标函数", exact=False).click()
            page.get_by_label("目标表达式").fill("3*x + 5*y + 7")
            page.get_by_role("button", name="解析并更新公式").click()
            page.get_by_role("button", name="保存新版本", exact=True).click()
            expect(page.get_by_text("当前版本已保存", exact=True)).to_be_visible()
            page.get_by_role("button", name="前往确认").click()
            page.get_by_label("我已逐项核对").check()
            page.get_by_role("button", name="确认此版本").click()
            page.get_by_role("button", name="生成代码与规模预检").click()
            expect(page.get_by_text("生成的 Python 代码", exact=True)).to_be_visible()
            expect(page.get_by_role("button", name="运行已确认模型")).to_be_enabled(
                timeout=15000
            )
            page.get_by_role("button", name="运行已确认模型").click()
            expect(
                page.get_by_role("heading", name="版本 3 · 已证明所提交模型的最优解")
            ).to_be_visible(timeout=15000)
            expect(
                page.get_by_text("独立可行性与目标值校验通过", exact=True)
            ).to_be_visible()
            expect(page.locator(".metrics strong").first).to_have_text("17")
            page.get_by_label("结果分析要求").fill("生成变量柱状图和汇总表")
            page.get_by_role("button", name="模拟解读", exact=True).click()
            expect(page.get_by_text("AI 决策摘要", exact=True)).to_be_visible(
                timeout=15000
            )
            expect(page.get_by_text("决策变量取值分布", exact=True)).to_be_visible()
            page.screenshot(path=str(shots / "local-solve.png"), full_page=True)
            page.get_by_role("button", name="03 生成与求解").click()
            with page.expect_download() as dl:
                page.get_by_role("link", name="下载复现 ZIP").click()
            assert dl.value.suggested_filename.endswith(".zip")
            page.get_by_role("button", name="01 建模与数据").click()
            page.get_by_label("建模描述 / 问题背景").fill(
                "工厂生产两种产品 x 和 y，利润分别为 3 和 5，受限于两条工时约束。"
            )
            page.get_by_role("button", name="保存新版本", exact=True).click()
            page.get_by_role("button", name="AI 建模助手", exact=False).click()
            expect(
                page.get_by_role("button", name="模拟生成草稿（固定数据）")
            ).to_be_enabled(timeout=10000)
            page.get_by_role("button", name="模拟生成草稿（固定数据）").click()
            expect(page.get_by_text("AI 草稿就绪", exact=True)).to_be_visible(
                timeout=15000
            )
            page.get_by_label("与 AI 讨论草稿").fill("把变量改为整数")
            page.get_by_role("button", name="模拟发送", exact=True).click()
            expect(
                page.get_by_text("已按你的要求将草稿中的决策变量改为整数类型")
            ).to_be_visible(timeout=15000)
            page.get_by_role("button", name="采纳到左侧版本", exact=False).click()
            expect(page.get_by_text("待核对疑点", exact=False)).to_be_visible(
                timeout=10000
            )
            page.get_by_label("核对记录").fill(
                "这是开发模拟数据；已核对本例变量与约束。"
            )
            page.get_by_label("我已核对并修订该疑点").check()
            page.get_by_role("button", name="保存新版本", exact=True).click()
            expect(page.get_by_text("当前版本已保存", exact=True)).to_be_visible()
            page.get_by_role("button", name="模型诊断", exact=True).click()
            expect(
                page.get_by_role("button", name="模拟诊断（固定数据）")
            ).to_be_enabled(timeout=10000)
            page.get_by_role("button", name="模拟诊断（固定数据）").click()
            expect(page.get_by_text("诊断报告", exact=True)).to_be_visible(
                timeout=15000
            )
            expect(page.get_by_text("建议核对目标与业务条件是否一致")).to_be_visible()
            shots = root / "docs/screenshots"
            shots.mkdir(exist_ok=True)
            page.evaluate("window.scrollTo(0, 0)")
            page.screenshot(path=str(shots / "workspace.png"), full_page=True)
            page.get_by_role("button", name="04 结果与历史").click()
            expect(page.get_by_text("修订记录", exact=True)).to_be_visible()
            page.screenshot(path=str(shots / "history.png"), full_page=True)
            assert not errors, errors
            browser.close()
    finally:
        for proc in (worker, server):
            proc.terminate()
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
