# 并行思考（Parallel Thinking Suite）

这是“并行思考”宿主感知插件的源码仓库。它优先使用 Codex、Claude Code 等当前上下文管理器的原生多 Agent 能力；显式指定模型或宿主缺少原生并行时，再使用 OpenAI、Anthropic、DeepSeek 或 OpenRouter。所有路径都进入同一个本地 HTML 工作台与运行归档。

## 仓库结构

- `plugins/parallel-thinking-suite/`：插件源码、HTML 工作台、服务端、测试和文档
- `.agents/plugins/marketplace.json`：本地 Codex marketplace 入口
- [插件使用说明](plugins/parallel-thinking-suite/README.md)
- [架构说明](plugins/parallel-thinking-suite/docs/architecture.md)
- [解析器治理规范](plugins/parallel-thinking-suite/docs/parser-governance.md)

## 本地构建

要求 Node.js 24 或更高版本。

```powershell
cd plugins\parallel-thinking-suite
npm.cmd install
npm.cmd run check
```

仓库级开发约束见 [AGENTS.md](AGENTS.md)。`npm run check` 会依次校验三个 Skill 包、执行类型检查与隔离测试，并生成生产构建；面向插件实现、修复或发布的迭代由 `parallel-thinking-development` Skill 管理开发生命周期。

API 密钥只由本地服务从服务端环境或系统凭据存储解析。支持 OpenAI、Anthropic、DeepSeek 直连以及原生 OpenRouter；宿主原生运行不需要 Provider Key。请勿把真实密钥提交到仓库，可用变量名见 `plugins/parallel-thinking-suite/.env.example`。

## 本地安装到 Codex

完成构建后，在仓库根目录执行：

```powershell
codex plugin marketplace add .
codex plugin add parallel-thinking-suite@personal
```

新建一个 Codex 任务后，可使用“并行思考”和“聚合答案”两个中文 Skill。
