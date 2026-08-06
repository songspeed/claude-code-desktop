# Claude Code Desktop — AI 使用记录

> 本文是开发过程的历史记录，不是安装、使用或故障排查指南。当前操作请阅读 [首次使用指南](getting-started.md)、[开发指南](development.md) 和 [故障排查](troubleshooting.md)。

## 1. 使用的 AI 能力

| 类别 | 具体项 | 用途 |
|---|---|---|
| 模型 | Claude Opus 4.8 | 主要开发 Agent |
| CLI | `claude` v2.1.221 | 实际封装的 Claude Code CLI |
| Skill | `/openspec-propose` | 生成变更 proposal |
| Skill | `/openspec-explore` | 技术选型探索、设计论证 |
| Skill | `/openspec-apply-change` | 执行实现任务 |
| 工具 | Bash（probe） | 探路 CLI 标志与 stream-json 格式 |
| 工具 | Write / Edit | 生成源代码文件 |

## 2. AI 产出的问题与修正记录

### 2.1 权限模型误判（设计阶段）

**问题：** 初始设计中将「工具权限确认」设计为 stream-json 中的事件回传机制（`onPermissionRequest` → 渲染层弹窗 → `respondPermission` → 回写子进程 stdin）。

**发现：** 通过 `claude -p "..." --output-format stream-json --verbose` 实际探路，确认 CLI v2.1.221 的 stream-json 中**无 per-operation 权限请求事件**，权限通过 `--permission-mode` 标志统一控制。

**修正：**
- 早期设计草案曾计划保留 `onPermissionRequest / respondPermission` 作为升级路线 B/C 的接口；当前 `AgentTransport` 以会话级 `permissionMode` 为准。
- 方案 A MVP 实现中，权限通过 `--permission-mode acceptEdits`（安全默认）或 `bypassPermissions`（危险放行）控制。
- 当前界面由 `PermissionPicker` 修改授权模式；“DangerSwitch”仅是早期设计阶段的组件名称，不是现行文件名。

### 2.2 stream-json 事件结构确认

**探路命令：**
```bash
claude -p "reply with exactly: hello world" \
  --output-format stream-json --verbose \
  --model claude-haiku-4-5-20251001
```

**确认的事件类型：**
```
{ type: "system", subtype: "init", session_id: "...", permissionMode: "default", ... }
{ type: "system", subtype: "thinking_tokens", ... }  ← 忽略
{ type: "assistant", message: { content: [ { type: "text", text: "..." } ] } }
{ type: "result", is_error: false, result: "...", session_id: "...", duration_ms: ... }
```

**注意：** `thinking` 类型块（CoT）在 assistant.message.content 中存在，streamParser 已过滤。

### 2.3 macOS GUI PATH 问题（预期问题，已在实现中处理）

**问题预期：** 从 Dock 启动的 Electron 进程不继承 shell 的 PATH，导致 `/opt/homebrew/bin/claude` 找不到。

**修正方案（pathHelper.ts）：** 启动时通过 `$SHELL -lc 'echo $PATH'` 获取登录 shell 完整 PATH，与当前进程 PATH 合并后用于 spawn，并追加多个 homebrew/local 路径作兜底。

## 3. 待观察项

- electron-vite v3 与 Electron 36 的兼容性（首次构建时确认）
- react-markdown v10 API 变更（rehype 插件传参方式）
- Windows 上 `claude.cmd` 的 PATHEXT 探测行为（待 Windows 验收时确认）
