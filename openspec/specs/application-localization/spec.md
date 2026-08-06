# application-localization Specification

## Purpose

让 Claude Code Desktop 的用户能够选择并持续使用简体中文或 English 操作界面，同时避免对本地会话和 Claude 内容造成任何改写。

## Requirements

### Requirement: 选择并保存客户端语言

系统 SHALL 在设置中提供简体中文和 English 两种客户端语言选项。用户选择后，系统 SHALL 立即应用该语言并在本地保存；后续启动 SHALL 恢复上次选择的语言。

#### Scenario: 切换为 English

- **WHEN** 用户在语言设置页面选择 English
- **THEN** 设置导航、侧栏、对话工作区和组合器的客户端文案立即显示为 English，且语言选择显示为已选中

#### Scenario: 重启后恢复语言

- **WHEN** 用户已选择 English 并重新启动客户端
- **THEN** 客户端恢复 English，而不修改任何会话、项目目录、模型或授权模式

### Requirement: 本地化客户端控制文案

系统 SHALL 按当前语言展示主要客户端控制、设置页面、状态提示和确认对话框文案。系统 SHALL NOT 翻译用户输入、会话标题、项目路径、Claude 回复、工具输出或本地配置值。

#### Scenario: 显示中文界面

- **WHEN** 当前语言为简体中文
- **THEN** 客户端控制和设置文案使用简体中文，用户内容保持原样
