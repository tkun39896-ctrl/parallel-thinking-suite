# Parallel Thinking Suite development contract

This file applies to the whole repository. Runtime Agent definitions under `plugins/parallel-thinking-suite/templates/global/agents/` are product data; do not use them as a substitute for these developer instructions.

## Before changing the plugin

1. Read `TASK_HANDOFF.md`, the root `README.md`, `plugins/parallel-thinking-suite/README.md`, `plugins/parallel-thinking-suite/docs/architecture.md`, and `plugins/parallel-thinking-suite/docs/parser-governance.md` completely.
2. Inspect the current worktree and preserve unrelated or pre-existing changes.
3. Use the `parallel-thinking-development` Skill for implementation, test, refactor, security, UI, release, or packaging work on this plugin.

## Product invariants

- Prefer the current host's native multi-Agent runtime. Use Provider APIs only when the user explicitly selects a Provider/model or the host lacks native parallelism.
- OpenAI, Anthropic, DeepSeek, and OpenRouter remain independent Provider choices. Each Agent owns its Provider and model selection.
- A fresh installation has no Agent presets. Repository template Agents are examples and must not be copied into a new global home automatically.
- The primary UI navigation is `问答 / Agent / 设置`. The question view is a left project-session list plus one right sequential answer stream. Connections, knowledge, and parser maintenance remain secondary settings.
- Global configuration belongs in `PARALLEL_THINK_HOME` or `~/.parallel-think`. Run history belongs in `<project>/.parallel-think/runs`; tasks in one project share it, while different projects remain isolated.
- Do not expose hidden chain-of-thought. Persist only public outputs and non-sensitive execution metadata.

## Credential and network safety

- Never read, print, generate, commit, or write a real API key.
- Automated tests and ordinary production smoke tests must set `PARALLEL_THINK_DISABLE_KEYCHAIN=1`, remove all four Provider key variables, and mock Provider traffic.
- Do not click connection-test controls or start a Provider run during development verification.
- A real model request requires the user's explicit request for that specific live test and a separately confirmed credential path. Missing credentials are a hard stop, not permission to substitute another Provider.

## Required test mapping

- Agent schema, empty defaults, canonical round-trip, or selection: `tests/agents.test.ts`.
- Provider adapter, model routing, retries, headers, credentials, or redaction: `tests/providers.test.ts` with mocked `fetch` only.
- Host-native planning, Provider orchestration, partial failure, retry, or aggregation: `tests/orchestrator.test.ts`.
- Project/global paths, history isolation, or archive shape: `tests/storage.test.ts`.
- HTTP routes, request validation, or service boot: `tests/server.test.ts` on a random local port with isolated state.
- Parser formats, cache, sandbox, lifecycle, or knowledge ingestion: `tests/parsers-security.test.ts` and representative fixtures.
- Client changes: TypeScript, production build, and a browser smoke test of the built service at relevant responsive widths. Verify the DOM state and browser console; do not submit a model request.
- Skill changes: run the repository Skill validator and the relevant behavior-level tests. Do not rely on wording-only assertions.

Every bug fix needs a failing regression test when the behavior is testable. Prefer observable behavior and stored artifacts over implementation-detail assertions.

## Completion gate

Use Node.js 24 and run from `plugins/parallel-thinking-suite/`:

```text
npm run check
```

`check` must validate Skill packages, typecheck, run the full isolated test suite, and produce the production build. After a material server or client change, start the built service with Keychain disabled and no Provider keys, then perform a read-only browser smoke test.

When repository Skill sources change, generate a fresh plan-only Skills Auditor integration plan for the current Codex project. Report link/noop/archive counts and stop before apply unless the user explicitly approves that exact plan. Never execute an older plan.
