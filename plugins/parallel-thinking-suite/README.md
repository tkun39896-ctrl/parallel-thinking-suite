# 并行思考

一个个人本地 Codex 插件：把同一个问题交给多个独立 Agent 并行回答，在 HTML 工作台中实时呈现每条轨道，再按需生成“聚合答案”。每个 Agent 可以使用不同的模型厂商、模型、系统提示词、共享知识库和私有知识库。

## 使用

安装或更新插件后，先新建一个 Codex 任务，让新 Skill 被加载。

- 明确说“使用并行思考回答……”或输入 `$parallel-thinking`，会启动本地服务并创建一次并行运行。
- 明确说“使用聚合答案汇总最近一次运行”或输入 `$aggregate-answers`，会读取项目归档并输出共识、分歧、风险与建议。
- 工作台默认地址是 `http://127.0.0.1:4317`。运行页负责提问、选 Agent 和查看流式结果；其他页面分别管理 Agent、API 连接状态、知识库与解析器。

为了避免误计费，普通问答、仅提及插件名称或只讨论配置时不会自动调用外部模型。

## API 密钥

密钥只从启动服务的进程环境中读取，不进入浏览器、Agent 文件、项目归档或日志：

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `DEEPSEEK_API_KEY`

工作台的“API 连接”页只显示是否已配置和连接测试结果，不显示密钥值。可用的服务端环境变量设置完成后，重新启动 Codex 或本地服务。

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

架构与数据流见 [架构说明](docs/architecture.md)。第三方依赖归属见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
