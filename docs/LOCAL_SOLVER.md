# 本机求解模式 · 2026-11-17

用户明确要求个人平台无需 Docker 即可在页面运行已确认模型。本次以该要求替代原始规格的 Docker-only 执行约束。

## 当前行为

- 默认 `SOLVER_MODE=local`。worker 使用当前虚拟环境的 Python/HiGHS，在每任务独立子进程中执行固定生成模板；API 进程不直接求解。
- 健康接口返回 runner_mode；界面和结果显示“本机求解”。只要 worker 和 highspy 可用，运行按钮即可启用。
- 队列快照记录执行模式，不受后续环境模式切换影响。并发仍为默认两路。
- 求解时间默认 30 秒、API 上限 120 秒；独立硬超时多 10 秒，超时终止进程组，不捏造 incumbent。
- 每任务使用独立目录、Python isolated mode、最小环境和单线程求解配置。环境不会继承模型 API Key / PYTHONPATH 等宿主变量。
- 本机 bootstrap 限制 CPU 时间、单个输出文件 10 MiB、禁用 core dump；worker 最多保留 2 MiB 日志。
- 使用独立 POSIX 进程组处理取消/终止；父进程生命期管道在 worker 退出或崩溃后产生 EOF，子进程自行终止其进程组，防止遗留求解任务。重启后持久 running 任务标记 interrupted。
- 保留原始结果 Schema 验证、独立残差与目标重算、来源映射、可重复导出的相同代码模板。

这是个人本地工具的进程分离，不等同于容器安全隔离。本机模式没有文件系统/网络沙箱，也没有强制 1 GiB 内存上限。执行入口只接受服务端编译得到的 IR 与固定模板，不开放任意用户 Python。当前支持 macOS/Linux。

Docker 仍可通过 `SOLVER_MODE=docker` 显式选择；只有该模式需要 `make runner`。`make setup` 默认安装本机平台，不再要求构建 Docker 镜像。

## 验证记录

- 后端全量：`make test`，**62 通过、3 跳过**。
- 新增本机测试 11 项：6 个实际 API → 持久队列 → worker → 本机子进程 → HiGHS → 独立校验；另覆盖运行中取消、硬超时终止、父管道 EOF 清理、子进程环境/资源参数、无需 Docker 的能力检查。
- 实际数学结果：整数生产模型目标 10，连续松弛 32/3，自由变量 −3，指派模型 9；矛盾模型 infeasible，自由无约束模型 unbounded。
- 硬超时测试推进测试时钟后终止真实睡眠进程，用于验证回收逻辑，不作为实际大规模性能证据。
- 前端 TypeScript 与 Vite 生产构建通过。
- 浏览器端到端测试 1 项通过（8.59 秒）。使用真实 Chrome、API、worker 和临时数据库，运行修改目标常数后的生产模型，检查最优值 17、独立校验通过，并继续验证导出和修订流程。
- 跳过项仅为两个可选 Docker 集成测试和真实 LLM 测试，不影响本机求解。

运行截图：[本机求解结果](screenshots/local-solve.png)。测试输出：[记录](local-test-output.txt)。
