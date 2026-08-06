# Claude Code Desktop

Claude Code Desktop 是一个基于 Electron、React 和 TypeScript 的桌面工作台。它调用本机已安装的 `claude` CLI，在项目目录中提供流式聊天、会话管理、项目上下文、Skills、模型和授权模式设置。

本项目是 CLI 的 GUI 封装，不直接调用 Anthropic API，也不修改 Claude Code CLI 本体。

## 核心能力

- 通过本地 `claude` 子进程接收流式 Markdown 回复和工具活动。
- 为每个会话保存项目目录、CLI session、模型、授权模式和本地 transcript。
- 支持 Sonnet、Opus、Haiku 和用户配置的 Fable 稳定模型别名。
- 支持 `acceptEdits`、`plan`、`dontAsk`、`bypassPermissions` 会话级授权模式。
- 从项目、用户目录和已安装插件发现 Claude Code Skills，并支持在输入框中引用项目文件。
- 提供桌面端查询型斜杠命令、浅色/深色/跟随系统外观、中英文界面和 Claude 用户模型映射设置。

## 快速开始

### 前置条件

- Node.js LTS 和 npm。
- 已安装并完成认证的 Claude Code CLI。先在终端确认：

  ```bash
  claude --version
  ```

- macOS、Windows 或 Linux。GUI 启动时会补齐登录 shell 的 PATH；如果 CLI 安装在非标准目录，仍建议将其加入系统 PATH。

### 安装并启动

```bash
git clone <repository-url>
cd claude-code-desktop
npm ci
npm run dev
```

启动后，在侧栏新建会话并选择一个本地项目目录。未关联项目目录的会话不能发送请求；目录被主进程验证为真实可访问目录后，才会作为 Claude CLI 的 `cwd`。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动 Electron + Vite 开发模式和热更新 |
| `npm run typecheck` | 分别检查渲染层和主进程 TypeScript |
| `npm test` | 使用 Vitest 运行全部单元和组件测试 |
| `npm run build` | 构建 main、preload 和 renderer 三个入口 |
| `npm run preview` | 预览已构建资源，不替代桌面打包验收 |
| `npm run package:mac` | 在 macOS 构建 DMG 和 ZIP（arm64/x64） |
| `npm run package:win` | 在 Windows 构建 x64 NSIS 安装包 |
| `npm run package:linux` | 在 Linux 构建 x64 AppImage 和 deb |
| `npm run package:all` | 在具备对应工具链的环境中构建全部平台 |

构建和打包产物写入 `dist/`。Windows 和 Linux 打包应在对应平台执行；跨平台交叉打包不属于默认验收范围。

## 数据与安全

- 渲染层通过 `contextBridge` 暴露的最小化 `window.electronAPI` 访问主进程，启用 `contextIsolation`，关闭 `nodeIntegration`。
- Claude 请求使用参数数组启动本地 CLI，避免 shell 插值；项目目录由主进程选择、规范化并在每次发送前复核。
- 会话数据位于 Electron `app.getPath('userData')/sessions/`，包含 `index.json` 和按会话保存的 JSON 文件；写入采用临时文件加原子替换。
- 外观和语言偏好分别保存为 `appearance-preferences.json`、`language-preferences.json`；Claude 用户模型映射写入 `~/.claude/settings.json` 的受限字段。
- 本地会话可能包含项目路径、提示词、Claude 输出和工具详情。排障或提交 issue 时请先脱敏，不要提交 token、私钥、环境变量或完整项目内容。

## 文档索引

### 使用者

- [首次使用指南](docs/getting-started.md)：安装、首次启动、会话、项目目录、模型/权限、Skills 和桌面命令。
- [故障排查](docs/troubleshooting.md)：CLI/PATH、项目目录、数据文件和打包问题。

### 贡献者与维护者

- [开发指南](docs/development.md)：源码分层、IPC、持久化、测试、调试和提交前检查。
- [架构设计](docs/design.md)：数据流、关键决策、安全边界和主动放弃项。
- [三端验收矩阵](docs/validation-matrix.md)：自动化检查、Preview 和 macOS/Windows/Linux 实机验收状态。
- [AI 使用记录](docs/ai-usage.md)：开发过程中的模型、工具和问题修正记录，仅作历史参考。

## 许可证

本项目在 `package.json` 中声明使用 MIT 许可证。
