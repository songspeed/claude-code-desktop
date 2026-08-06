# Claude Code Desktop 设计说明

> 本文记录当前实现的架构边界和关键决策。首次运行请看 [首次使用指南](getting-started.md)，贡献和调试请看 [开发指南](development.md)，验证范围请看 [三端验收矩阵](validation-matrix.md)。

## 项目定位

Claude Code Desktop 是本地 `claude` CLI 的桌面 GUI。应用不修改 CLI 本体、不直接调用 Anthropic API；主进程以子进程在用户选定的项目目录中运行 CLI，并通过受限 IPC 将结果交给 React 界面。

## 技术栈

| 层 | 技术 | 当前 manifest 版本 |
| --- | --- | --- |
| 桌面框架 | Electron | 36.4.0 |
| 构建 | electron-vite / Vite | 3.1.0 / 6.3.5 |
| 打包 | electron-builder | ^26.15.7 |
| UI | React / TypeScript | 19.1.0 / 5.8.3 |
| 状态 | Zustand | 5.0.5 |
| Markdown | react-markdown / rehype-highlight | 10.1.0 / 7.0.2 |
| 图标与标识 | lucide-react / uuid | ^0.468.0 / 11.1.0 |

electron-vite 构建 `electron/main.ts`、`electron/preload.ts` 和 `src/index.html` 三个入口。`tsconfig.node.json` 面向 CommonJS 主进程，`tsconfig.json` 面向 ESNext 渲染层。

## 目录结构

```text
claude-code-desktop/
├── electron/
│   ├── main.ts                 窗口、IPC、会话生命周期
│   ├── preload.ts              受限 contextBridge API
│   ├── cli/                    CLI、解析、命令、活动安全、回合组装
│   ├── store/                  共享类型和本地数据 store
│   ├── skills.ts               Skills 元数据发现
│   └── workspaceFiles.ts       @ 文件引用候选扫描
├── src/
│   ├── App.tsx                 应用工作区和设置入口
│   ├── ipc.ts                  渲染层 IPC 封装
│   ├── store/appStore.ts       Zustand 全局状态
│   └── components/             聊天、组合器、会话、Transcript、设置、Skills
├── tests/                      Vitest 测试与脱敏 fixture
├── docs/                       使用、开发、设计、排障、验收和历史记录
├── resources/                  各平台应用图标
└── openspec/                   变更规格和任务
```

## 架构与数据流

```text
渲染组件 -> src/ipc.ts -> preload contextBridge -> ipcMain
                                               |
                                               v
                    ClaudeRunner / 只读桌面命令 / Skills 扫描
                                               |
                                               v
                          本地 claude CLI 或主进程格式化结果
                                               |
                                               v
       AgentEventEnvelope -> TurnAssembler -> sessionStore -> claude:event
                                               |
                                               v
                                Zustand -> TranscriptView / ChatView
```

主进程为每个输出事件分配递增序号、回合 ID 和时间，使用 `TurnAssembler` 生成稳定的 transcript 提交。提交先写入会话文件，再通过 `claude:event` 转发；渲染层使用相同组装规则消费事件，避免文本、工具活动和终止状态因异步到达而错序。

普通对话使用保存的模型、授权模式、项目 `cwd` 以及可选 `--resume <claudeSessionId>` 调用 Claude CLI。`system/init` 的 CLI session ID 被保存到 GUI 会话；首条普通提示会在标题仍为“新对话”时生成最多 30 个字符的本地标题。

## 关键决策

### CLI 传输和授权

- 当前实现使用 `claude --print <prompt> --output-format stream-json --include-partial-messages --verbose`，由 `ClaudeRunner` 逐行解析并过滤未确认的事件类型。
- 经过 fixture 验证的能力包括增量文本、工具开始/结果和部分系统状态；未确认字段不会宣称为界面能力。
- stream-json 没有逐操作权限请求回传，因此授权通过会话级 `--permission-mode` 在请求前决定。默认是 `acceptEdits`，`bypassPermissions` 需要用户明确选择。
- macOS/Linux 中断为 SIGTERM 后 300ms 的 SIGKILL；Windows 使用 `taskkill /PID <pid> /T /F` 终止进程树。

### 项目目录、Skills 与文件引用

- 每个会话都保存可空 `projectPath`。目录只能通过主进程的系统目录选择器写入，使用 `realpath` 与目录检查规范化；发送前再次验证。
- 变更项目目录会清空 CLI session ID，让下一次请求建立新 CLI 上下文，但不删除 GUI 历史。
- Skills 从项目 `.claude/skills`、用户 `.claude/skills` 和已注册插件的 `skills/` 目录扫描，按项目、用户、插件排序并按真实路径去重。
- `@` 文件引用只扫描项目内常规文件，限制扫描量和深度，并排除依赖、构建目录和符号链接。

### 持久化与兼容性

- 会话目录为 `app.getPath('userData')/sessions/`。`index.json` 保存轻量索引，每个会话的 `<id>.json` 保存会话、兼容 messages 和 v2 transcript。
- 旧会话缺失 `projectPath`、`permissionMode` 或 transcript 时会安全回退；首次后续写入会保存规范化后的字段。
- 所有会话、外观和语言偏好使用临时文件再 `rename` 的原子写入，写入失败返回受控失败而非使主进程崩溃。
- Claude 用户设置只投影和编辑模型相关字段，避免把完整 `settings.json` 暴露给渲染层。

### UI 与设置

- 渲染层使用 Zustand 管理会话、活动会话、任务状态、流式事件、CLI 健康状态、外观、语言和受限模型配置。
- 设置工作区包含 Agent 与模型、外观、语言、Skills 和关于页面；外观支持浅色、深色和跟随系统，语言支持简体中文和英文。
- Markdown、代码高亮、工具详情、错误和中断状态使用同一组语义化主题令牌。工具活动详情在持久化前会进行脱敏和大小限制。

## 安全边界

- `contextIsolation: true`、`nodeIntegration: false`；渲染层没有通用文件系统或 shell 权限。
- Preload 只公开需求明确的 IPC 方法；主进程对路径、会话 patch 和配置写入重新验证。
- CLI 通过参数数组而不是拼接 shell 字符串启动。桌面斜杠命令只允许固定的查询型子命令；改变 MCP/插件配置或凭据的操作会被阻止。
- 本地持久化可能含聊天内容和工具详情，使用者应自行保护 userData 目录并对外部日志脱敏。

## 主动放弃项

| 放弃项 | 理由 |
| --- | --- |
| 逐操作权限确认 | 当前 stream-json 没有可靠事件；保留传输抽象以支持未来 ACP/SDK 实现 |
| SQLite 持久化 | 当前数据规模适合 JSON，native module 会增加打包复杂度 |
| 云端同步和账号体系 | 超出本地桌面客户端范围 |
| 完整 Claude Code TUI 命令集 | 只在 GUI 中支持安全、可预测的查询闭环 |
| 插件市场或主题商店 | 超出当前产品范围 |
| ACP 双向协议桥 | MVP 使用裸 CLI；如需协议能力再单独设计 |
