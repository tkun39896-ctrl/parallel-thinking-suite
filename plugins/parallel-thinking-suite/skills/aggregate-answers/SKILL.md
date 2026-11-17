---
name: aggregate-answers
description: 当用户明确说“使用聚合答案”“调用聚合答案”，或明确要求汇总最近一次或指定并行思考运行时，读取已归档的多 Agent 结果并输出共识、分歧、风险和可执行建议。普通总结请求且不存在并行运行上下文时不要误触发。
---

# 聚合答案

读取一次“并行思考”运行的公开结果，在当前 Codex 对话中完成高质量汇总，或按用户要求交给专用聚合 Agent。

## 本地运行前置条件

在执行下文的 CLI 或构建命令前，运行 `node --version`，确认使用 Node.js 24 或更新的受支持版本。若默认 `node` 版本过旧，选择已安装的兼容 Node 可执行文件，并在本次命令中使用其绝对路径（或仅为该次命令设置 PATH）；不要修改全局 shell 配置。后文的 `node` 均指这个已核实的运行时。

插件根目录需要存在 `dist/cli.mjs` 和已安装的 `node_modules`。缺失时按[插件 README](../../README.md)在规范源码目录执行 `npm ci` 与 `npm run build`，并让 npm 使用同一兼容 Node。不要在运行前跳过构建，也不要把依赖或构建产物写入用户的运行数据目录。

## 执行

1. 默认目标是当前项目最近一次运行 `latest`；用户给出运行编号时使用该编号。
2. 在本 Skill 目录向上两级找到插件根目录，运行 `node <插件根目录>/dist/cli.mjs context --run <latest或runId> --project-root <当前项目根目录>`。
3. CLI 输出可公开的聚合上下文，不包含 API 密钥或请求头，并标明本次运行使用 `host-native` 还是 `provider`。基于它输出：各 Agent 核心判断、共识、关键分歧及原因、遗漏、证据与假设边界、风险与反方观点、推荐方案、仍需用户决定的问题，并注明来源 Agent。宿主没有报告实际模型或 token 用量时保持未知，不得根据 Provider 回退配置猜测。
4. 用户明确要求“用聚合 Agent”时，改用 `node <插件根目录>/dist/cli.mjs aggregate --run <latest或runId> --project-root <当前项目根目录>`。返回聚合结果和运行编号。专用聚合失败时保留原始 Agent 结果，并在当前 Codex 中继续汇总。

不得声称读取了未归档或失败 Agent 的完整答案，不展示隐藏思维链。
