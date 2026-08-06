## 1. 解析层扩展

- [x] 1.1 扩展 `electron/cli/agentTransport.ts`：新增 `thinking_count` 事件（携带估算 token 绝对值）；`TokenUsage` 增加可选 `costUsd` 与 `model` 字段
- [x] 1.2 扩展 `electron/store/types.ts`：`TranscriptNotice` 增加 `permission_denied` 变体；`TranscriptActivityState` 增加 `permission_denied`；`TokenUsage` 同步扩展
- [x] 1.3 `streamParser.ts` 解析 `system/thinking_tokens` 为 `thinking_count` 事件（取 `estimated_tokens` 绝对值）
- [x] 1.4 `streamParser.ts` 解析 `result` 的成本与模型：`total_cost_usd` 优先、`modelUsage` 回退求和、模型取主导 key，并入 `usage` 事件
- [x] 1.5 `streamParser.ts` 解析 `result.permission_denials` 为非空时发出回合级权限拒绝 `status` 通知
- [x] 1.6 `streamParser.ts` 保持容错边界：`message_delta` 的 usage、`system/status`、`input_json_delta`、`signature_delta` 继续安全忽略或按设计处理，不抛错

## 2. 组装层扩展

- [x] 2.1 `turnAssembler.ts` 维护 `liveThinkingTokens`（覆盖式更新），回合结束与中断时清零
- [x] 2.2 `turnAssembler.ts` 识别权限拒绝的工具结果（`is_error` 且文本命中拒绝模式），组装为 `permission_denied` 状态的活动更新
- [x] 2.3 `turnAssembler.ts` 组装回合级权限拒绝通知条目（复用 notice 流程）
- [x] 2.4 `turnAssembler.ts` 终止条目 `usage` 携带 `costUsd` 与 `model` 落盘

## 3. 元数据行显示

- [x] 3.1 `TranscriptView.tsx` 的 `UsageLine` 扩展：显示模型名、成本（`$` 四位小数）、缓存与耗时，缺失字段不显示
- [x] 3.2 `src/i18n.ts` 补充中英文案：成本、模型、思考 token 计数、权限拒绝等新增文案
- [x] 3.3 `src/App.css` 补充元数据行与权限拒绝提示的样式，适配浅色/深色主题
- [x] 3.4 更新 `tests/transcriptView.test.tsx`：元数据行含成本与模型的渲染断言

## 4. 思考过程显示

- [x] 4.1 `src/store/appStore.ts` 增加 `streamingThinkingTokens` 状态，随事件包更新，生成结束清零
- [x] 4.2 `ChatView.tsx` 输出签名纳入思考 token 计数，避免仅计数变化引发滚动抖动
- [x] 4.3 `ThinkingBlock` 头部显示估算 token 数（≥1000 用 `k` 缩写），无数据时仅显示状态文案
- [x] 4.4 更新 `tests/chatView.test.tsx` 与 `tests/transcriptView.test.tsx`：思考计数流式更新与回合结束清除断言

## 5. 编辑活动差异预览

- [x] 5.1 新增 `src/components/diffPreview.ts`：行级 LCS 差异计算，带 2 行上下文与 200 行上限
- [x] 5.2 新增差异渲染组件：增行绿、删行红的高亮展示
- [x] 5.3 集成 `ActivityRow`：Edit 走旧/新差异、Write 全量新增、NotebookEdit 与超限回退现有 JSON 展示
- [x] 5.4 新增 `tests/diffPreview.test.ts`：基本差异、空输入、超限回退用例
- [x] 5.5 更新 `tests/transcriptView.test.tsx`：编辑活动展开显示差异而非裸 JSON

## 6. 权限拒绝显示

- [x] 6.1 `TranscriptView.tsx`：`permission_denied` 活动状态的图标、文案与活动组汇总处理
- [x] 6.2 `TranscriptView.tsx`：回合级权限拒绝通知的 `noticeText` 渲染
- [x] 6.3 更新 `tests/transcriptView.test.tsx` 与 `tests/turnAssembler.test.ts`：权限拒绝场景断言

## 7. 测试与验证

- [x] 7.1 更新 `tests/streamParser.test.ts`：删除「忽略 thinking_tokens」旧断言，补充 `thinking_count`、成本/模型、权限拒绝解析断言，并用真实样例更新 fixture
- [x] 7.2 运行 `npm run typecheck` 与 `npm test`，全部通过（注：`workspaceFiles` 的 symlink 用例在 Windows 无开发者模式下 EPERM，属预存环境限制，与本改动无关；其余 128 项全部通过）
