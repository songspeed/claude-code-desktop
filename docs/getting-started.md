# 首次使用指南

本文面向第一次运行 Claude Code Desktop 的使用者。完整架构和贡献流程分别见 [设计说明](design.md) 与 [开发指南](development.md)。

## 1. 准备环境

安装 Node.js LTS、npm 和 Claude Code CLI，并在终端确认 CLI 可以启动：

```bash
claude --version
```

如果该命令失败，先完成 Claude Code CLI 的安装和认证，再启动桌面应用。桌面端不会替代 CLI 的登录流程。

## 2. 安装并启动

在项目根目录执行：

```bash
npm ci
npm run dev
```

也可以先运行 `npm run typecheck` 和 `npm test` 检查本地环境。开发模式打开 Electron 窗口并启用 Vite 热更新。

## 3. 创建第一个会话

1. 在侧栏创建新会话。
2. 选择一个本地项目目录。目录必须存在且可访问；应用会使用规范化后的真实路径作为 Claude CLI 的工作目录。
3. 在组合器输入问题并发送。回复以流式 Markdown 显示，工具活动会在 transcript 中折叠展示。
4. 生成过程中可点击停止。macOS/Linux 使用 SIGTERM 后再 SIGKILL，Windows 使用 `taskkill /T /F` 终止进程树。

更改项目目录会清空该会话保存的 CLI session ID，从下一条消息开始建立新的 CLI 上下文；已有 GUI 历史消息仍会保留。

## 4. 会话、模型与授权

侧栏支持新建、切换、重命名、搜索和删除会话。会话在应用重启后从本地 JSON 恢复，首条普通提示会自动生成不超过 30 个字符的标题。

当前模型选项使用 Claude Code CLI 可识别的稳定别名：

| 选项 | 用途 |
| --- | --- |
| `sonnet` | 日常速度和能力的平衡 |
| `opus` | 复杂推理和高难度任务 |
| `claude-haiku-4-5-20251001` | 快速、轻量任务 |
| `fable` | 使用 Claude 用户配置中的 Fable 映射 |

授权模式是每个会话的设置，会在下一次请求传给 CLI：

- `acceptEdits`：默认模式，自动接受文件编辑，其余操作仍遵循 CLI 策略。
- `plan`：只分析和规划，不执行修改。
- `dontAsk`：无法自动执行的工具操作将被拒绝。
- `bypassPermissions`：跳过权限检查，可能直接执行命令或修改文件，请只在明确理解风险时使用。

当前裸 CLI 的 stream-json 没有逐操作的权限请求事件，因此桌面端提供的是会话级模式切换，不是逐次弹窗确认。

## 5. 项目文件和 Skills

在已关联项目的会话中，输入框支持 `@` 文件引用。候选项只来自项目根目录内的相对路径，并排除 `.git`、`node_modules`、`dist`、`build`、`out` 等生成目录、符号链接和项目根目录之外的路径。

Skills 页面扫描以下位置的 `SKILL.md`：

- `<项目>/.claude/skills/`
- `~/.claude/skills/`
- `~/.claude/plugins/installed_plugins.json` 注册插件下的 `skills/`

结果按项目、用户、插件作用域排序并按规范化路径去重。扫描在主进程完成，渲染层只接收名称、说明、来源和路径元数据。

## 6. 桌面斜杠命令

在输入框中独占一行输入 `/help` 可查看当前命令。支持的查询包括：

| 命令 | 说明 |
| --- | --- |
| `/mcp [list\|get <name>\|help [topic]]` | 查询 MCP |
| `/plugin [list\|details <name>\|marketplace list\|help [topic]]` | 查询插件 |
| `/doctor` | 检查 Claude CLI |
| `/agents` | 查看 Agent 状态 |
| `/memory`、`/skills`、`/status`、`/context` | 查看本地记忆、Skills、会话和上下文来源 |
| `/model`、`/permissions`、`/config`、`/compact` | 查看当前模型、授权、配置和上下文压缩状态 |

桌面端会阻止 MCP/插件安装、登录、删除、启用、禁用、更新等改变配置或凭据的操作；请在终端中显式执行。未知的 `/skill-name` 会原样交给 Claude CLI 处理。

## 7. 外观、语言和 Claude 用户配置

设置工作区支持浅色、深色或跟随系统外观，以及简体中文和英文界面。界面语言不会翻译用户提示词、项目路径或 Claude 输出。

Agent 与模型设置只编辑 `~/.claude/settings.json` 中的默认模型及模型映射字段，其他配置字段会保留。配置文件不存在时应用会显示空映射并在保存时创建目录。

## 8. 本地数据位置

会话目录是 `app.getPath('userData')/sessions/`，平台默认位置通常为：

| 平台 | 位置 |
| --- | --- |
| macOS | `~/Library/Application Support/Claude Code Desktop/sessions/` |
| Windows | `%APPDATA%\\Claude Code Desktop\\sessions\\` |
| Linux | `~/.config/Claude Code Desktop/sessions/` |

要迁移或备份会话，请在应用退出后复制整个 `sessions/` 目录。不要在应用运行时手动编辑 JSON；原子写入会保护已有文件，但不会替换人为制造的无效内容。
