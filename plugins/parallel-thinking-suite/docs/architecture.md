# 并行思考：架构与运行边界

## 产品目标

“并行思考”是宿主感知的本地插件。用户在 Codex、Claude Code 等上下文宿主中明确调用后，同一个问题会被多个独立 Agent 并行分析，HTML 工作台通过 SSE 展示每条结果轨道。下一轮可由当前宿主或专用聚合 Agent 汇总共识、分歧、风险和行动。

## 核心边界

- Skill 负责理解当前自然语言、选择执行器并调用 CLI；宿主暴露原生多 Agent 能力时优先使用，不通过环境变量猜测能力。
- 本地服务是 Agent 定义、任务规划、运行状态、归档和厂商 API 的唯一真相源；宿主原生工具是 `host-native` 运行的执行真相源。
- subagent-harness@0.5.2 负责读取、校验并解析 .agent.md；.agent.ext.yaml 的 parallelThinking 命名空间由本插件校验。
- Agent 配置是唯一真相源。HTML 配置页直接保存 canonical 文件，不维护第二套数据库。
- API Key 只在服务端解析，不进入浏览器、Agent 文件、请求归档或日志。环境变量是跨平台入口；macOS 的 OpenRouter Key 可回退从登录钥匙串读取，并在服务进程内缓存。
- 所有 Agent 只返回公开最终答案；只有宿主或 Provider 确实报告时才记录模型与用量，不要求或展示隐藏思维链。

## 数据目录

全局复用目录默认为 %USERPROFILE%/.parallel-think，可用 PARALLEL_THINK_HOME 覆盖：

    .parallel-think/
    ├─ agents/                    # *.agent.md + *.agent.ext.yaml
    ├─ knowledge/
    │  └─ shared/                 # 共享知识集合
    ├─ parsers/                   # <id>/<version>/manifest.yaml + entry
    ├─ providers.yaml             # 非密钥 Provider 元数据
    └─ revisions/agents/          # 配置修订历史

每个项目使用 <project>/.parallel-think：

    .parallel-think/
    ├─ project.yaml
    ├─ parsed-cache/
    ├─ parser-audit/
    └─ runs/<runId>/
       ├─ manifest.json
       ├─ request.json
       ├─ events.jsonl
       └─ agents/<agentId>.json

## 运行流程

1. Skill 根据“智能选择 Agent、全部、点名”模式选择已启用的普通 Agent；聚合器不会混入普通并行。
2. 执行器路由先看用户是否显式指定 Provider/model；否则在宿主提供原生子 Agent/Task 能力时选择 `host-native`，不支持时才回退 `provider`。
3. 本地服务创建运行编号、任务结构与每个 Agent 的 queued 状态；知识路由器读取共享/私有目录，解析器按文件 SHA-256 与解析器版本命中缓存。
4. `host-native` 由当前宿主并行执行 CLI 返回的公开 system prompt、专项 task 和 context package；Agent 文件中的 Provider/model 只作为显式 Provider 路径与回退说明。宿主没有报告实际模型或用量时保持未知。
5. `provider` 的全局并发默认 6、每个 Provider 默认 2。每个 Agent 根据 canonical 配置独立调用 OpenAI、Anthropic、DeepSeek 或 OpenRouter；OpenRouter 的 `model.name` 是逐 Agent model slug。
6. 两种执行器都归档 started / model_resolved / text_delta / usage / completed / failed / cancelled 事件。宿主原生结果通过 `record-native` 回写；Provider 结果由服务端流式写入。
7. Provider 路径 30 秒无首字或 180 秒总超时会失败；只有尚未产生正文的网络、429 或 5xx 错误会重试一次。宿主原生失败不会静默改走 Provider。
8. 单个 Agent 失败不会覆盖其他成功答案，运行状态记为 partial。

## 本地接口

- POST /api/runs：创建 Provider API 并行运行。
- POST /api/runs/native：规划宿主原生运行，返回隔离的 Agent tasks，不调用模型厂商。
- POST /api/runs/:id/native-result：归档一个宿主原生 Agent 的公开结果。
- GET /api/runs/:id：读取任务结构和当前结果。
- GET /api/runs/:id/events：SSE 事件流。
- POST /api/runs/:id/cancel：取消运行。
- POST /api/runs/:id/retry：仅重试失败 Agent。
- GET /api/runs/:id/context：生成当前 Codex 可使用的聚合上下文。
- POST /api/runs/:id/aggregate：调用专用聚合 Agent。
- GET/PUT /api/agents：读取/保存 canonical Agent。
- GET /api/providers 与 POST /api/providers/:id/test：只公开连接状态、base URL 与默认模型并做最小测试，不返回密钥或请求头。
- GET /api/knowledge：检查实际文件与解析状态。
- GET/POST /api/parsers/...：解析器发现、验证、灰度、弃用与停用。

## v1 明确不做

- 拖拽式 Agent 工作流编排。
- 云端账号、多用户、远程数据库或向量数据库。
- 从互联网自动下载解析器。
- 让 Harness 保存密钥、调度任务或执行 Agent。
- 自动赋予外部 Agent 高风险工具权限。
