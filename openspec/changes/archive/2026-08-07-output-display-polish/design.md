# 设计：输出显示打磨（第二轮）

## Context

上一轮 change 已完成（28/28，未归档），当前实现基于 `streamParser → turnAssembler → appStore(flush) → TranscriptView` 的链路。重读代码确认的关键事实：

- 工具输出从 `user.tool_result.content` 经 `stringifyValue` 原样进入转写，无任何 ANSI 清理；CLI 2.1.222 的 Bash 输出（尤其失败与警告）普遍携带 `\x1b[...m` 序列
- `cache_creation_input_tokens` 已在 `toTokenUsage` 解析为 `cacheWriteTokens`（streamParser.ts:200），但 `UsageLine`（TranscriptView.tsx:152）只展示缓存读取
- `system/status` 在 parseLine 中落入 `system` 分支后无匹配子类型而被静默忽略
- 流式文本每次事件包 flush 都更新 `streamingText`，`MarkdownContent` 无 memo，每帧全量重跑 react-markdown + rehype-highlight（O(n²)）；`outputSignature` 每帧 JSON.stringify 全量 transcript
- 编辑差异预览（EditDiffBlock）只读；preload 已有 `revealProjectDirectory`，main 已有 `shell.openPath` 先例，可新增按路径打开的能力

## Goals / Non-Goals

**Goals:**
- 输出中不出现 ANSI 乱码；元数据行补全缓存写入 token
- 流式期间界面刷新有节流上限，长输出不卡顿
- 生成区显示 CLI 实时阶段信号（reading workspace 等）
- 编辑 diff 可点击打开对应文件

**Non-Goals:**
- 不做 ANSI 颜色渲染（不引入 ansi 渲染依赖；如需保留颜色信息，未来在 UI 层渲染，解析层剥离的决策不逆转）
- 不对升级前已持久化、可能含 ANSI 的历史会话做迁移清洗（只影响旧数据展示，可接受）
- 不做 transcript 虚拟化与增量渲染（大会话性能属独立主题，留待后续）
- 不做权限接管（`--permission-mode` + stdin 审批通道属大功能，需单独 proposal）

## Decisions

### 1. ANSI 剥离放在解析层（streamParser），用标准正则，零依赖

在 `stringifyValue` 的输出路径上统一剥离：`/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g`。

- **为什么解析层而非 UI 层**：剥离一次、持久化即干净，SSR、复制、历史重放全部受益；UI 层兜底会重复计算且复制路径容易漏掉
- **为什么剥离而非渲染**：渲染需要 ANSI→CSS 映射组件，引入依赖且与 markdown 高亮叠加复杂；剥离满足 spec（不显示乱码），风险最低
- 备选：UI 层 `pre` 内剥离 —— 放弃，理由如上

### 2. 缓存写入 token：纯 UI 补齐

`UsageLine` 在 `cacheReadTokens` 旁并列显示 `usageCacheWrite` 文案 + `cacheWriteTokens`（>0 才显示）。数据链路已通，无解析改动。

### 3. 实时阶段：新增 `phase_update` 事件，与 notice 体系分离

- `agentTransport` 新增 `{ type: 'phase_update', phase: string }`；`streamParser` 在 `system/status` 且 `typeof value === 'string'` 时发出
- `appStore` 新增 `streamingPhase: string | null`，flush 时取 `task.assembler.livePhase ?? null`，结束/错误/中断清零（与 `streamingThinkingTokens` 同模式）
- `TranscriptView` 生成区在 `liveStatus` 旁渲染阶段徽章；i18n 映射已知阶段（reading workspace / creating context 等）为中文文案，未知值回退显示原文
- **为什么与 notice 分离**：notice 是回合级摘要通知（重试、权限拒绝），阶段是高频瞬时信号，混用会污染 transcript 与签名比较

### 4. 流式节流：显示层 60ms 合并，签名与显示同源

- `ChatView` 内新增 `useThrottledStream(value, 60)`：60ms 窗口内合并多次更新，窗口结束提交一次；**值为空串/终态时立即提交**（回合结束不留尾帧）
- 节流后的值同时驱动 `getTranscriptOutputSignature` 与 `TranscriptView` 渲染，保证「未读输出」计数不与显示错位
- `MarkdownContent` 与 `ThinkingBlock` 用 `React.memo` 包裹：已落盘内容（引用稳定）在流式期间跳过重解析；流式内容每帧至多解析 16 次/秒
- **为什么显示层而非 appStore**：appStore flush 批处理是传输层职责，不宜耦合渲染节奏；显示层节流局部、可测（导出节流 hook，`vi.useFakeTimers` 验证）
- 备选：`useDeferredValue`（React 19 内置）—— 放弃，合并频率不可控，且 SSR 渲染断言行为不稳定

### 5. diff 定位文件：preload 新增 `openPath`，EditDiffBlock 头显路径 + 打开按钮

- preload 新增 `openPath(filePath: string): Promise<string>`（透传 `shell.openPath`，返回失败描述）；main 侧沿用 `shell.openPath` 模式
- `EditDiffBlock` 接收 `filePath` 与 `projectPath`：相对路径拼接工作区根，按钮调用 `window.ccd.openPath`；无工作区关联时按钮禁用
- 为什么不做「自动打开」：显式点击保持用户控制，符合既有「不自动打开」设计原则

## Risks / Trade-offs

- [ANSI 正则误伤正常文本（如包含 `\x1b` 字面量的内容）] → 标准 CSI 正则仅匹配转义序列形态，误匹配概率极低；剥离在解析层，若未来发现可加白名单，改动局部
- [节流引入 60ms 显示延迟] → 终态立即提交消除回合结束尾巴；60ms 低于人眼可感知的跳变阈值（与主流编辑器刷新一致）
- [历史会话可能残留 ANSI 乱码] → 明确 Non-Goal，仅影响升级前保存的旧数据；解析层剥离保证新数据干净
- [`openPath` 对不存在路径的行为] → 依赖 `shell.openPath` 返回的错误描述，UI 不阻塞

## Migration Plan

无数据迁移。行为随版本发布生效：新解析内容即时干净，历史内容不迁移。

## Open Questions

- `system/status` 的已知阶段集合与中英文案映射，可在实现期依据 CLI 实测输出补充，不影响规格与任务拆分
