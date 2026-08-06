# claude-user-model-settings Specification

## Purpose

让桌面客户端安全管理 Claude Code 用户级配置中的模型字段，使用户能查看并调整别名实际映射的模型，而不会暴露或覆盖无关配置。

## Requirements

### Requirement: 读取用户级模型配置

系统 SHALL 在通用配置工作区读取当前用户 `.claude/settings.json` 中顶层 `model` 以及 `env` 下的 Sonnet、Opus、Haiku、Fable 模型映射，并显示配置文件路径。系统 SHALL 仅向界面返回这五个模型字段和路径，SHALL NOT 返回其他 `env`、认证、权限、hooks 或未知配置字段。

#### Scenario: 显示已有模型配置

- **WHEN** 用户打开通用配置工作区且 Claude 配置文件包含模型字段
- **THEN** 系统显示默认模型和四个别名映射的当前值，以及实际读取的配置文件路径

#### Scenario: 配置文件不存在

- **WHEN** 用户打开通用配置工作区且用户级 Claude 配置文件不存在
- **THEN** 系统显示目标配置文件路径和空的可编辑模型字段，而不将缺失视为错误

#### Scenario: 配置文件无法解析

- **WHEN** 用户打开通用配置工作区且配置文件不是有效 JSON 或配置根节点不是对象
- **THEN** 系统显示可理解的读取错误，且不展示或修改其他配置内容

### Requirement: 更新限定的模型字段

系统 SHALL 允许用户保存默认模型及 Sonnet、Opus、Haiku、Fable 的映射。系统 SHALL 将默认模型写入顶层 `model`，将四个映射写入对应的 `env.ANTHROPIC_DEFAULT_*_MODEL` 和 `env.ANTHROPIC_DEFAULT_*_MODEL_NAME` 键；保存空字段时 SHALL 移除该字段对应的键。

#### Scenario: 保存模型映射

- **WHEN** 用户编辑一个或多个模型字段并保存
- **THEN** 系统仅更新这些模型字段，保存后返回并显示已规范化的模型配置值

#### Scenario: 清除模型映射

- **WHEN** 用户清空某个模型字段并保存
- **THEN** 系统从配置中移除该字段对应的模型键，且设置页将该字段显示为空

### Requirement: 保留无关配置并安全失败

系统 SHALL 在更新模型字段时保留用户配置中所有无关 JSON 内容。系统 SHALL 使用原子替换保存配置；字段值超过 200 个字符或包含换行时 SHALL 拒绝保存。若配置中的 `env` 不是对象、写入或替换失败，系统 SHALL 向用户报告错误且不破坏原配置文件。

#### Scenario: 保留认证和未知配置

- **WHEN** 用户保存模型配置且原文件包含认证字段、权限配置、hooks 或未知字段
- **THEN** 保存后的文件保留这些无关字段及其值不变

#### Scenario: 拒绝无效模型值

- **WHEN** 用户提交包含换行或超过长度限制的模型字段
- **THEN** 系统拒绝保存并保留原配置文件内容

#### Scenario: 写入失败时保留原文件

- **WHEN** 配置文件写入或原子替换失败
- **THEN** 系统显示保存失败，且原配置文件仍可读取且未被部分覆盖
