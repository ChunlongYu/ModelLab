#!/bin/bash
cd "$(dirname "$0")" || exit 1
if [ ! -x .venv/bin/python ]; then
  echo '请先按 README 安装依赖：make setup-app'
  read -r -p '按回车退出'
  exit 1
fi
.venv/bin/python scripts/start.py
