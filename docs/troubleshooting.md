# 故障排查

本文只给出不暴露凭据和项目内容的诊断步骤。提交问题时请附平台、应用版本、`claude --version` 输出和脱敏错误文本。

## Claude CLI 找不到或不可用

先在与应用相同的用户账户下检查：

```bash
command -v claude
claude --version
```

Windows PowerShell 使用：

```powershell
Get-Command claude
claude --version
```

桌面端启动时会合并当前进程 PATH 与 macOS/Linux 登录 shell PATH，并在常见 Homebrew、系统和用户 npm 目录中兜底查找；Windows 会按 `PATHEXT` 探测 `claude.cmd`、`claude.exe` 等文件。安装或修改 PATH 后完全退出并重新启动应用。

如果 `claude --version` 本身失败，请先在终端完成 Claude Code CLI 的安装/认证。桌面端只负责调用 CLI，不保存或修复 CLI 凭据。

## 发送后没有回复

1. 确认当前会话已关联仍存在的项目目录。
2. 在设置中刷新 Claude CLI 状态，或重新运行 `claude --version`。
3. 检查会话选择的模型是否是当前账户可用的 CLI 别名。
4. 查看界面中的错误或重试提示；不要把完整 `settings.json`、token 或项目文件粘贴到 issue。
5. 若只是某一回合卡住，点击停止后重新发送。主进程会保证每个回合只发出一个终止事件。

## 项目目录无效

应用在选择目录和每次发送前都会做真实路径解析及目录检查。目录被删除、移动、权限改变或只剩失效符号链接时，请重新选择目录。更换目录会开启新的 CLI 上下文，但不会删除 GUI transcript。

## Skills 或 `@` 文件引用为空

- 确认会话已关联项目目录。
- Skill 必须位于 `<项目>/.claude/skills/<name>/SKILL.md`、`~/.claude/skills/<name>/SKILL.md`，或已安装插件的 `skills/` 目录。
- 文件引用只扫描项目根目录，且排除 `.git`、`node_modules`、`dist`、`build`、`out` 等目录和符号链接。
- 修改文件后在 Skills 页面刷新；权限错误或无法解析的插件注册项会被安全跳过。

## 会话列表或历史记录异常

应用退出后检查 Electron userData 下的 `sessions/`：

- `index.json` 只保存会话列表元数据。
- `<session-id>.json` 保存会话、消息和 transcript。
- 写入采用 `.tmp` 临时文件再原子替换，避免中断时留下半个 JSON。

先备份整个 `sessions/` 目录，再尝试恢复。不要删除索引或会话文件来“修复”问题；这会造成不可逆的数据丢失。

## 外观、语言或模型设置没有保存

- 外观保存在 userData 的 `appearance-preferences.json`，语言保存在 `language-preferences.json`。
- Claude 模型映射位于 `~/.claude/settings.json` 的 `model` 和 `env.ANTHROPIC_DEFAULT_*_MODEL` 字段。
- 如果用户配置不是合法 JSON、`env` 不是对象或模型值包含换行，保存会被主进程拒绝；先使用 Claude CLI 或文本编辑器修复格式，再重试。
- 应用只编辑上述受限字段，其他设置会原样保留。

## 构建或打包失败

```bash
npm ci
npm run typecheck
npm test
npm run build
```

打包命令必须在目标平台执行：`npm run package:mac`、`npm run package:win`、`npm run package:linux`。产物目录由 `package.json` 配置为 `dist/`；请检查磁盘空间、目标平台工具链和 Electron builder 日志。

## 仍需人工确认的跨平台问题

自动化测试不能代替三端桌面验收。当前待确认项包括 Dock/Spotlight PATH、Windows `claude.cmd` 和进程树中断、Linux AppImage/.deb 启动、安装包启动以及真实 CLI 流式聊天。详见 [三端验收矩阵](validation-matrix.md)。
