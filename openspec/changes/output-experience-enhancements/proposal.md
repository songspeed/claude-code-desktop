# Proposal: 输出体验增强（第三轮）

## Why

前两轮已完成输出解析（成本/模型/缓存显示、ANSI 剥离、diff 预览、阶段徽章）与渲染打磨（节流、memo、打开路径）。对照 Codex 与 opencode 的交互模式，当前客户端仍存在五个可感知的差距：Claude 输出中高频出现的 GFM 表格与任务列表无法渲染；生成中的 todo 清单无实时进度；回合结束无通知、无重试、无整回合复制；输出中的 `file:line` 路径引用不可点击；输入侧缺少历史导航与统一命令面板。这些差距全部位于显示与交互层，不触碰 CLI 协议，可在现有架构内增量补齐。

## What Changes

- **GFM 表格 / 任务列表 / 删除线渲染**：引入 `remark-gfm`，使 markdown 表格、`- [ ]` 任务列表、删除线、脚注等按 GitHub 风格渲染，替代当前的纯文本断行。
- **`file:line` 可点击路径**：解析正文文本中的 `路径:行号` 引用，渲染为可点击链接，点击通过既有 `openPath` IPC 打开对应文件（相对路径基于当前工作区解析，越界路径禁用）。
- **Todo 清单实时进度**：生成过程中从流式文本提取 `- [ ]` / `- [x]` 任务列表，渲染为「已完成/总数」进度条（生成中实时更新；回合结束后保留为该回合的统计徽章）。
- **回合结束动作**：终端条目在失败/中断时提供「重试」按钮（重发该回合最后一条用户消息）；每条 assistant 正文提供「复制整回合」按钮（复制该回合全部 markdown 文本）。
- **系统通知与窗口标题**：回合结束（完成/失败/中断）时触发 Electron 系统通知；生成期间窗口标题显示「会话标题 · 生成中…」。
- **输入历史**：输入框支持 ↑/↓ 浏览此前发送的消息历史（无补全弹出时生效）。
- **命令面板**：新增 Ctrl+K 全局面板，聚合「新建会话 / 会话搜索 / 打开设置 / 切换外观主题 / 切换语言 / 打开项目目录」入口。

## Capabilities

### New Capabilities
- `markdown-rendering`: 富文本渲染的完整性——GFM 扩展语法（表格、任务列表、删除线）与可点击的 `file:line` 路径引用。
- `turn-progress`: 生成过程中对正文 todo 清单的结构化提取与实时进度展示。
- `desktop-integration`: 桌面感知——回合结束系统通知与窗口标题中的生成状态。
- `input-experience`: 输入侧效率——消息历史导航与统一命令面板。

### Modified Capabilities
- `agent-output-transcript`: 回合记录上新增「重试失败/中断回合」与「复制整回合 markdown」两个面向回合的操作（行为变更：终端条目获得重试与复制能力）。

## Impact

- **依赖**：新增 `remark-gfm`（配合现有 react-markdown 10）。
- **组件**：`MarkdownContent`（GFM + file:line 链接）、`ChatView`/`TranscriptView`（todo 进度条、回合结束动作、整回合复制）、`Composer`（输入历史）、`App`（窗口标题、命令面板集成、快捷键）、`SessionList`/`SessionSearchDialog`（命令面板动作复用）、`PermissionPicker`（重试按钮位置沿用现有样式）。
- **状态**：`appStore` 新增「重试回合」action（复用现有发送链路）与标题/通知所需的会话元数据读取；`desktop` IPC 无新通道（`openPath` 复用）。
- **协议/数据**：无协议变化；todo 提取与 file:line 均为显示层解析，不落盘、不改存储。
