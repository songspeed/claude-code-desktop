## 1. 工程脚手架与依赖

- [x] 1.1 初始化 Electron + React + TypeScript + Vite 工程，配置主进程、预加载与渲染进程的构建入口
- [x] 1.2 添加运行与开发依赖（electron、react、typescript、vite、electron-builder 等），锁定版本
- [x] 1.3 配置开发脚本（启动、热更新）与生产构建脚本
- [x] 1.4 建立目录结构：electron/（main、preload、cli、store）与 src/（components、store、ipc）
- [x] 1.5 开启 Electron 安全设置：contextIsolation 开启、nodeIntegration 关闭，preload 通过 contextBridge 暴露最小化 API

## 2. CLI 通信层（主进程）

- [x] 2.1 用 `claude --help` 核对无头/流式/模型/会话相关标志的确切名称，记录到 docs/ 并据此定义适配层接口
- [x] 2.2 前置探路：在 Windows / macOS / Linux 三端确认 `claude` 的可执行形态（`claude` vs `claude.cmd`）、是否需 WSL/Git Bash、认证凭证目录，记录到 docs/ 作为 spawn 策略依据
- [x] 2.3 前置探路：确认无头模式下 `claude` 如何暴露工具权限请求（stream-json 事件 / 权限模式配置 / 需 SDK 或 ACP），据此判定 AgentTransport 走裸 CLI（方案 A）是否足够，记录到 docs/
- [x] 2.4 定义 AgentTransport 内部接口（send / onEvent / abort），上层只依赖接口，隔离具体实现
- [x] 2.5 实现可执行定位：按 PATH（Windows 含 PATHEXT）解析 `claude`，不硬编码可执行名；主进程补齐/继承登录 shell 的 PATH，解决 mac GUI 启动 PATH 缺失
- [x] 2.6 实现 claudeRunner（AgentTransport 的裸 CLI 实现）：spawn 本地 `claude` 子进程，管理进程句柄与生命周期，支持传入 prompt、model、session-id
- [x] 2.7 实现 streamParser：按行解析 stream-json 输出（兼容 `\n` 与 `\r\n`），转译为内部事件（增量文本 / 工具调用 / 完成 / 错误），未知事件安全忽略
- [x] 2.8 实现权限控制：通过 `--permission-mode` 标志控制（acceptEdits 安全默认 / bypassPermissions 危险放行），渲染层 DangerSwitch 映射
- [x] 2.9 通过 IPC 将解析后的事件增量推送到渲染层，定义类型化的事件与请求协议
- [x] 2.10 实现中断：保存进程句柄，收到停止请求时终止子进程；Windows 用 `taskkill /T /F` 杀整棵进程树，mac/Linux 用 SIGTERM/SIGKILL，并发出「已中断」事件
- [x] 2.11 实现 CLI 可用性探测（不存在/不可执行/未认证），返回可理解的错误信息

## 3. 本地持久化层（主进程）

- [x] 3.1 定义数据类型：会话元信息、claudeSessionId、所选模型、消息记录
- [x] 3.2 在 userData 目录下实现 sessionStore：会话与消息的读写，采用「临时文件 + 原子替换」写入
- [x] 3.3 维护会话索引文件，支持列表快速加载与按最近活动时间排序
- [x] 3.4 处理写入失败：捕获异常并向上层返回，保证不破坏已有数据
- [x] 3.5 通过 IPC 暴露会话增删改查接口给渲染层

## 4. 聊天界面闭环（渲染层）

- [x] 4.1 实现 Composer 输入框与发送逻辑，阻止空消息发送
- [x] 4.2 实现 ChatView 消息区，随事件流增量渲染回复（流式）
- [x] 4.3 实现 MessageBubble：Markdown 富文本渲染、代码块语法高亮与一键复制
- [x] 4.4 实现工具调用等中间过程条目的可区分展示
- [x] 4.5 实现停止按钮，触发中断并将消息标记为已中断，界面恢复可发送状态
- [x] 4.6 实现错误提示 UI（CLI 不可用、进程异常退出等），保证不崩溃、不丢会话
- [x] 4.7 权限控制通过 `--permission-mode` flag 实现（DangerSwitch），无需逐次 UI 确认
- [x] 4.8 实现「危险放行开关」：默认关闭（acceptEdits）；开启需显式确认并展示风险提示，可随时关闭

## 5. 模型切换（渲染层 + 会话状态）

- [x] 5.1 实现 ModelPicker 控件，展示可用模型档位并高亮当前会话所选模型
- [x] 5.2 将所选模型写入当前会话状态并持久化，切换在下一条消息发送时以 `--model` 生效
- [x] 5.3 保证切换不影响已生成的历史消息；新建会话使用默认模型
- [x] 5.4 打开/切换会话时恢复该会话上次保存的模型选择

## 6. 多会话管理（渲染层）

- [x] 6.1 实现 SessionList：展示已保存会话，按最近活动排序并高亮激活会话
- [x] 6.2 实现新建会话：创建空会话、加入列表、切为激活、聚焦输入框
- [x] 6.3 实现切换会话：加载并展示该会话历史消息与模型，后续消息以 `--resume` 延续上下文
- [x] 6.4 实现重命名会话（含首次对话后的默认标题生成），即时反映并持久化
- [x] 6.5 实现删除会话（先确认后删除），处理删除激活会话后的切换或空状态
- [x] 6.6 应用启动时从本地存储恢复全部会话、消息与模型选择

## 7. 打包分发（三端本地产包）

- [x] 7.1 配置 electron-builder，产出三端安装包：Windows（NSIS `.exe`）、macOS（`.dmg`/`.app`）、Linux（`.AppImage`/`.deb`）
- [ ] 7.2 在各自平台本地执行打包，产出三端安装包（跨平台交叉打包为可选，不作硬性要求）
- [ ] 7.3 验证三端打包产物均可本地安装并启动，进入可用主界面

## 8. 跨平台适配与三端验收

- [x] 8.1 校验存储路径统一走 `app.getPath('userData')`，session-management 持久化在三端一致、重启可恢复
- [ ] 8.2 Windows 验收：三项能力（聊天/模型切换/多会话）逐条 scenario 跑通，重点验证「中断生成」杀进程树干净、`claude.cmd`/PATH 解析正确
- [ ] 8.3 macOS 验收：三项能力逐条 scenario 跑通，重点验证 Dock/图标启动时 PATH 补齐、能定位 `claude`
- [ ] 8.4 Linux 验收：三项能力逐条 scenario 跑通，安装包可运行
- [ ] 8.5 汇总三端 × 三能力的验收矩阵结果，记录到 docs/，未通过项回归修复

## 9. 文档与收尾

- [x] 9.1 编写并持续维护 docs/design.md（中文设计说明：架构、选型理由、文件结构、主动放弃项及原因）
- [x] 9.2 编写并持续维护 docs/ai-usage.md（中文 AI 使用说明：模型 / Agent / Skill / 组件 / 工具的用法，AI 产物出过的问题与检查修正记录）
- [x] 9.3 将开发约定沉淀进项目 CLAUDE.md 或 skill，变更时同步更新对应文档
