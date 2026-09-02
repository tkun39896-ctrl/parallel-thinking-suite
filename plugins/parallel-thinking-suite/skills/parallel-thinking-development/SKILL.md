---
name: parallel-thinking-development
description: 为 Parallel Thinking Suite 插件的实现、修复、重构、测试、UI、文档或发布迭代执行仓库约束、隔离测试、Node 24 构建和只读生产验收。普通用户调用并行思考或聚合答案时不要触发。
---

# 并行思考开发生命周期

用同一条安全开发链路维护本仓库，不把产品 Skill 的模型调用能力带入开发验证。

## 开始

1. 完整读取仓库根目录 `AGENTS.md` 指定的交接稿、README、架构与解析器治理文档。
2. 检查工作树，区分本轮改动与已有改动。不得覆盖或清理不相关内容。
3. 明确本轮影响：Agent、Provider、编排、存储、HTTP、解析器、客户端、Skill 或文档；按 `AGENTS.md` 的测试映射选择最小回归集。

## 实现与回归

- 先为可观察行为补回归测试，再实现修复；纯视觉调整至少保留生产构建与浏览器 DOM/控制台证据。
- 测试只能使用假密钥和 mock Provider 响应。设置 `PARALLEL_THINK_DISABLE_KEYCHAIN=1`，不得读取 macOS Keychain，也不得发出真实模型请求。
- 维护四个直连/聚合边界：OpenAI、Anthropic、DeepSeek、OpenRouter 独立可选；宿主原生并行仍是未显式点名 Provider 时的首选。
- 维护存储边界：全局配置在全局 home；运行历史在项目 `.parallel-think/runs`；不同项目不得串读。
- 新安装的 Agent 目录保持空白。示例 Agent 只能由测试或用户显式导入。

## 验证门禁

1. 使用 Node.js 24，在插件目录运行 `npm run check`。它必须依次通过 Skill 包校验、类型检查、全套测试和生产构建。
2. 服务端或客户端有实质变化时，用隔离的临时 global home 与 project root 启动构建产物；禁用 Keychain、清除所有 Provider key 环境变量。
3. 在本地工作台只做读操作：验证目标页面、响应式布局和浏览器控制台。不要点击连接测试，不要提交问题或聚合。
4. Skill 源发生变化时，运行一次新的 Skills Auditor `integrate` 计划；汇报变更、noop、归档和删除范围。没有用户对该计划的明确批准就停下，不执行 apply；不得执行旧计划。

失败时保留首个根因和可复现证据。不要通过换模型、读取真实 Key、跳过失败测试或扩大删除范围来让门禁变绿。
