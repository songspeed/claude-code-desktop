# 输出显示打磨（第二轮）

## Why

上一轮「优化输出解析与显示」已覆盖思考过程、成本/模型元数据、编辑差异预览与权限拒绝提示，但重读实现后仍存在几处用户可见的缺陷与性能瓶颈：Bash 等工具输出中的 ANSI 颜色码原样显示为乱码；`cache_creation_input_tokens` 已解析却未展示；流式文本每个增量都全量重跑 Markdown 解析与语法高亮，长输出会话明显卡顿；CLI 的 `system/status` 实时阶段信息被忽略；编辑差异预览只读、无法定位到实际文件。

## What Changes

- 新增 ANSI 转义序列处理：工具输出在解析/展示前剥离颜色码与光标控制序列（安全剥离，不做渲染，避免引入依赖），防止 `←[31m` 类乱码
- `UsageLine` 补充缓存写入 token 展示（`cache_creation_input_tokens` 已解析，补齐 UI）
- 流式渲染性能：对已落盘 Markdown 与流式思考内容做渲染 memo 化，并对流式增量做节流合并，避免每个 delta 全量重解析
- 生成中实时状态徽章：解析 `system/status` 阶段信息（reading workspace、creating context 等），在生成区显示当前阶段
- 编辑差异预览可定位文件：diff 头部显示文件路径，点击调用系统打开对应文件（沿用既有设计中的「不自动打开」原则，改为显式点击）

## Capabilities

### New Capabilities

- `agent-output-transcript`: 工具输出 ANSI 序列剥离、`system/status` 阶段信息的解析与展示、流式渲染性能约束（沿用上一轮同名能力目录，作为其增量需求的承载）
- `turn-usage-metadata`: 缓存写入 token 纳入元数据行展示

### Modified Capabilities

（无：`openspec/specs/` 尚无正式主规格，上一轮 change 未归档，规格全部以 delta 形式存在于各 change 内）

## Impact

- `electron/cli/streamParser.ts`：新增 ANSI 剥离与 `system/status` 解析
- `electron/store/types.ts`：新增状态/阶段字段
- `src/components/TranscriptView.tsx`、`MessageBubble.tsx`、`ChatView.tsx`：展示与性能
- `src/i18n.ts`、`src/App.css`：新文案与样式
- 无新增依赖；测试继续使用 vitest 与 SSR 渲染断言
