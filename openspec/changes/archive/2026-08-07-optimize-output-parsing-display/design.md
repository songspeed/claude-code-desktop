## Context

动机与范围见 `proposal.md`。相关现状：

- 工作区已有一批未提交实现：思考增量流式解析与折叠块（`ThinkingBlock`）、回合 token 用量行（`UsageLine`）、代码块头部与流式围栏容错、活动详情 JSON 语法高亮、Windows `.cmd/.bat` spawn 修复。
- 实测 Claude Code CLI 2.1.222 真实 `stream-json` 事件流（本机抓取三个样例），当前解析器未覆盖的事件：`system/thinking_tokens`（每思考增量一条，携带 `estimated_tokens` 绝对值）、`system/status`、`stream_event` 的 `message_delta`（携带实时 usage）、`input_json_delta`/`signature_delta`；`result` 携带 `total_cost_usd`、`modelUsage`（含 `costUSD`、`contextWindow`、模型名 key）、`ttft_ms`、`num_turns`、`permission_denials`。
- 实测结论：Edit 工具在 2.1.222 的 tool_result 只返回成功摘要文本，**不含 diff**；其输入含 `old_string`/`new_string`。多轮工具循环中每轮都有独立的 thinking → tool_use → tool_result 序列，`result` 为整回合累计。
- 现有 `TranscriptNotice` kinds：`retry`、`context_compacted`、`task_progress`、`requesting`。现有 `TranscriptTerminalEntry` 已有 `usage` 可选字段（WIP）。

## Goals / Non-Goals

**Goals:**
- 解析层补齐上述真实事件，全部容错（字段缺失不报错、不发事件）。
- 元数据行扩展为「模型 · ↑输入 · ↓输出 · 缓存 · 成本 · 耗时」，随回合持久化。
- 思考块头部实时显示估算 token 数。
- 编辑活动差异预览（自算，不引入依赖）。
- 权限拒绝的双通道提示（活动级 + 回合级）。
- 既有测试边界同步更新，全量测试通过。

**Non-Goals:**
- 不展示 `input_json_delta`（完整 input 随 `assistant` 事件到达，无展示窗口期）、`signature_delta`、`ttft_ms`/`num_turns`（不进默认元数据行）。
- 不提供成本显示设置开关（默认显示，后续按反馈再议）。
- 不做会话累计成本、文件路径点击打开。
- 不引入 diff 库；不从传输结果解析 diff。

## Decisions

### 1. 元数据的数据来源与结构

`result` 是整回合（含多轮工具循环）的权威累计值。扩展 `TokenUsage` 增加可选 `costUsd` 与 `model` 字段：

- `costUsd` 优先取 `result.total_cost_usd`；缺失时回退 `modelUsage` 中模型的 `costUSD` 求和（多模型 fallback 场景）。CLI 顶层字段是权威值。
- `model` 取 `result.modelUsage` 的模型 key；多模型时仅显示主导模型（首个 key）。不用 `assistant.message.model`（每轮重复且与 result 需额外关联）。
- 保留现有 token 与 `durationMs` 映射不变；`cache_creation_input_tokens` 映射为 `cacheWriteTokens`。

替代方案：从 `message_delta.usage` 做实时累计——放弃，`result` 一次性到达，实时累计的展示窗口仅几秒，收益低于复杂度。

### 2. 思考 token 计数的协议处理

`system/thinking_tokens` 的 `estimated_tokens` 是**绝对值**（每次刷新当前估算总量），`estimated_tokens_delta` 是增量。处理采用绝对值覆盖式更新，避免增量累加漂移：

- 事件流中每个 `thinking_delta` 后紧跟一条 `thinking_tokens`；新事件 `thinking_count` 携带最新绝对值，在 `TurnAssembler` 维护 `liveThinkingTokens`，回合结束清零。
- 思考块头部在流式期间显示 `思考 · ≈1.2k`；≥1000 时以一位小数 + `k` 缩写，否则原值；无数据时仅显示「思考」文案。
- 渲染层已用输出签名（`getTranscriptOutputSignature`）控制自动滚动，计数仅改头部文字，不触发正文重排。

### 3. 差异预览：自算行级 LCS

不引入 diff 依赖（项目无现成 diff 库）。在 `src/components` 下新增轻量 `diffPreview.ts`：

- Edit：对 `old_string`/`new_string` 按行分割，做行级 LCS（O(n·m)，上限各 200 行），输出 `+`/`-`/`=` 行序列，前后保留 2 行上下文，渲染为增绿删红的高亮块。
- Write：无旧内容，展示全量 `content` 作为新增行。
- NotebookEdit：结构复杂（cell 索引），不做 diff，回退原始 JSON 展示。
- 超出 200 行限制：回退 `DetailBlock` 的现有 JSON 高亮展示并沿用既有截断提示。
- 脱敏与大小限制沿用 `activitySafety`（输入在组装层已受限）。

替代方案：`diff` npm 包——引入新依赖且收益有限，否决。

### 4. 权限拒绝的双通道识别

- 活动级：`user/tool_result` 的 `is_error: true` 且文本匹配拒绝模式（`permission`/`authorized`/`granted`/`denied`，中英文）时，活动状态标记为新的 `permission_denied`（复用 failed 视觉 + 专属文案）。
- 回合级：`result.permission_denials` 非空数组时，追加 `kind: 'permission_denied'` 的 `TranscriptNotice` 条目（扩展联合类型），显示被拒绝的操作摘要。
- 文本匹配仅作活动级辅助（要求 `is_error` 前提），回合级以 `permission_denials` 数组为权威，避免误报。

### 5. 持久化与恢复

`TranscriptTerminalEntry.usage`（WIP 已有）承载扩展后的 `TokenUsage`；旧会话无 `usage` 字段时 `UsageLine` 返回空，无需迁移。思考过程 SHALL NOT 落盘（`liveThinking` 不进入提交，回合结束即清空，WIP 已符合）。

## Risks / Trade-offs

- `result` 字段随 CLI 版本漂移 → 所有字段可选解析 + 类型收窄；测试 fixture 锁定 2.1.222 真实样例。
- LCS 在 200 行限制内可控，但超限回退依赖正确触发 → 行数检查前置，超限直接回退，不降级性能。
- `thinking_tokens` 高频（每思考增量一条）→ 事件仅更新一个数字状态，不追加文本、不触发正文重渲染；对 `getTranscriptOutputSignature` 增加计数参数避免滚动误触发。
- 成本字段可能缺失（本地自定义模型或旧版 CLI）→ 元数据行按字段存在性渲染，缺省即不显示。
- 权限拒绝文本匹配可能误报 → 活动级匹配必须同时满足 `is_error`，回合级以 `permission_denials` 为准。

## Migration Plan

- 无数据迁移：`usage` 为可选字段，旧会话自然兼容。
- 与 WIP diff 的关系：WIP 作为基础保留，实施从解析层补齐开始，逐层覆盖；现有测试断言（如「忽略 thinking_tokens」）在对应任务中同步更新为新边界。

## Open Questions

- 成本显示是否需要设置开关、默认值是否保持显示——可延后，按用户反馈决定，不改 spec。
- 多模型（fallback）回合的元数据行是否要展示全部模型——先显示主导模型，后续按需扩展。
