# application-about-information Specification

## Purpose

在设置中心提供可读且非敏感的运行时应用信息，帮助用户识别 Claude Code Desktop 与本地 Claude Code CLI 的版本和可用状态。

## Requirements

### Requirement: 显示应用与运行环境信息

系统 SHALL 在设置中的关于页面显示 Claude Code Desktop 的产品名称和版本、Electron 版本以及当前运行平台与架构。

#### Scenario: 打开关于页面

- **WHEN** 用户从设置导航打开关于页面
- **THEN** 页面显示应用名称、应用版本、Electron 版本和平台信息

### Requirement: 显示 Claude Code CLI 状态

系统 SHALL 在关于页面显示 Claude Code CLI 的可用状态；当版本检测成功时 SHALL 显示检测到的 CLI 版本，当 CLI 不可用时 SHALL 显示不可用状态而不阻止关于页面显示其他信息。

#### Scenario: CLI 可用

- **WHEN** Claude Code CLI 已被客户端检测到
- **THEN** 关于页面显示 CLI 可用及其版本（如版本可得）

#### Scenario: CLI 不可用

- **WHEN** Claude Code CLI 未安装、不可执行或版本检测失败
- **THEN** 关于页面显示 CLI 不可用，且应用与运行环境信息仍可见
