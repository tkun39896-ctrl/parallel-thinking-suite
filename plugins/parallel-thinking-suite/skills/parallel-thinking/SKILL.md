---
name: parallel-thinking
description: 当用户明确说“使用并行思考”“调用并行思考”，或明确要求多个模型、多个子 Agent 并行独立回答当前问题时，优先使用当前 Codex、Claude Code 等宿主提供的原生多 Agent 环境，并用本地工作台归档和展示结果；只有显式指定 Provider/模型或宿主不支持原生并行时才调用模型 API。仅讨论名称、询问功能或普通单模型问答时不要启动。
---

# 并行思考

用户明确调用本 Skill 或要求多个模型/子 Agent 并行回答才启动；名称讨论、配置
咨询不发起请求。执行 CLI 前读[运行前置条件](../../docs/skill-runtime.md)。

## 选择执行器与任务

按顺序选择同一运行的一种执行器：用户点名 Provider、model slug 或要求比较模型
家族时用 `provider`；否则本轮实际工具提供原生委派就用 `host-native`；没有原生
能力才回退 `provider`，并告知会调用已配置 API。不要用环境变量猜能力，或因
Agent 文件含 Provider 配置绕过原生执行。原生路径不保证该文件指定的模型。

提取 query 和必要简明上下文；“只看当前问题”用 `prompt-only`，“完整上下文”用
`full`。点名 Agent 就只选该项；“全部/强制”选全部启用且勾选的普通 Agent；否则
按标签/意图选择，有正向命中只选命中项，无命中才按优先级回退。聚合器不参加。
`auto` 选择 Agent，不改变其 Provider/model；OpenRouter 的 `openrouter/auto`
是另一层选模。默认独立回答同一问题，只有用户要求分工才分配不同任务。

## 执行与归档

本目录向上两级是插件根。以下 CLI 均使用 `<插件根>/dist/cli.mjs`：

- 原生：`plan-native --stdin` 输入公共规划字段、`projectRoot` 和
  `execution: {"mode":"host-native","host":"<实际宿主>"}`。使用返回的 runId、
  url、selectedAgents、tasks；通过宿主工具并行执行每个 task 的公开 systemPrompt、
  task 和 contextPackage，各 Agent 不看其他人的未完成答案。
- 每个原生结果用 `record-native --stdin` 归档 runId、projectRoot、单个 result
  （agentId、status、公开 output）。resolvedModel、usage、error 只填真实报告值。
  失败记 failed，保留成功结果；未经用户明确批准不得静默转 Provider 重跑。
- Provider：`run --stdin` 输入公共规划字段和 projectRoot，由本地服务按 canonical
  Provider/model 调用并归档实际返回模型；打开返回 url 展示实时状态。

原生结果全部归档后打开 url。最终返回执行器、运行编号、Agent、页面和明显失败，
未完成保持未完成。只交付最终答案与公开元数据，不展示隐藏思维链。API 密钥
只由本地服务从服务端环境/凭据存储解析，不进入 JSON、任务或宿主消息。
