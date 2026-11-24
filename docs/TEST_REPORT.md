# M1–M3 验证记录（2026-11-16 历史版本）

当前个人版的变更和验证见 [个人版调整](PERSONAL_MODE.md)。

日期：2026-11-16（Asia/Shanghai）。范围为 M1–M3；不将 M4 计入完成项。

## 实际环境

- macOS 26.7.1 / Apple Silicon arm64
- Python 3.12.16，Node 22.16.0
- HiGHS/highspy 1.16.0，NumPy 2.5.5
- FastAPI 0.163.1，Pydantic 2.14.3
- pytest 9.2.0，Playwright 1.65.2 + 本机 Chrome
- 依赖版本来自本次实际安装，完整版本与 hash 见 uv.lock、frontend/package-lock.json。

## 验证结果

| 类别 | 命令 / 方式 | 结果 |
|---|---|---|
| 数学编译、真实 HiGHS、导出代码复现 | pytest tests/test_math.py | 33 通过 |
| API 版本、确认、账号、课程与文件权限 | pytest tests/test_api.py | 6 通过 |
| 任务恢复、模拟识别、来源坐标、隔离参数与输出防护 | pytest tests/test_jobs_providers.py | 5 通过 |
| 真实 Docker 求解 | 同上 docker 标记 | 跳过：本机未安装 Docker |
| 真实 Docker 隔离探针 | 同上 docker 标记 | 跳过：本机未安装 Docker |
| 真实 LLM 图像转录 | 同上 llm 标记 | 跳过：未配置凭据 |
| TypeScript 与生产构建 | make build | 通过 |
| JSON Schema / TypeScript 导出 | make schema | 通过 |
| 真实浏览器操作（真实 API 和临时 SQLite） | make test-browser | 1 通过 |
| 单命令启动 | scripts/start.py + HTTP 检查 | 首页 200，DB/worker 正常，runner 明确不可用 |

后端总计 **44 通过、3 跳过**；另有 **1 项真实浏览器流程通过**。Starlette TestClient 提示 httpx 适配将在未来迁移的弃用警告；本次测试调用实际通过。

## 数学证据

- 生产 MILP：x=0、y=2，目标 10；独立约束、变量范围、整数性和目标重算通过。
- 连续松弛：x=y=4/3，目标 32/3；未丢失变量类型。
- 自由变量：min x, x≥−3 得 x=−3；未补默认非负。
- 显式自由变量无约束：unbounded，目标和变量为 null。
- 矛盾约束 / 反向上下界 / 常数假约束：infeasible，无虚构解。
- min/max 与目标常数 7：分别返回 7 和 17。
- 3×3 指派：目标 9，与全排列穷举一致；字符串集合、参数矩阵与嵌套求和展开一致。
- 缺失参数、索引作用域、重复符号、未声明范围、NaN、非线性、零分母、AST/规模上限均有拒绝测试。
- 人为注入约束/整数/目标违反量，独立校验器能检测。
- 导出 `solve.py` 在独立子进程重新读取 IR 真实求解，目标 10；来源映射行号逐项检查。
- time limit 有解/无解、iteration limit、cancelled 的适配状态使用固定 adapter 响应测试，**不作为真实限时性能证据**。

## 浏览器证据

使用 Playwright + 本机 Chrome，无 API 拦截或伪造后端响应。测试数据库与账号只存在于临时目录。

已操作：登录 → 新建练习 → 载入模型 → 编辑目标常数并解析预览 → 应用表达式 → 保存新版本 → 核对确认 → 生成代码 → 下载 ZIP → 返回编辑 → 上传图片/旋转 → 保存 → 模拟识别 → 左右预览 → 采纳新版本 → 记录疑点处理 → 保存 → 查看历史。

断言 Docker 未配置时运行按钮禁用；页面无 JavaScript 异常。页面截图：

- [工作区](screenshots/workspace.png)
- [历史版本](screenshots/history.png)

没有进行“浏览器 → Docker → HiGHS”真实全链路验收，因为缺少 Docker。

## M3 样例记录

| 样例 | 内容 | 本次验证 |
|---|---|---|
| fixtures/handwriting/clear.png | 清晰生产模型、整数与非负域 | 上传/旋转/模拟草稿流程通过；真实识别未测 |
| fixtures/handwriting/ambiguous.png | 不等号疑点 | 样例已准备；真实识别未测 |
| fixtures/handwriting/missing_domain.png | 缺少变量域 | 样例已准备；真实识别未测 |

这些为本地合成手写风格图片，不是学生隐私材料。模拟 provider 返回固定生产模型，不读取图像；没有准确率声明。

## 待目标环境验收

1. 安装并启动 Docker，`make runner` 后执行 docker 标记测试及浏览器真实求解、取消、硬超时、运行中重启清理。
2. 配置具备图像能力的真实模型 provider，运行 llm 标记测试，逐张核对转录与疑点，记录真实效果。
3. 在目标 Linux / Mac Intel 机器重新执行锁定依赖安装、镜像构建与验收。本机仅实测 Apple Silicon。
4. 课堂并发与长时间运行尚未压测；没有编造性能承诺。

已有隔离参数、输出防护、queued 取消、原子领取、重启中断与跨学生/教师权限测试；这些不替代以上真实环境检查。
