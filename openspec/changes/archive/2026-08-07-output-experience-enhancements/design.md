# Design: 输出体验增强（第三轮）

## Context

前两轮已确立的现状（见 proposal.md 与已归档 change）：
- 渲染管线：`MarkdownContent` 基于 react-markdown 10 + rehype-highlight，**未启用 remark-gfm**，扩展语法（表格/任务列表/删除线）目前走默认解析。
- 流式正文在 `appStore.streamingText`（已节流），回合正文以 `assistant_markdown` 条目落盘，`streamingPhase`/`isGenerating`/`generatingSessionId` 提供生成状态信号。
- 发送链路：`sendMessage(prompt)` 作用于 activeSessionId，可复用为「重试」。
- `openPath` IPC 与「无工作区禁用」逻辑已在第二轮建立（`ipc.openPath`、`hasProjectContext`）。
- 会话搜索（`SessionSearchDialog`）、设置（`SettingsWorkspace`）、主题/语言（appStore actions）均已存在，命令面板可作聚合层。
- 渲染层 HTML5 `Notification` 在 Electron 渲染进程可用，无需新 IPC 通道。

## Goals / Non-Goals

**Goals:**
- 全部改动落在显示与交互层，不触碰 CLI 协议、存储 schema 与运行器（runner）。
- 每个新交互均有低风险回退路径（解析失败即显示原文本）。

**Non-Goals:**
- 不做权限审批弹窗（依赖 ACP，独立大功能）。
- 不做上下文占用百分比（CLI 无窗口大小信息，需内置模型表，易漂移）。
- 不做多会话并行生成（运行器重构级）。
- 不做 todo 清单的可交互勾选（勾选不写回 CLI，仅展示）。

## Decisions

### D1: GFM 扩展语法 —— 引入 remark-gfm 插件
在现有 react-markdown 10 管线中追加 `remarkPlugins={[remarkGfm]}`，新增运行时依赖 `remark-gfm`。表格/任务列表/删除线由插件解析为标准 mdast 节点，样式沿用现有 `.markdown-body` CSS。
- 备选：自写 remark 插件解析表格 —— 重复造轮子，放弃。
- 备选：unified 全量升级 —— 范围过大，放弃。

### D2: file:line 链接 —— 自写 remark 插件 + 组件层拦截
新增 `electron/…` 无关的纯函数插件 `remarkCodePathLinks`（自写，`src/components/markdown/` 下）：遍历 mdast 文本节点，匹配 `(?:^|[\s(（])` 边界 + 路径（含 `/` 或 `\`，或以常见源码扩展名结尾）+ `:` + 1~6 位数字，替换为 `link` 节点（`url = ccd-file://<path>:<line>`），并转义时间 `12:30` 等误匹配（要求路径片段含 `/`、`\` 或代码扩展名，缺一即不匹配）。
渲染层在 `MarkdownContent` 的 `components.a` 中识别 `ccd-file://` 协议：解析相对路径 → 拼接工作区根（复用现有 `resolveAbsolutePath` 逻辑）→ `ipc.openPath`；无工作区/越界/`desktop.projectPath` 为空时该链接不可点击（样式降级为普通文本，不触发任何 IPC）。
- 备选：组件层字符串替换 —— react-markdown 的 components 无法安全改写文本节点内的子串，易破坏 token，放弃。
- 备选：rehype 层处理 —— 需处理 html 节点转义，复杂度更高，放弃。

### D3: todo 实时进度 —— 纯显示层派生，不落盘
新增 hook `useTodoProgress(text)`（放 `src/components/useTodoProgress.ts`，与 `useThrottledStream` 同级）：对输入文本按行扫描 `^(\s*)[-*]\s*\[([ xX])\]\s*(.+)$`，仅当同列表块内勾选项与未勾选项共存（或块内≥2 项）时认定为一个 todo 块，输出 `done`/`total` 与边界校验（计数钳制在 `[0, total]`，防止流式编辑瞬时越界）。
- 生成中：`ChatView` 在 streaming 区顶部显示「待办 done/total」进度条（细条 + 百分比文本），订阅 `streamingText` 实时更新。
- 回合结束：在 terminal 摘要区渲染「待办 done/total」徽章，数据源为该回合落盘的 `assistant_markdown` 文本（重放解析，天然支持「追加后统计更新」）。
- 不落盘任何新字段；会话重载后由已存正文重新解析得到同一统计（满足 spec「会话重载后仍存在」）。
- 备选：流式阶段由解析器（turnAssembler）提取并落盘 —— 侵入运行器与存储 schema，放弃。

