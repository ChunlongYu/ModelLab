@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
pushd "%~dp0\.." || exit /b 1

echo ============================================
echo   ModelLab Windows 独立可执行文件 (.exe) 打包
echo ============================================
echo.

set "PY_CMD="
set "PY_ARGS="

rem 1. 优先使用当前已激活的 Conda / 虚拟环境
if defined CONDA_PREFIX if exist "%CONDA_PREFIX%\python.exe" (
    call :check_py "%CONDA_PREFIX%\python.exe"
)
if not defined PY_CMD if exist ".venv\Scripts\python.exe" (
    call :check_py ".venv\Scripts\python.exe"
)
if not defined PY_CMD call :check_py py -3.12
if not defined PY_CMD call :check_py python
if not defined PY_CMD (
    for /d %%E in ("%USERPROFILE%\anaconda3\envs\*" "%USERPROFILE%\miniconda3\envs\*" "C:\ProgramData\anaconda3\envs\*") do (
        if not defined PY_CMD if exist "%%~fE\python.exe" call :check_py "%%~fE\python.exe"
    )
)

if not defined PY_CMD (
    echo [错误] 未找到已安装 ModelLab 依赖的 Python 3.10+ 环境。
    echo 请先在 Anaconda Prompt 中激活你的环境，或先运行一次 安装依赖.bat。
    pause
    popd
    exit /b 1
)

echo 使用 Python: %PY_CMD% %PY_ARGS%
"%PY_CMD%" %PY_ARGS% -m PyInstaller --version >nul 2>&1
if errorlevel 1 (
    echo 正在安装 PyInstaller...
    "%PY_CMD%" %PY_ARGS% -m pip install pyinstaller -i https://pypi.tuna.tsinghua.edu.cn/simple
    if errorlevel 1 goto fail
)

echo 正在打包 ModelLab.exe（大约需要 1~2 分钟）...
"%PY_CMD%" %PY_ARGS% -m PyInstaller --noconfirm --clean modellab.spec
if errorlevel 1 goto fail

echo.
echo [成功] 独立可执行版本已生成：
echo   dist\ModelLab\ModelLab.exe
echo.
echo 请将整个 dist\ModelLab 文件夹压缩后发给学生，学生无需安装 Python，直接双击 ModelLab.exe 即可使用！
pause
popd
exit /b 0

:check_py
"%~1" %~2 -c "import sys; from importlib.util import find_spec; sys.exit(sys.version_info < (3, 10) or any(find_spec(p) is None for p in ('uvicorn','fastapi','pydantic','highspy','openpyxl')))" >nul 2>&1
if errorlevel 1 exit /b 1
set "PY_CMD=%~1"
set "PY_ARGS=%~2"
exit /b 0

:fail
echo [错误] 打包失败，请检查上方错误信息。
pause
popd
exit /b 1
