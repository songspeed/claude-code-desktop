# desktop-slash-commands Specification

## Purpose

让桌面客户端安全地呈现并执行可在无交互 Claude Code 会话中支持的斜杠命令，同时保留原生 Skills 的调用路径。

## Requirements

### Requirement: 组合器展示可用斜杠命令
系统 SHALL 在用户于行首输入 `/` 时，展示桌面斜杠命令及当前可用的 Claude Skills，并允许键盘或鼠标选择补全项后继续输入参数。

#### Scenario: 展示并补全桌面命令
- **WHEN** 用户在组合器行首输入 `/m`
- **THEN** 系统展示匹配的桌面命令及其简短说明，选择命令后在输入框中插入该命令和一个参数分隔空格

#### Scenario: 保留 Skill 补全
- **WHEN** 用户在组合器行首输入与已发现 Skill 匹配的文本
- **THEN** 系统在同一建议列表中展示该 Skill，选择后插入其 `/skill-name` 调用形式

### Requirement: 安全执行只读 CLI 查询
系统 SHALL 将受支持的只读 MCP、插件、诊断和 Agent 命令作为无 shell 的 Claude CLI 子命令执行，并将输出作为当前对话的 Agent 响应显示。

#### Scenario: 查询 MCP 列表
- **WHEN** 用户发送 `/mcp` 或 `/mcp list`
- **THEN** 系统执行等价的只读 Claude CLI MCP 列表查询，并在当前转录中显示输出或执行错误

#### Scenario: 查询插件详情
- **WHEN** 用户发送 `/plugin details <名称>`
- **THEN** 系统执行等价的只读 Claude CLI 插件详情查询，并在当前转录中显示输出或执行错误

### Requirement: 提供本地桌面命令响应
系统 SHALL 为帮助、记忆、Skills、状态和压缩命令基于实际客户端、项目或 Claude 配置状态生成响应，而不得伪造 TUI 会话状态。

#### Scenario: 查看记忆位置
- **WHEN** 用户发送 `/memory`
- **THEN** 系统报告项目及用户级 `CLAUDE.md` 的存在状态和位置，但不自动展示文件内容

#### Scenario: 查看可用 Skills
- **WHEN** 用户发送 `/skills`
- **THEN** 系统报告当前项目可发现的 Skills，并包含名称、来源和说明

### Requirement: 阻止有副作用的命令
系统 MUST 阻止来自聊天输入的 MCP、插件和认证修改命令，并说明该操作需要在终端或专用配置流程中显式执行。

#### Scenario: 尝试安装插件
- **WHEN** 用户发送 `/plugin install <来源>`
- **THEN** 系统不启动该命令，并在当前转录中说明该操作会改变本地配置且需要终端确认

#### Scenario: 未知斜杠命令
- **WHEN** 用户发送未被桌面命令解析器识别的单行 `/name` 输入
- **THEN** 系统保留原始输入并交由 Claude CLI 解析，以支持原生 Skills 和未来兼容命令
