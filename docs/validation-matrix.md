# 三端验收矩阵

> 本文区分自动化测试、开发 Preview 和真实桌面/安装包验收。自动化通过不等同于目标平台上的 Claude CLI、PATH 或安装包已经验证。

## 自动化与构建检查

| 检查 | 命令 | 覆盖范围 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | 渲染层与主进程两个 tsconfig |
| 测试 | `npm test` | CLI 解析/执行、持久化、Skills、文件扫描、状态和主要组件 |
| 构建 | `npm run build` | electron-vite 的 main、preload、renderer 三入口 |
| macOS 打包 | `npm run package:mac` | macOS DMG/ZIP（arm64/x64） |
| Windows 打包 | `npm run package:win` | Windows x64 NSIS |
| Linux 打包 | `npm run package:linux` | Linux x64 AppImage/deb |

打包产物目录由 `package.json` 的 electron-builder 配置指定为 `dist/`。

## 验收场景

| ID | 能力 | 场景描述 |
| --- | --- | --- |
| C1 | 聊天与流式输出 | 关联项目目录后发送消息，连续收到文本/工具活动，完成后可继续输入 |
| C2 | 模型与授权 | 修改会话模型或授权模式，下一次请求使用对应 `--model`/`--permission-mode` |
| C3 | 会话与 transcript | 新建、切换、搜索、重命名、删除并重启，确认会话和历史恢复 |
| C4 | 项目上下文 | 选择目录、重启后恢复、以该目录启动 Claude、更改目录后重建 CLI 上下文 |
| C5 | 桌面命令 | 查询型斜杠命令可用，改变 MCP/插件配置的命令被明确阻止 |
| S1 | Skills 和文件引用 | 发现项目/用户/插件 Skills，`@` 只返回安全范围内的项目文件 |
| W1 | 工作台与设置 | 侧栏、空会话、组合器、设置搜索、浅/深/系统主题和中英文界面无重叠 |

## 平台验收矩阵

| 场景 | macOS | Windows | Linux |
| --- | --- | --- | --- |
| C1 聊天与流式输出 | 🔲 待实机验证 | 🔲 待实机验证 | 🔲 待实机验证 |
| C2 模型与授权 | 🔲 待实机验证 | 🔲 待实机验证 | 🔲 待实机验证 |
| C3 会话与 transcript | 🔲 待实机验证 | 🔲 待实机验证 | 🔲 待实机验证 |
| C4 项目上下文 | 🔲 待实机验证 | 🔲 待实机验证 | 🔲 待实机验证 |
| C5 桌面命令 | 🔲 待实机验证 | 🔲 待实机验证 | 🔲 待实机验证 |
| S1 Skills 和文件引用 | ✅ 单元测试 | 🔲 待实机验证 | 🔲 待实机验证 |
| W1 工作台与设置 | ✅ 开发 Preview | 🔲 待实机验证 | 🔲 待实机验证 |

## 平台特有检查

### macOS

- [ ] 从 Dock 或 Spotlight 启动后能补齐登录 shell PATH。
- [ ] 可定位 Homebrew 或用户目录中的 `claude` 可执行文件。
- [ ] 中断时 SIGTERM 后 300ms 的 SIGKILL 可干净结束进程。
- [ ] DMG/ZIP 安装或解压后可以启动，并能读写 `~/Library/Application Support/Claude Code Desktop/`。

### Windows

- [ ] 可识别 `claude.cmd`、`claude.bat` 或 `claude.exe`（按 `PATHEXT`）。
- [ ] 中断时 `taskkill /PID <pid> /T /F` 能结束进程树。
- [ ] NSIS 安装包安装后可启动，并能读写 `%APPDATA%\\Claude Code Desktop\\`。

### Linux

- [ ] 标准 PATH 或用户目录中的 `claude` 能被定位。
- [ ] 中断时 SIGTERM 后 300ms 的 SIGKILL 可干净结束进程。
- [ ] AppImage 赋予执行权限后可以运行，deb 安装后可从应用菜单启动。
- [ ] 应用能读写 `~/.config/Claude Code Desktop/`。

## 已由测试或预览覆盖的实现细节

| 项目 | 证据 | 说明 |
| --- | --- | --- |
| TypeScript 分层 | `npm run typecheck` | 检查 `tsconfig.json` 与 `tsconfig.node.json` |
| 三入口构建 | `npm run build` | main、preload、renderer 由 electron-vite 构建 |
| stream-json | `tests/streamParser.test.ts` | 经过脱敏的 2.1.222 fixture、增量文本、错误、重试和换行兼容 |
| Claude 进程 | `tests/streamParser.test.ts`、`tests/commandRunner.test.ts` | 参数数组、项目 `cwd`、错误补全、abort 和只读命令输出脱敏 |
| transcript 与活动安全 | `tests/turnAssembler.test.ts`、`tests/activitySafety.test.ts` | 顺序、终止状态、详情预算和凭据脱敏 |
| 本地持久化 | `tests/sessionStore.test.ts`、`tests/appearanceStore.test.ts`、`tests/localeStore.test.ts`、`tests/claudeConfigStore.test.ts` | 原子写入、旧会话兼容、设置受限投影 |
| 项目与 Skills | `tests/workspaceFiles.test.ts`、`tests/skills.test.ts` | 目录范围、过滤、排序和去重 |
| 主要界面 | `tests/composer*.test.tsx`、`tests/chatView.test.tsx`、`tests/transcriptView.test.tsx`、`tests/settingsWorkspace.test.tsx` 等 | 组合器、空态、Transcript、设置、侧栏和主题令牌 |

本次文档变更的真实命令结果记录在“本次执行记录”中；待 Windows/Linux/macOS 实机项在未执行前必须保持待验状态。

## 本次执行记录

| 检查 | 状态 | 结果 |
| --- | --- | --- |
| 文档链接与事实对照 | ✅ 通过 | 7 个 Markdown 文件，内部链接缺失 0，未知 npm script 0；未发现 `release/` 等旧产物路径 |
| `npm run typecheck` | ✅ 通过 | 渲染层和主进程 TypeScript 检查均通过 |
| `npm test` | ✅ 通过 | 21 个测试文件、103 个测试通过；磁盘写入失败用例会输出预期的 `ENOSPC` 日志 |
| `npm run build` | ✅ 通过 | main/preload/renderer 三入口构建成功，中间产物写入 `out/` |
