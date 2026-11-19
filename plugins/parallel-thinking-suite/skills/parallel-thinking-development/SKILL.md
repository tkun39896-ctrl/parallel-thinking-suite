---
name: parallel-thinking-development
description: 为 Parallel Thinking Suite 插件的实现、修复、重构、测试、UI、文档或发布迭代执行仓库约束、隔离测试、Node 24 构建和只读生产验收。普通用户调用并行思考或聚合答案时不要触发。
---

# 并行思考开发

维护本插件时，先完整读取根 `AGENTS.md` 指定的交接、README、架构与解析器治理
文档；检查工作树，保留他人改动，按实际受影响层选择对应回归。执行前核实
[Node 与构建条件](../../docs/skill-runtime.md)。

- 行为修复先补可观察回归；纯视觉修改保留生产构建和 DOM/控制台证据。
- 测试设 `PARALLEL_THINK_DISABLE_KEYCHAIN=1`，清除四个 Provider key 环境变量，
  仅用假密钥/mock 响应。不访问真实 Keychain，不发模型请求。
- 保持四个 Provider 独立选择、未指定 Provider 时原生优先；全局配置留在 global
  home，项目历史留在各自 `.parallel-think/runs`；新 Agent 目录空白，示例只显式导入。
- 在插件目录以 Node 24 运行 `npm run check`，通过 Skill 校验、类型、全套测试、
  生产构建。保存首个失败根因，不能跳测试、换模型或用真 Key 使其通过。
- 服务端/客户端实质修改后，在隔离 global home/project root 启动构建，只读验证
  目标页面、响应式布局和控制台；继续禁用 Keychain/清除 keys，不点击连接测试、
  提交问题或聚合。
- Skill 源修改后，为当前 Codex 项目新建 Skills Auditor `integrate` 计划，汇报
  change/noop/archive/delete 范围。没有用户对该具体计划的明确批准就不 apply；
  不重放旧计划或扩大删除范围。
