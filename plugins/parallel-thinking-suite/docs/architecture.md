# 并行思考：架构与运行边界

## 产品目标

“并行思考”是个人本地 Codex 插件。用户在当前对话明确调用后，同一个问题会被多个独立 Agent 并行分析，HTML 工作台通过 SSE 实时展示每条结果轨道。下一轮可由当前 Codex 或专用聚合 Agent 汇总共识、分歧、风险和行动。

## 核心边界

- Codex Skill 负责理解当前自然语言、选择 Agent、整理上下文和调用 CLI。
- 本地服务是任务、权限、运行状态和厂商 API 的唯一真相源。
- subagent-harness@0.5.2 负责读取、校验并解析 .agent.md；.agent.ext.yaml 的 parallelThinking 命名空间由本插件校验。
- Agent 配置是唯一真相源。HTML 配置页直接保存 canonical 文件，不维护第二套数据库。
- API Key 只从服务端环境变量读取，不进入浏览器、Agent 文件、请求归档或日志。
- 外部模型只返回公开最终答案和用量，不要求或展示隐藏思维链。

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

1. Skill 根据“自动、全部、点名”模式选择已启用的普通 Agent；聚合器不会混入普通并行。
2. 本地服务创建运行编号、任务结构与每个 Agent 的 queued 状态。
3. 知识路由器读取共享/私有目录，解析器按文件 SHA-256 与解析器版本命中缓存。
4. 全局并发默认 6、每个 Provider 默认 2。每个 Agent 独立调用 OpenAI、Anthropic 或 DeepSeek。
5. 标准事件为 started / text_delta / usage / completed / failed / cancelled，页面用 SSE 增量更新。
6. 30 秒无首字或 180 秒总超时会失败；只有尚未产生正文的网络、429 或 5xx 错误会重试一次。
7. 单个 Agent 失败不会覆盖其他成功答案，运行状态记为 partial；失败 Agent 可在新运行中单独重试。

## 本地接口

- POST /api/runs：创建并行运行。
- GET /api/runs/:id：读取任务结构和当前结果。
- GET /api/runs/:id/events：SSE 事件流。
- POST /api/runs/:id/cancel：取消运行。
- POST /api/runs/:id/retry：仅重试失败 Agent。
- GET /api/runs/:id/context：生成当前 Codex 可使用的聚合上下文。
- POST /api/runs/:id/aggregate：调用专用聚合 Agent。
- GET/PUT /api/agents：读取/保存 canonical Agent。
- GET /api/providers 与 POST /api/providers/:id/test：只公开连接状态并做最小测试。
- GET /api/knowledge：检查实际文件与解析状态。
- GET/POST /api/parsers/...：解析器发现、验证、灰度、弃用与停用。

## v1 明确不做

- 拖拽式 Agent 工作流编排。
- 云端账号、多用户、远程数据库或向量数据库。
- 从互联网自动下载解析器。
- 让 Harness 保存密钥、调度任务或执行 Agent。
- 自动赋予外部 Agent 高风险工具权限。
