# 并行思考

一个宿主感知的本地并行思考插件：优先使用 Codex、Claude Code 等当前上下文管理器提供的原生多 Agent 能力，在 HTML 工作台中归档和呈现每条轨道，再按需生成“聚合答案”。显式指定模型或宿主不支持原生并行时，仍可让每个 Agent 使用不同 Provider、模型、系统提示词和知识库。

## 使用

安装或更新插件后，先新建一个 Codex 任务，让新 Skill 被加载。

- 明确说“使用并行思考回答……”或输入 `$parallel-thinking`，会启动本地服务并创建一次并行运行。
- 明确说“使用聚合答案汇总最近一次运行”或输入 `$aggregate-answers`，会读取项目归档并输出共识、分歧、风险与建议。
- 工作台默认地址是 `http://127.0.0.1:4317`。问答页左侧是会话列表，右侧按提问、各 Agent 回答和聚合答案的顺序流式呈现。一级导航只保留“问答 / Agent / 设置”，连接、知识库和文件解析收在设置的二级入口。

为了避免误计费，普通问答、仅提及插件名称或只讨论配置时不会自动调用外部模型。

默认执行器是“宿主原生优先”：当前宿主提供原生子 Agent、Task 或 Agent Team 能力时，由宿主并行执行，本地服务只规划与归档，不调用 Provider API。用户点名 OpenRouter/OpenAI/Anthropic/DeepSeek、具体 model slug、不同模型家族，或从独立 HTML 工作台直接启动时，才使用 Provider API。宿主原生失败不会未经确认自动切换成付费 Provider 请求。

## API 密钥

密钥不进入浏览器、Agent 文件、项目归档或日志。所有平台都支持从启动服务的进程环境读取：

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `DEEPSEEK_API_KEY`
- `OPENROUTER_API_KEY`

macOS 还支持把 OpenRouter Key 持久保存到登录钥匙串，服务启动时在缺少 `OPENROUTER_API_KEY` 的情况下自动回退读取：

```bash
./scripts/configure-openrouter-key.command
```

脚本使用隐藏输入写入 `parallel-thinking-suite.openrouter` 钥匙串项目；`~/.zsh_secrets` 只保存非敏感的服务名与账户名，不保存真实 Key。环境变量始终优先于 Keychain。

宿主原生运行不需要 Provider Key；Key 只在显式 Provider 路径、独立工作台运行或连接测试中使用。

OpenRouter 默认使用 `https://openrouter.ai/api/v1` 和 `openrouter/auto`。可分别用 `OPENROUTER_BASE_URL`、`OPENROUTER_MODEL` 覆盖；`OPENROUTER_HTTP_REFERER` 与 `OPENROUTER_APP_TITLE` 可选，只在服务端转成官方的应用归因请求头。Agent 配置选择 `provider: openrouter` 后，`model.name` 可填写任意 OpenRouter model slug，普通 Agent 与聚合 Agent 均适用。

本地 `selection.mode: auto` 只根据标签和意图选择 Agent，不选择模型；有正向命中时只选命中的 Agent，完全无命中时才按优先级回退。新安装默认没有 Agent，需先在工作台中填写名称与职责创建；Provider、模型和自动选择规则收在高级配置里。仓库内保留的专业 Agent 文件只作为示例模板，不会自动复制到用户目录。`openrouter/auto` 是可选的供应商自动选模能力；运行归档会同时记录请求模型和 OpenRouter 返回的实际模型。`deepseek` Provider 仍保留为独立直连选项，需要单独配置 `DEEPSEEK_API_KEY`。

工作台“设置 → 连接”只显示是否已配置、公开 base URL、默认模型和连接测试结果，不显示密钥值。可用的服务端环境变量设置完成后，重新启动 Codex 或本地服务。OpenRouter 请求遵循官方 [Quickstart](https://openrouter.ai/docs/quickstart) 与 [Chat Completions](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion) 接口。

## 配置与数据

- 全局 Agent 和 Provider 配置：`%USERPROFILE%\.parallel-think`
- 项目运行归档、知识库与项目设置：`<项目>\.parallel-think`
- 可用 `PARALLEL_THINK_HOME` 临时覆盖全局目录，适合测试或隔离环境。
- Agent 的唯一真相源是 `subagent-harness@0.5.2` 支持的 `.agent.md`，扩展字段放在同名 `.agent.ext.yaml`。

内置解析器支持文本/Markdown/代码、JSON、CSV/TSV、HTML、PDF、DOCX 和 XLSX。自定义解析器遵循注册、静态校验、隔离验证、灰度、观测、自动回滚与退役流程，完整规范见 [解析器治理](docs/parser-governance.md)。

## 本地开发

要求 Node.js 24 或更高版本。

```powershell
npm.cmd install
npm.cmd run check
npm.cmd run start
```

`npm run check` 包含 Skill 包校验、类型检查、完整隔离测试和生产构建。自动化测试禁用 macOS Keychain、只使用假密钥与模拟 Provider 响应；开发规则由仓库根目录 `AGENTS.md` 和 `parallel-thinking-development` Skill 共同维护。

架构与数据流见 [架构说明](docs/architecture.md)。第三方依赖归属见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
