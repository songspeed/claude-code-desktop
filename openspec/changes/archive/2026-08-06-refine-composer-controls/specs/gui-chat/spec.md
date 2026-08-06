## MODIFIED Requirements

### Requirement: 工具权限确认

系统 SHALL 在组合器中提供会话级授权模式，以控制无头 Claude Code CLI 对工具操作的处理方式。系统 SHALL 使用已选择的模式启动当前会话后续请求，而 SHALL NOT 在当前传输层无法可靠回传决定时承诺逐工具确认；生成期间界面仍 SHALL 保持响应并允许用户停止本次生成。

#### Scenario: 使用会话授权模式处理工具

- **WHEN** 用户以某一授权模式发送消息且 Claude Code 需要执行工具操作
- **THEN** 系统以该会话授权模式调用 Claude Code CLI，并在消息流中持续展示生成状态和工具事件

#### Scenario: 生成期间可停止

- **WHEN** Claude Code 正在按会话授权模式执行或生成回复
- **THEN** 用户可以停止本次生成，界面恢复到可再次发送的状态

### Requirement: 危险放行开关显式化

若系统提供全部放行这类降低安全约束的选项，该选项 SHALL 以会话级授权模式显式呈现，并在切换到该模式前向用户说明风险且要求确认。新会话 SHALL 默认采用自动接受编辑模式；用户未确认时系统 SHALL NOT 启用全部放行。

#### Scenario: 新会话采用默认授权模式

- **WHEN** 用户新建一个会话且未选择任何授权模式
- **THEN** 系统为该会话采用自动接受编辑模式，而非全部放行

#### Scenario: 启用全部放行需确认

- **WHEN** 用户尝试将当前会话切换到全部放行
- **THEN** 系统展示风险说明并仅在用户确认后启用该模式

## ADDED Requirements

### Requirement: 输入状态与提示

系统 SHALL 根据当前会话项目目录、Claude Code CLI 可用性和生成状态更新输入框的可用性及提示文案。系统 SHALL 在缺少项目目录或 CLI 不可用时阻止发送；生成期间 SHALL 显示可停止的生成提示。

#### Scenario: 项目与 CLI 均可用时提示任务输入

- **WHEN** 当前会话已关联项目目录、Claude Code CLI 可用且未生成回复
- **THEN** 输入框可编辑，并提示用户描述任务或引用项目文件

#### Scenario: 缺少前置条件时阻止输入

- **WHEN** 当前会话未关联项目目录或 Claude Code CLI 不可用
- **THEN** 输入框不可编辑，并显示对应的项目目录或 CLI 可用性提示

#### Scenario: 生成期间提示状态

- **WHEN** Claude Code 正在生成回复
- **THEN** 输入框不可编辑，并显示正在生成且可停止的提示
