---
name: parallel-thinking
description: 当用户明确说“使用并行思考”“调用并行思考”，或明确要求多个模型、多个子 Agent 并行独立回答当前问题时，优先使用当前 Codex、Claude Code 等宿主提供的原生多 Agent 环境，并用本地工作台归档和展示结果；只有显式指定 Provider/模型或宿主不支持原生并行时才调用模型 API。仅讨论名称、询问功能或普通单模型问答时不要启动。
---

# 并行思考

把当前问题交给多个独立 Agent。当前上下文宿主负责原生并行，本地服务负责 Agent 定义、任务规划、运行编号、归档、HTML 展示和聚合；Provider API 是显式路径与能力回退，不是默认路径。

## 启动条件

- 用户明确要求“使用并行思考”“调用并行思考”，或明确要求多个模型/子 Agent 并行回答时才实际发起请求。
- 仅提到名称、询问怎么用、讨论配置时只解释，不调用外部 API。
- `$parallel-thinking` 是显式调用方式，与中文自然语言触发等价。

## 执行器路由

按以下优先级选择一次运行的执行器，不要把两种执行器混在同一运行中：

1. 用户点名 OpenRouter、OpenAI、Anthropic、DeepSeek、具体 model slug，或明确要求比较不同模型家族时，使用 `provider`。
2. 否则，当前宿主只要暴露了原生子 Agent、Task、Agent Team 或等价的并行委派能力，就使用 `host-native`。在 Codex 中使用原生 sub-agent/协作工具；在 Claude Code 中使用其原生 Task/Agent 能力；其他宿主使用其公开的等价能力。
3. 宿主没有原生并行能力时，回退到 `provider`，并明确告诉用户这次会调用已配置的模型 API。

不要通过环境变量猜测宿主能力；以本轮实际可用工具为准。宿主原生运行不承诺使用 Agent 文件中的 Provider 或 model slug；这些字段只作为显式 Provider 路径和回退配置。

## 公共规划

1. 从当前对话提取用户真正要解决的 query。默认只附带必要的简明上下文；用户说“只看当前问题”时使用 `prompt-only`，说“带上完整上下文”时使用 `full`。
2. 用户说“全部/强制并行”时选择所有已启用且勾选的普通 Agent；点名 Agent 时只选点名项；否则在本地结合 Agent 的标签和意图智能选择相关 Agent。有正向意图命中时只选择命中的 Agent，完全无命中时才按优先级回退。这里的 `auto` 只负责选择 Agent，不改变 Agent 的 Provider 或模型；`model: openrouter/auto` 是之后由 OpenRouter 执行的另一层自动选模。聚合器不参加普通并行。
3. 用户要求“拆解/分工”时，为每个 Agent 写清不同子任务；否则所有 Agent 独立回答同一 query。
4. 不论使用哪个执行器，都不要把 API 密钥写入 JSON、Agent 任务或宿主消息。

## 宿主原生执行（默认）

1. 在本 Skill 目录向上两级找到插件根目录，运行 `node <插件根目录>/dist/cli.mjs plan-native --stdin`。通过标准输入传入公共规划字段、`projectRoot`，以及 `execution: { "mode": "host-native", "host": "<当前宿主>" }`。
2. CLI 返回 `runId`、`url`、`selectedAgents` 与 `tasks`。每个 task 都包含公开的 `systemPrompt`、专项 `task`、必要的 `contextPackage`，以及仅供说明的 Provider 回退配置。
3. 使用当前宿主的原生并行工具同时启动这些 task；保持各 Agent 上下文隔离，不让它们看到其他 Agent 的未完成答案。不得因为 Agent 文件里配置了 OpenRouter 就绕过宿主原生路径。
4. 每个原生 Agent 完成后，运行 `node <插件根目录>/dist/cli.mjs record-native --stdin`，传入 `runId`、`projectRoot` 与单个 `result`：`agentId`、`status`、公开 `output`，以及宿主确实报告时才填写的 `resolvedModel`、`usage` 或 `error`。不要编造模型名或 token 用量。
5. 全部结果归档后打开 `url`。单个 Agent 失败时照实记录为 `failed`，保留其他成功结果；不要静默改走 Provider 重跑，除非用户明确批准回退。

## Provider 执行（显式或回退）

1. 运行 `node <插件根目录>/dist/cli.mjs run --stdin`，传入公共规划字段和 `projectRoot`。
2. 本地服务按每个 Agent 的 canonical Provider/model 配置调用 OpenAI、Anthropic、DeepSeek 或 OpenRouter，创建运行并输出 `runId`、`url`、`selectedAgents` 和任务结构。
3. 打开返回的 HTML 地址供用户实时查看。这里的 Agent `model.name` 才是实际请求模型；OpenRouter 返回的实际模型继续进入归档。

最后在对话中返回执行器、运行编号、已选择 Agent、页面地址和明显失败；不要伪造尚未完成的结论。

所有 Agent 只返回最终答案与公开元数据，不要求或展示隐藏思维链。API 密钥只能由本地服务从服务端环境或系统凭据存储中解析。
