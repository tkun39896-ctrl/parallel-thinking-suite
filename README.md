# 并行思考（Parallel Thinking Suite）

这是“并行思考”个人本地 Codex 插件的源码仓库。它可以把一个问题交给多个使用不同模型、系统提示词和知识库的 Agent 并行回答，并在本地 HTML 工作台中实时呈现结果，再通过“聚合答案”形成共识、分歧、风险与可执行建议。

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

API 密钥只从服务端环境变量读取。请勿把真实密钥提交到仓库；可用变量名见 `plugins/parallel-thinking-suite/.env.example`。

## 本地安装到 Codex

完成构建后，在仓库根目录执行：

```powershell
codex plugin marketplace add .
codex plugin add parallel-thinking-suite@personal
```

新建一个 Codex 任务后，可使用“并行思考”和“聚合答案”两个中文 Skill。
