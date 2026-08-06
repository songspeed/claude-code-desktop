## Why

客户端对 `claude --print --output-format stream-json` 输出的解析只覆盖了协议的一部分：实测 Claude Code CLI 2.1.222 的真实事件流中，`system/thinking_tokens`、`system/status`、`stream_event/message_delta`、`result.total_cost_usd`、`result.modelUsage`、`result.permission_denials` 等携带可展示信息的事件被直接忽略。对照 opencode 的交互体验，当前界面缺少思考过程的实时计数、回合级成本/模型元数据、编辑活动的差异预览与权限拒绝提示。工作区已有一批未提交的实现（思考折叠块、token 用量行、代码块头部、流式围栏容错、Windows `.cmd` spawn 修复），本次改动把这些能力固化为完整的协议覆盖与交互设计。

## What Changes

- 解析层补齐 CLI 2.1.222 真实事件：`system/thinking_tokens`（实时估算思考 token）、`result.total_cost_usd` 与 `result.modelUsage`（回合成本与模型信息）、`result.permission_denials`（被拒绝的权限请求）、`stream_event/message_delta`（回合中途的实时用量）。
- 回合元数据行扩展：在现有 token 用量与耗时基础上增加成本（USD）与模型名；元数据随回合终止条目持久化，重新打开会话后仍可显示。
- 思考过程展示：流式思考块默认折叠，展开查看全文；流式期间在块头部实时显示估算 token 数；思考过程仅实时显示，不落盘。
- 编辑活动差异预览：从 Edit/Write 工具输入的 `old_string`/`new_string`（或 `content`）在客户端计算差异，展开工具活动时以增删高亮显示，替代裸 JSON。
- 权限拒绝提示：当回合内存在被拒绝的权限请求，或工具结果报告"未获得授权"错误时，在对应活动与回合结束处给出明确提示。
- 明确不做的部分：`input_json_delta`（完整 input 随 `assistant` 事件到达，无展示窗口期）、`signature_delta`（无展示价值）、`ttft_ms` 等极客指标不进默认元数据行（保留在解析层）。

## Capabilities

### New Capabilities

- `turn-usage-metadata`: 每个输出回合结束后展示的元数据行——token 用量、缓存读取、成本、耗时与模型名；元数据随回合持久化并在恢复会话后显示。
- `thinking-process-display`: 流式思考过程的实时展示——默认折叠、可展开、流式期间显示实时估算 token 数、不持久化。

### Modified Capabilities

- `tool-activity-details`: 编辑活动展开时在客户端计算并展示差异预览（从工具输入而非传输返回的摘要文本得出）；被权限拒绝的工具活动以明确状态与提示呈现。
- `agent-output-transcript`: 回合终止条目新增可恢复的元数据（用量、成本、耗时、模型），思考过程 SHALL NOT 持久化。

## Impact

- `electron/cli/streamParser.ts`：新增事件解析（thinking_tokens、message_delta、result 成本/模型/权限拒绝字段）。
- `electron/cli/agentTransport.ts`、`electron/store/types.ts`：事件与 transcript 类型扩展。
- `electron/cli/turnAssembler.ts`：元数据与实时思考的组装、元数据落盘。
- `src/components/TranscriptView.tsx`、`MessageBubble.tsx`、`App.css`：元数据行、思考计数、diff 预览、权限拒绝提示。
- `src/i18n.ts`：中英文案扩展。
- 测试：`tests/streamParser.test.ts`、`tests/turnAssembler.test.ts`、`tests/transcriptView.test.tsx` 更新既有边界声明。
- 无新增依赖（差异计算使用轻量实现，不引入 diff 库）。
