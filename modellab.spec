# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_submodules

ROOT = Path(SPECPATH).resolve()

datas = [
    (str(ROOT / "frontend" / "dist"), "frontend/dist"),
    (str(ROOT / "fixtures"), "fixtures"),
    (str(ROOT / "backend" / "migrations"), "backend/migrations"),
    (str(ROOT / "backend" / "modellab" / "solver_template.py"), "modellab"),
    (str(ROOT / "requirements.txt"), "."),
]

binaries = []
hiddenimports = [
    "modellab",
    "modellab.api",
    "modellab.worker",
    "modellab.local_runner",
    "modellab.solver_template",
    "modellab.compiler",
    "modellab.exporter",
    "modellab.parser",
    "modellab.providers",
    "modellab.result_schema",
    "modellab.schema",
    "modellab.settings",
    "modellab.spreadsheets",
    "modellab.storage",
    "modellab.validation",
    "modellab.examples",
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "multipart",
    "python_multipart",
    "dotenv",
    "openpyxl",
]

for pkg in ("highspy", "uvicorn", "fastapi", "pydantic", "httpx", "PIL", "openpyxl"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

a = Analysis(
    [str(ROOT / "main.py")],
    pathex=[str(ROOT), str(ROOT / "backend")],
    binaries=binaries,
    datas=datas,
    hiddenimports=list(dict.fromkeys(hiddenimports)),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["pytest", "playwright", "tkinter", "matplotlib"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ModelLab",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="ModelLab",
)
