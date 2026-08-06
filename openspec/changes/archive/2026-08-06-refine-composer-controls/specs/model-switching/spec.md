## MODIFIED Requirements

### Requirement: 模型选择入口

系统 SHALL 在界面提供模型选择控件，展示可用的模型档位（如 Opus / Sonnet / Haiku 等）及其稳定 Claude CLI 别名，并高亮当前会话正在使用的模型。系统 SHALL 在 Claude Code 正在生成回复时锁定模型选择控件，避免当前回合参数发生变化。

#### Scenario: 展示可选模型

- **WHEN** 用户打开模型选择控件
- **THEN** 系统列出每个模型的可读产品名称与稳定 CLI 别名，并以选中态标示当前会话所使用的模型

#### Scenario: 生成期间模型保持不变

- **WHEN** Claude Code 正在生成当前会话的回复
- **THEN** 模型选择控件不可修改，当前会话模型保持不变