### D4: 重试 —— 复用 sendMessage 链路
`appStore` 新增 action `retryLastTurn(sessionId: string)`：取该会话 transcript 中最后一个 user 类型条目的 `text`，校验非空且无生成进行中（复用 `taskRunningElsewherePlaceholder` 逻辑，冲突时置 `statusText`），随后调用既有 `sendMessage(text)`。UI 上 `TranscriptView` 的 terminal 条目在 `outcome === 'error' | 'interrupted'` 时显示重试按钮（`RotateCcw` 图标，样式沿用现有图标按钮类）。
- 备选：新建独立发送通道 —— 与现有发送/取消/CLI 可用性检查重复，放弃。

### D5: 复制整回合 —— 拼接文本 + navigator.clipboard
`TranscriptView` 在回合 terminal 头部（UsageLine 同排）新增复制按钮：将该回合全部 `assistant_markdown` 条目按顺序拼接（条目间空行），`navigator.clipboard.writeText` 写入，成功后短暂显示「已复制」反馈。无正文时按钮禁用（`disabled`）。
- 备选：复制到 `ipc` 剪贴板 —— 渲染层 clipboard API 已可用且无权限问题，放弃主进程通道。

### D6: 系统通知 —— 渲染层 HTML5 Notification
新增 hook `useRoundEndNotifications()`（`App.tsx` 挂载）：订阅 `isGenerating` 的下降沿（true→false），结合 `generatingSessionId` 对应会话标题、`statusText`/outcome 判定结果（成功：有新增正文；失败：`statusText` 含失败语义；中断：abort 标记），构造标题「会话标题」+ 正文「生成完成/生成失败/已中断」。点击通知 `window.focus()`。为防误报，通知仅在该会话真实发生过生成（下降沿前 `isGenerating` 为 true 且该会话 transcript 有变化）时触发。
- 备选：主进程 `new Notification` + 新 IPC —— 需 main 监听回合结果并新增通道，且 main 层难以获知会话标题，放弃。

### D7: 窗口标题 —— App 层 effect
`App.tsx` 新增 effect：订阅 `generatingSessionId`/`isGenerating`/`sessions`，组合为 `document.title = isGenerating ? `${title} · 生成中…` : title`（无标题用「Claude Code Desktop」）。纯渲染层，无 IPC。

### D8: 输入历史 —— Composer 内局部状态
`Composer` 新增 `historyRef`（`string[]`，会话级）+ `historyIndexRef`；仅在「补全列表为空且无 filesLoading/skillsLoading」时，↑/↓ 触发历史导航（回填到 `input`，`cursor` 置末尾），当前草稿保存在 `draftRef` 供 ↓ 返回。发送成功后将文本 `unshift` 进历史。会话切换时清空（依赖 `activeSessionId` 重置 ref）。
- 备选：历史存入 appStore —— 全局化收益低（spec 限定会话内），且引入持久化问题，放弃。

### D9: 命令面板 —— 新组件 CommandPalette
新增 `src/components/CommandPalette.tsx`，由 `App.tsx` 持有 open 状态（Ctrl+K 开关，Esc 关闭；与现有 Ctrl+, 设置快捷键并存不冲突）。动作表（本地静态定义，图标沿用 lucide）：
1. 新建会话 → `createSession()`
2. 会话搜索 → 打开 `SessionSearchDialog`（复用其 `open` 控制——由 App 传入回调）
3. 打开设置 → 触发现有设置打开逻辑
4. 切换外观主题 → 循环 light/dark/system 调用 `setAppearancePreference`
5. 切换语言 → 循环 zh-CN/en-US 调用 `setLocale`
6. 打开项目目录 → `chooseProjectDirectory()`（无工作区时该项禁用）
实现复用 `SessionSearchDialog` 已有的键盘导航模式（↑/↓/Enter/Esc + 结果过滤）。

## Risks / Trade-offs

- [file:line 误匹配（版本号 `v2.3`、时间、`http://` 片段）] → 路径必须含 `/`、`\` 或代码扩展名，且行号 ≤6 位；命中后校验文件存在才启用点击。
- [GFM 表格引入后样式溢出（长内容破坏布局）] → 表格容器加 `overflow-x: auto`，与现有代码块容器一致。
- [todo 提取在模型输出非列表式文本（如散文含 `- [ ]` 单行）时误报] → 要求块内 ≥2 项或勾选/未勾选共存才显示指示器；单行不显示。
- [通知噪音（频繁回合）] → 仅回合结束（非每次更新）触发，且失败/中断也仅一条；不做节流队列（低频场景）。
- [窗口标题与翻译/本地化（生成中… 文案）] → 复用现有 i18n key 机制新增 `generatingTitleSuffix`，随 locale 变化。
- [命令面板与既有 Ctrl+K 类快捷键冲突] → 全库搜索确认无 Ctrl+K 占用后注册。

## Migration Plan

纯增量：新依赖 `remark-gfm`（`npm install`）、新组件与 hooks 均新增文件，不改既有存储/协议。回滚 = 移除依赖与组件引用，无数据迁移。会话重载后 todo 统计由正文重算，无需迁移。

## Open Questions

（无——所有决策均已在此处定案；specs 与 tasks 可直接依据本设计展开。）
