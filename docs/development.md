# 开发指南

本指南面向维护 Claude Code Desktop 的贡献者。使用应用请先阅读 [首次使用指南](getting-started.md)，架构决策见 [设计说明](design.md)。

## 本地工作流

```bash
npm ci
npm run dev
```

提交前至少执行：

```bash
npm run typecheck
npm test
npm run build
```

`npm run dev` 使用 electron-vite 启动主进程、Preload 和 React 渲染层；开发模式会打开 DevTools。`npm run preview` 仅预览已构建资源，不能替代真实 Electron 打包验收。

## 目录职责

| 路径 | 职责 |
| --- | --- |
| `electron/main.ts` | 创建窗口、注册 IPC、验证项目目录、管理 ClaudeRunner 生命周期和系统主题事件 |
| `electron/preload.ts` | 通过 `contextBridge` 暴露最小化、类型化的 `window.electronAPI` |
| `electron/cli/` | Claude CLI 启动、PATH 定位、stream-json 解析、斜杠命令、工具活动安全处理和回合组装 |
| `electron/store/` | 共享类型、会话/Transcript、外观、语言和 Claude 用户模型映射的本地持久化 |
| `electron/skills.ts`、`electron/workspaceFiles.ts` | 主进程内的 Skills 发现和项目文件候选扫描 |
| `src/ipc.ts` | 渲染层唯一的 IPC 调用封装 |
| `src/store/appStore.ts` | Zustand 应用状态、IPC 初始化和流式事件消费 |
| `src/components/` | 会话、聊天、组合器、Transcript、设置和 Skills 界面 |
| `tests/` | Vitest 单元/组件测试及经过脱敏的 stream-json fixture |
| `openspec/` | OpenSpec 变更提案、设计和可追踪任务 |

## 进程与数据流

```text
React 组件
  -> src/ipc.ts
  -> preload contextBridge
  -> ipcMain (electron/main.ts)
  -> ClaudeRunner / 只读桌面命令
  -> Claude CLI stream-json

主进程事件
  -> AgentEventEnvelope + TurnAssembler
  -> sessionStore 原子持久化
  -> claude:event IPC 推送
  -> Zustand appStore
  -> TranscriptView / ChatView
```

主进程为每个事件分配 `turnId`、序列号和时间。`TurnAssembler` 在主进程和渲染层共享，用来把文本、工具活动、重试/上下文状态和终止结果组装成有序 transcript；主进程先持久化，再转发带稳定标识的事件。

## IPC 与安全边界

- 保持 `contextIsolation: true`、`nodeIntegration: false`；渲染层不得直接使用 Node/Electron API。
- 新 IPC 必须先添加到 Preload 的受限 API，再由 `src/ipc.ts` 封装；不要让组件直接访问 `window.electronAPI`。
- 所有来自渲染层的路径、会话更新和配置写入都必须在主进程重新验证。
- Claude CLI 使用参数数组启动，不拼接 shell 命令。普通请求使用 `--print`、`--output-format stream-json`、`--include-partial-messages`、`--verbose`、`--model` 和 `--permission-mode`；有保存的 CLI session 时增加 `--resume`。
- 工具活动详情在持久化前受字节预算和敏感信息脱敏处理。日志、fixture 和文档中不得加入 token、私钥或真实项目内容。

## 状态与持久化约定

- `electron/store/types.ts` 是主进程、Preload 和渲染层共享的数据类型来源。
- GUI `Session.id` 与 Claude CLI 返回的 `claudeSessionId` 不同；后者只用于下一请求的 `--resume`。
- 会话位于 `app.getPath('userData')/sessions/`。`index.json` 保存轻量列表，`<session-id>.json` 保存消息和可选的 v2 transcript；旧消息在读入后可惰性转换为 transcript。
- 会话、外观和语言都采用临时文件后 `rename` 的原子写入。不要绕过 store 直接写入用户数据。
- `~/.claude/settings.json` 只允许通过 `claudeConfigStore` 读写默认模型和 `ANTHROPIC_DEFAULT_*_MODEL` 映射，保留其他配置字段。

## 测试策略

`npm test` 覆盖以下层级：

- 纯逻辑：stream-json 行解析、路径/命令安全、TurnAssembler、活动详情脱敏、持久化和配置 store。
- 主进程协作：ClaudeRunner 参数与终止行为、项目 `cwd`、会话恢复、Skills 和文件扫描。
- 渲染组件：组合器状态、聊天空态、Transcript、设置、搜索、视觉令牌和无障碍属性。

浏览器式单元测试不替代真实桌面环境。macOS/Windows/Linux 的安装包、登录 shell PATH、真实 CLI 流式输出和进程终止需要按 [三端验收矩阵](validation-matrix.md) 进行实机检查。

## 调试建议

- 开发模式默认打开 DevTools；渲染层问题从 React 状态和 `src/ipc.ts` 开始，主进程问题从终端输出和 IPC handler 开始。
- CLI 不可用时先在同一用户终端运行 `claude --version`，再检查应用内 CLI 状态；不要把认证信息写入测试或日志。
- 调整 stream-json 解析前，先添加或更新脱敏 fixture 和 `streamParser.test.ts`，再修改解析器。
- 修改持久化格式时保持旧会话可读，并为迁移/失败写入补测试。涉及运行时要求的改动先创建或更新 OpenSpec 变更。

## 文档事实来源与检查清单

下列文件是文档内容的优先事实来源：`package.json`（脚本、依赖、产物）、`electron.vite.config.ts`（三入口）、`electron/main.ts`/`preload.ts`/`src/ipc.ts`（进程边界）、`electron/store/`（数据）、`electron/cli/`（CLI 行为）、`tests/`（自动化覆盖）。

提交前检查：

- [ ] 新旧文档链接和路径存在，命令与 `package.json` 完全一致。
- [ ] 没有将待验证平台行为标记为已完成，也没有复制敏感配置示例。
- [ ] 新 IPC、持久化或 stream-json 行为具备对应测试。
- [ ] 已运行 `npm run typecheck`、`npm test`；触及构建配置时还运行 `npm run build`。
- [ ] 已更新受影响的 README、设计说明、验收矩阵或 OpenSpec 任务。
