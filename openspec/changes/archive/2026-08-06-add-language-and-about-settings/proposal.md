## Why

设置中心目前只有外观、模型和 Skills，用户无法切换客户端语言，也无法确认正在运行的客户端和 Claude Code CLI 版本。桌面客户端需要在本地保存语言偏好，并集中展示可诊断的应用信息。

## What Changes

- 在设置导航中新增“语言”和“关于”页面。
- 支持在简体中文与 English 之间切换并持久化语言偏好；切换后立即更新客户端控制界面的可见文案。
- 在关于页面展示 Claude Code Desktop、Electron、运行平台与 Claude Code CLI 的版本或可用状态。
- 新增最小 IPC 边界以读取、保存和广播语言偏好，以及读取非敏感运行时应用信息。

## Capabilities

### New Capabilities
- `application-localization`: 管理本地持久化的客户端语言偏好并在界面中应用中文或英文文案。
- `application-about-information`: 在设置中提供应用版本、运行环境和 Claude Code CLI 状态。

### Modified Capabilities

无。

## Impact

- 影响 Electron 主进程、preload/IPC、渲染层状态、设置导航和主要工作区文案。
- 新增本地语言偏好文件，不读取、不暴露 Claude 用户配置中的敏感信息。
- 不改变会话、模型、授权模式或 Claude CLI 调用语义。
