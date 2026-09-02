# Parallel Thinking Suite：OpenRouter 改造与素材包实验

## 任务目标

先把本仓库作为独立的本地 Codex 项目维护，不要把当前版本直接安装进 `oss-traffic-ops`。

完成以下闭环：

1. 为 Parallel Thinking Suite 增加原生 `openrouter` Provider。
2. 允许每个 Agent 独立选择 OpenRouter 上的模型，并保留现有 OpenAI、Anthropic、DeepSeek 直连方式。
3. 完成类型检查、单元测试和生产构建。
4. 代码稳定后，在本仓库内重新使用 Skills Auditor 生成安装计划、等待批准、安装并验证两个 Skill。
5. 使用“素材包与研究问题”进行一次真实的多模型并行实验，再聚合比较答案质量。

## 当前状态

- 上游仓库：`tkun39896-ctrl/parallel-thinking-suite`
- 克隆时提交：`7357df77a2f7e6440495d4cbea0f603e09005f1b`
- 当前开发分支：`codex/openrouter-provider`
- Node 要求：`>=24`；系统默认 Node 是 20，可使用 Codex bundled Node 24。
- 旧安装计划：`/Users/j.z/code/oss-traffic-ops/.skills-auditor-local/plans/plan-8ee8bcc8ea91e1b09988.json`
- 旧计划尚未 apply。不要执行它；修改 Skill 源树后，它的哈希会过期。
- 当前进程没有 `OPENROUTER_API_KEY`。不得把真实 Key 写入仓库、Agent 定义、浏览器状态、日志或运行归档。

## OpenRouter 实现基线

按 OpenRouter 官方接口实现，不要仅把它伪装成 `openai`：

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `OPENROUTER_BASE_URL`，默认 `https://openrouter.ai/api/v1`
- 优先支持流式 `POST /chat/completions`；如使用 Responses，则调用 `POST /responses`，不要重复拼接 `/v1`。
- 可选请求头：`HTTP-Referer`、`X-OpenRouter-Title`；必须由服务端配置，不要进入浏览器密钥面。
- Agent 配置中的 `provider` 应可选择 `openrouter`，`model.name` 使用 OpenRouter model slug。
- 至少支持手工输入 model slug；如果实现模型目录，必须由服务端访问 `GET /models`，前端不接触 Key。
- Provider 状态页应显示是否配置、公开 base URL 和所选 model，但绝不返回 Key。
- 聚合 Agent 也应能选择 OpenRouter。

官方基线：

- https://openrouter.ai/docs/quickstart
- https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request
- https://openrouter.ai/docs/api/api-reference/responses/create-responses

## 验收条件

- `ProviderId`、配置模板、服务端 Provider、Agent 编辑界面和文档都包含 `openrouter`。
- 不破坏三个现有 Provider。
- 增加测试覆盖：URL 拼接、Bearer Header、模型 slug、流式增量与 usage、缺少 Key、429/5xx、部分 Agent 失败、归档脱敏。
- `npm run check` 在 Node 24 下通过。
- 本地服务仍只监听 `127.0.0.1`。
- 不打印或归档任何 API Key。
- 修改稳定后重新运行：

  ```bash
  skills-audit integrate \
    --source plugins/parallel-thinking-suite/skills \
    --target codex
  ```

  先展示新计划；获得用户批准后才 apply，并紧接着 verify。

## 素材包与研究问题

### 真正要回答的问题

Agent Skills / Plugins 的传播、安装和跨客户端复用越来越便宜，但审查主文件、引用文件、脚本、依赖、权限与后续变化仍然昂贵：

> 当第三方内容发生了足以改变 Agent 行为的变化，过去的信任是否还能自动沿用？什么变化应该重新触发检查、授权和审计？

朋友提出的类比是：“推荐一本书只要几秒，真正读完却很贵。”这个类比可以解释传播成本与理解成本的不对称，但需要检验它能否推出“现阶段外部流量引入比后端反馈闭环更优先”。

### 已有判断

- 模块化允许第三方独立变化；安全要求足以改变行为的变化重新接受检查和授权。
- Agent Plugins 1.0 主要统一包结构与兼容接口，但没有统一定义信任模型、权限、沙箱、来源完整性、生命周期审计和重新授权触发条件。
- 固定版本的书读完后不会变化；Skill 可能引用后续变化的文件或脚本，因此旧理解和下一次执行之间存在时间差。
- AI 可以降低浏览、比较和枚举变化的机械成本，但不能替用户判断行为是否可接受，也不能保证未来执行内容不变。
- 外部 touch points 解决发现和首次访问；反馈闭环解决理解、激活、留存、复用与持续信任。优先级必须由漏斗证据判断，不能只靠类比。

### 产品边界

`skills-auditor`：

- 能以 plan、批准、apply、receipt、verify 形成可检查流程，让 receipt 范围内的本地变化可见。
- 不是恶意代码扫描器、语义安全证明、统一签名系统或沙箱；不防止两次 verify 之间发生变化。

`subagent-harness`：

- 以 `.agent.md` 为 SSOT，生成多运行时格式，检查 schema、声明契约和生产产物偏离。
- 不证明实际运行语义完全一致，不负责权限沙箱、Skill 到工具绑定或恶意内容判断。

### 并行实验建议

不要让所有模型重复写同一篇文章。至少设置四条独立轨道：

1. **理论结构**：用模块化、信息不对称、委托代理和持续保障解释天然冲突。
2. **增长策略**：判断 GitHub/NPM 外部 touch points 与产品反馈闭环的真实优先级及验证指标。
3. **批判反方**：寻找书籍类比、事件关联和产品定位中的过度推断。
4. **编辑重构**：把问题改写成普通开发者能一次读懂的中文叙事。

尽量选择来自不同模型家族的 OpenRouter model slug。每条轨道只输出公开结论，不请求隐藏思维链。记录成功、失败、延迟和 token usage；失败模型不能算作参与结果。

聚合时输出：

- 共识；
- 关键分歧及原因；
- 被推翻或收回的假设；
- 对外文章的一个核心命题；
- 外部引流与反馈闭环各自的最小验证动作；
- `skills-auditor` 与 `subagent-harness` 不应声称解决的部分。

## 工作原则

- 先读现有架构、解析器治理文档和测试，再改代码。
- 不修改或提交用户的真实密钥。
- 不把模型失败包装成成功。
- 不安装旧版本 Skill；任何安装都必须基于修改后的新哈希计划。
- 保留第三方上游提交信息，所有本地修改都留在当前开发分支。
