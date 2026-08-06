## Context

原生 Claude Code 是一个本地 CLI 二进制，具备调用 Anthropic API、维护上下文、读写文件、执行代码的能力，并自行管理认证（登录态/API Key）与会话记录（默认存于 `~/.claude`）。本变更要在其之上叠加一个桌面 GUI，不修改 CLI 本体，通过子进程 + 进程间通信收发消息，并在本地持久化用于 GUI 展示与切换的会话数据。动机见 proposal.md - Why；能力要求见 specs/。

关键约束：
- 低侵入：只调用官方 CLI，不打补丁、不 fork，便于跟随官方升级。
- 认证复用：沿用 CLI 自身的登录/密钥机制，GUI 不额外存储或管理密钥。
- 本地优先：会话数据只写本地磁盘，不经过第三方服务。
- 需可本地运行并能打包成桌面安装包。

前置事实（基于 Claude Code CLI 的现有能力，实现前需以 `claude --help` 复核具体标志）：CLI 提供无头/打印模式 `-p/--print`、结构化流式输出 `--output-format stream-json`（配合 `--verbose`）、模型选择 `--model`、以及以会话 ID 维系上下文的 `--session-id <uuid>` 与 `--resume <session-id>`。这组能力正是 GUI 封装的接入点。

## Goals / Non-Goals

**Goals:**
- 用一套跨平台桌面技术栈实现聊天、模型切换、多会话三项能力的功能闭环。
- 三端平级验收：Windows / macOS / Linux 均为验收门槛，三项能力的每条规格 scenario 需在三端各自手动跑通；安装包由 electron-builder 本地分别产出三端产物（CI 三端矩阵为后续可选项，非本版门槛）。
- 进程边界清晰：GUI 渲染层与 CLI 子进程调用层解耦，消息通过受控 IPC 通道传递。
- 会话上下文的延续尽量交给 CLI 自身（以 session-id 维系），GUI 侧只负责展示层数据与映射。
- 产出可打包分发的安装包，并全程维护中文设计说明与 AI 使用说明两份文档。

**Non-Goals（设计层面的边界）:**
- 不实现自建的多模型 API 直连或密钥管理——一律经由 CLI。
- 不实现团队协作、云端同步、账号体系。
- 不复刻终端里全部的斜杠命令与交互式 UI，仅覆盖闭环所需交互。
- 不做插件系统、主题商店等扩展性设施（见放弃项）。

## Decisions

### 决策 1：桌面框架选用 Electron + React + TypeScript + Vite（而非 Tauri 2.0）

结论：选择 Electron + React + TypeScript + Vite。这不是因为 Electron 在通用意义上更强，而是因为本应用的核心任务形态与 Electron 的优势面高度对齐。以下给出完整论证，回应「Tauri 2.0 体积更小、内存更低、权限更安全、Rust 子进程更稳」这一质疑。

#### 1.1 先看应用的真实重量分布

判断框架优劣前，必须先看清这个 app 在干什么活：

```
        本应用的重量分布
   ════════════════════════════════

   前端 UI (轻)              后端 I/O (重·核心)
   ┌──────────────┐         ┌────────────────────────┐
   │ 聊天气泡      │         │ spawn claude 子进程     │
   │ Markdown 渲染 │  ◀────  │ 逐行解析 stream-json    │
   │ 会话列表      │  事件流  │ kill / 中断 / 生命周期  │
   │ 模型下拉      │         │ 会话 JSON 持久化        │
   └──────────────┘         └────────────────────────┘
      React 就够              ★ 全部难点都在这里 ★
```

核心判断：本应用的难点不在 UI，而在「子进程编排 + 流式 stdout 解析」。谁在这一层更顺手、离官方生态更近，谁就更适合。Electron 的主进程天生是 Node 运行时，与该任务完美对齐。

#### 1.2 承认 Tauri 2.0 的硬优势（不狡辩）

| 维度 | Tauri 2.0 | Electron | 结论 |
|------|-----------|----------|------|
| 安装包体积 | 3–10 MB（系统 WebView） | 80–150 MB（自带 Chromium） | Tauri 大胜 |
| 空载内存 | ~40–100 MB | ~120–300 MB | Tauri 胜 |
| 权限模型 | capability/permission，默认最小授权 | 靠自觉配置 contextIsolation | Tauri 更安全 |
| secure by default | 是 | 需手动收紧 | Tauri |

这些优势真实存在。若产品硬约束是「极小体积」或「极致内存」，Tauri 值得认真考虑。

#### 1.3 纠正一条：Rust 子进程「远优于」Node 不成立（对本场景）

「Rust 桥接调用子进程稳定性远优于 Node.js child_process」这一条，对本场景不成立。`child_process` 是 Node 最成熟、最本命的能力——Node 从设计之初就是为异步 I/O 编排而生：spawn 进程、把 stdout 当流逐行读、处理 exit code、发 kill 信号，都是教科书级 idiom，极其稳定。

反而 Tauri 调外部 CLI 存在一个未被提及的摩擦点：

```
   Tauri 调外部 CLI 的两条路，都不轻松：

   路线 A: tauri-plugin-shell (Command API)
   ┌────────────────────────────────────────┐
   │ 必须在 capabilities 里声明允许的命令     │
   │ 动态参数(--model / --session-id 变化)  │
   │ 要配 scope + 参数校验(正则),否则被拦 │
   │ → 安全,但和"参数天天变"的 CLI 调用犯冲 │
   └────────────────────────────────────────┘

   路线 B: 直接写 Rust (tokio::process)
   ┌────────────────────────────────────────┐
   │ 绕过 scope 限制,自由 spawn              │
   │ 但你在写 Rust: BufReader.lines() +      │
   │ serde_json + tauri::Emitter 手搓事件桥  │
   │ → 强大,但这是另一门语言的心智负担       │
   └────────────────────────────────────────┘
```

即 Tauri 的「更安全权限模型」，对「参数高度动态」的 CLI 封装场景反而会变成要么绕过、要么反复配 scope 的负担；其安全红利在本 app 上打了折扣。真正的安全敏感面是「别把用户 prompt 做 shell 插值」，而这一点两边都用无 shell 的 spawn（传参数数组）即可解决，是平局。

#### 1.4 决定性因素：语言对齐 + 生态距离

```
   Electron                        Tauri
   ═══════════                     ═══════════
   前端 TS ─┐                      前端 TS ─┐
            ├─ 同一门语言           │        ├─ 割裂
   后端 TS ─┘  同一套心智           后端 Rust┘  两套心智/构建/调试

   核心 I/O 逻辑:                  核心 I/O 逻辑:
   child_process.spawn             tokio::process::Command
   readline 流                     BufReader().lines()
   JSON.parse                      serde_json
   → 前端团队会的                   → 需要 Rust 能力
```

更关键：Claude Code 本身有官方 Node/TypeScript SDK（Agent SDK）与 Python SDK，但没有 Rust SDK。这对后期扩展是决定性的：

```
   今天:  GUI ──spawn──▶ claude CLI ──▶ Anthropic API

   明天可能的演进(去 CLI 依赖 / 更细粒度控制 / 直接拿工具事件):
   ├─ Electron 路径: npm i @anthropic-ai/claude-agent-sdk
   │                 后端直接 import,一条直线 ✓
   └─ Tauri 路径:    无官方 Rust SDK
                     要么继续 shell 调 CLI(退回原点)
                     要么在 Rust 里重造 SDK ✗
```

封装的是一个「有 Node SDK 的工具」。用 Node 系的 Electron 始终站在官方生态主路上；用 Tauri 则把集成方式钉死在「只能 shell 调 CLI」。

#### 1.5 后期维护成本对比

| 维护维度 | Electron | Tauri 2.0 |
|----------|----------|-----------|
| 跟随 CLI 官方升级 | 改 TS 适配层，前端同学能改 | 改 Rust 适配层，需 Rust 能力 |
| 调试 stream-json 变化 | 同一运行时，快速迭代 | 跨语言，Rust 端重编译较慢 |
| 招人 / 交接 | JS/TS 人才池大，门槛低 | 需 Rust，人才更稀缺 |
| 依赖更新 | npm 一套 | npm + Cargo 两套 |
| 打包踩坑 | electron-builder 成熟 | 各平台 WebView 差异需回归 |
| 崩溃排查面 | Chromium 统一 | 三平台 WebView 引擎不同（WebKitGTK/WKWebView/WebView2），渲染差异需单独测 |

关键权衡：Tauri 用「分发体积小」换来「WebView 碎片化 + Rust 维护税」。本 app 以 Markdown/代码高亮为主，三套 WebView 引擎的渲染一致性需真金白银回归；Electron 全平台一个 Chromium，这块成本几乎为零。

#### 1.6 功能扩展对比

| 未来功能 | Electron | Tauri |
|----------|----------|-------|
| 接 Claude Agent SDK（去 CLI 化） | ✓ 官方 npm 包 | ✗ 无 Rust SDK |
| 富前端能力（虚拟滚动/编辑器/图表） | ✓ npm 生态海量 | ✓ 前端相同，受 WebView 差异牵制 |
| 文件拖拽 / 附件 / 剪贴板 | ✓ 成熟 | ✓ 有 plugin，需配 permission |
| 系统托盘 / 全局快捷键 / 通知 | ✓ | ✓ |
| 极致小体积 / 侧载分发 | ✗ 天生大 | ✓ |
| 未来内嵌本地模型 / 重计算 | 一般 | ✓ Rust 有优势 |

规律：偏「前端能力 + 贴 Anthropic 生态」的扩展 Electron 顺；偏「系统级 / 性能 / 极小分发」的扩展 Tauri 顺。本 app 的扩展方向几乎全在前者。

#### 1.7 裁决与翻盘条件

裁决：对「封装 Claude Code CLI」这个具体任务，Electron 赢在语言对齐、官方 Node SDK、子进程本命、渲染一致、维护/招人门槛低；Tauri 赢在体积、内存、默认安全。而本 app 的核心难点（子进程 + 流解析）与未来主路（Node SDK）都压在 Electron 的优势面上。体积/内存是「用户装一次」的一次性成本，语言割裂与生态偏离是「每次迭代都要还」的持续成本；对一个需长期跟随官方 CLI 升级的封装型 app，后者风险更高。

会翻盘选 Tauri 的条件（任一成立即需重新评估）：
- 明确的产品硬约束：安装包必须极小（嵌入式 / 带宽敏感 / 侧载分发）。
- 团队已具备 Rust 能力，不吃语言割裂的亏。
- 确定永远只走「shell 调 CLI」、绝不接 Agent SDK，且未来往系统级 / 高性能方向扩展。

其余被放弃的备选：
- PyQt / 原生：UI 迭代与富文本/Markdown 渲染生态不如 Web 前端，放弃。

### 决策 2：进程架构——三层清晰边界

- 渲染进程（Renderer/React）：只负责 UI 与状态展示，不直接 spawn 进程、不直接读写磁盘。
- 预加载脚本（preload）：通过 `contextBridge` 暴露一组最小化、类型化的 API（发送消息、订阅流式事件、会话增删改查），开启 `contextIsolation`、关闭 `nodeIntegration`，避免渲染层拿到 Node 全能力，符合安全约束。
- 主进程（Main/Node）：承载「CLI 通信层」与「持久化层」。CLI 通信层负责 spawn/kill 子进程、解析流式输出、把事件通过 IPC 推给渲染层；持久化层负责会话与消息的本地读写。
- 理由：满足 specs 中「渲染层不越权」与安全约束，同时让子进程与磁盘操作集中在可控的主进程。

### 决策 3：CLI 调用方式——无头流式 + 会话 ID 维系上下文

- 发送消息时以 `claude -p <prompt> --output-format stream-json --verbose --model <model>` 方式 spawn；新会话首次调用生成/指定 `--session-id <uuid>`，同一会话的后续消息用 `--resume <session-id>` 延续上下文。
- 主进程逐行读取 stdout 的 JSON 事件流，转译为 GUI 内部事件（增量文本、工具调用、完成、错误），经 IPC 增量推给渲染层，实现 specs 的流式渲染与中间过程展示。
- 中断：保留子进程句柄，用户点停止时对该进程发送终止信号并标记消息为已中断。
- 理由：把「上下文维护」这件难事交还给 CLI 本体，GUI 不重复造轮子，低侵入且随官方升级。
- 备选与放弃：解析人类可读文本输出——格式不稳定、难以区分工具调用与正文，放弃；改用 stream-json 结构化事件。实现前需用 `claude --help` 核对上述标志的确切名称与可用性，若有出入则以实际 CLI 为准调整适配层（适配集中在 CLI 通信层一处）。

### 决策 3.5：交互层抽象为 AgentTransport（MVP 走裸 CLI，留升级口）

背景：调研 Codex 与 Claude Code 生态发现，「无头模式下的工具权限确认」并非可选优化，而是功能正确性问题——Agent 请求执行敏感操作时若无处确认，无头进程会静默放行（不安全）或卡在等待输入（界面假死）。业界对此已有标准解法：Zed 的 Agent Client Protocol（ACP，JSON-RPC 双向协议，Claude Code 有官方 ACP 适配器），以及官方 Claude Agent SDK（权限可在会话中以回调动态处理）。

因此把「与 Agent 通信」抽象成一个内部接口 `AgentTransport`，上层（渲染、会话、持久化）只依赖该接口，不绑定具体实现：

```
   渲染/会话/持久化层
          │ 只依赖接口
          ▼
   ┌─────────────────────────────┐
   │ AgentTransport (内部接口)    │
   │  send(prompt, model, sid)   │
   │  onEvent(增量/工具/完成/错误)│
   │  onPermissionRequest(...)    │ ← 权限确认必须由该层支持
   │  respondPermission(allow)    │
   │  abort()                     │
   └─────────────────────────────┘
      ▲            ▲            ▲
   A: 裸CLI -p   B: ACP 桥    C: Agent SDK
   (MVP 首选)   (可升级)     (最贴官方生态)
```

三条实现路线权衡：

| 维度 | A. 裸 CLI `-p`（MVP） | B. ACP 桥 | C. 官方 Agent SDK |
|------|----------------------|-----------|-------------------|
| 上手速度 | 最快，spawn 即可 | 中 | 中 |
| 权限确认 | 需自行接出并回传 | 协议内建双向 | SDK 回调内建 |
| 流式/工具事件 | 手动解析 stream-json | 结构化 | 结构化 |
| 会话延续 | `--resume` 自管 | 协议管 session | SDK 管 session |
| 长驻进程/多轮 | 需自管常驻或每轮重拉 | 长驻 | 长驻 |
| 依赖稳定度 | CLI 标志（易变） | ACP 适配器 | SDK（最稳） |
| 符合「低侵入」初衷 | 高 | 中 | 中（但最贴生态） |

- 决定：MVP 采用 A（裸 CLI）快速打通闭环，但严格经 `AgentTransport` 接口隔离；`onPermissionRequest`/`respondPermission` 是该接口的必备能力，无论哪条实现都要满足 gui-chat 的「工具权限确认」requirement。
- 升级口：若 A 无法从 stream-json 干净接出权限请求，则切换 B 或 C——因上层只依赖接口，切换不波及渲染/会话/持久化层。
- 待探（见 tasks 前置）：确认当前 `claude` 无头模式如何暴露权限请求（stream-json 事件？权限模式配置？还是必须走 SDK/ACP），这直接决定 A 能否独立满足权限确认，还是需提前上 B/C。

### 决策 3.6：安全默认 + 显式危险开关

借鉴 Codex「保守默认（最小授权、逐次确认）+ 危险放行需显式命名开关」的做法：本应用默认对敏感操作逐次请求确认，任何「跳过确认/全部放行」类选项默认关闭、需用户显式开启并带风险提示。对应 gui-chat 的「危险放行开关显式化」requirement。理由：无头 GUI 下用户看不到终端里的每一步，默认放行的事故代价高于多点几次确认的摩擦。

### 决策 4：本地持久化——按会话存 JSON 文件 + 索引

- 在用户数据目录（Electron `app.getPath('userData')`）下维护一个 `sessions/` 目录：每个会话一个 JSON 文件（含会话元信息、`claudeSessionId`、所选模型、消息数组），外加一个轻量索引文件用于列表快速加载与排序。
- 理由：数据量小、结构简单，JSON 文件足够；零额外原生依赖，打包无需处理 native module 编译，最省心。写入采用「先写临时文件再原子替换」以降低写坏风险，满足「写入失败不破坏已有数据」的 scenario。
- 备选与放弃：SQLite（better-sqlite3）——查询与并发更强，但引入原生模块增加打包复杂度，对本项目的数据规模属过度设计，记录为规模增长后的升级方向。

### 决策 5：模型切换实现

- 界面维护一个可选模型档位列表（Opus/Sonnet/Haiku 等），当前会话选中的模型存入该会话数据；每次 spawn CLI 时作为 `--model` 参数传入，实现「切换即时对下一条消息生效」，并随会话持久化恢复。
- 理由：模型只是 CLI 的一个入参，交给会话状态承载最简单、可持久化。

### 决策 6：跨平台适配——三端差异集中在 CLI 通信层与存储路径

三端平级验收，但「一份 spawn 代码三端通吃」是幻觉——差异都顺着「子进程调 CLI」这条边渗入。将差异集中在 `electron/cli/` 与存储路径解析两处，其余层保持平台无关。

```
   三端各自必须单独处理的点(不是一份代码通吃):

   Windows                 macOS                  Linux
   ┌──────────────┐        ┌──────────────┐       ┌──────────────┐
   │ claude.cmd   │        │ GUI 启动 PATH │       │ 发行版差异    │
   │ + PATHEXT    │        │ ≠ 终端 PATH   │       │ AppImage/deb  │
   │ taskkill /T  │        │ (最常见坑)   │       │ 沙箱/权限     │
   │ 杀进程树     │        │ 代码签名/公证 │       │ WebKitGTK 无关│
   │ \r\n 换行    │        │ (可选)       │       │(Electron 自带)│
   └──────────────┘        └──────────────┘       └──────────────┘
        中断最难              PATH 最常翻            打包矩阵最杂
```

- **可执行定位**：不硬编码可执行名。Windows 上 `claude` 可能是 `claude.cmd`（需按 PATHEXT 解析），mac/Linux 为 `claude`；统一做 PATH 探测。
- **GUI 进程 PATH ≠ 终端 PATH（mac 最常见坑）**：从 Dock/开始菜单启动的 Electron 拿不到用户在 shell 里配的 PATH，导致「终端能跑、点图标找不到 claude」。需在主进程补齐/继承登录 shell 的 PATH 后再 spawn。
- **中断信号（Windows 最难）**：mac/Linux 发 SIGINT/SIGTERM 即可干净停止；Windows 无 POSIX 信号且 `claude` 会再拉子进程，需 `taskkill /T /F`（或 job object）杀整棵进程树，否则「停止」按了底层仍在跑——直接关系 gui-chat「中断生成」scenario 在 Windows 的达标。
- **换行符**：stdout 按行解析需兼容 `\n` 与 `\r\n`。
- **存储路径**：一律走 `app.getPath('userData')`，不假定任何 OS 的固定目录，保证 session-management 持久化在三端一致。
- **认证态**：沿用 CLI 自身登录/密钥，需确认 GUI 子进程能读到同一份 `~/.claude`（及 Windows 对应目录）凭证。
- **Windows 原生 vs WSL（待探）**：验收前需确认目标 Windows 环境中 `claude` 是原生可执行还是需经 WSL/Git Bash，这决定 spawn 策略，列为前置探路任务。

## 文件结构（拟）

```
claude-code-desktop/
├── package.json                 # 脚本、依赖、electron-builder 配置
├── electron/
│   ├── main.ts                  # 主进程入口：窗口、IPC 注册
│   ├── preload.ts               # contextBridge 暴露的类型化 API
│   ├── cli/
│   │   ├── claudeRunner.ts      # spawn/kill claude、生命周期
│   │   └── streamParser.ts      # stream-json 事件解析与转译
│   └── store/
│       ├── sessionStore.ts      # 会话/消息的读写、原子写入
│       └── types.ts             # 会话、消息、模型等数据类型
├── src/                         # 渲染层（React）
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── ChatView.tsx         # 消息区 + 流式渲染 + 中断
│   │   ├── MessageBubble.tsx    # 富文本/代码块/复制、工具调用条目
│   │   ├── Composer.tsx         # 输入框与发送
│   │   ├── SessionList.tsx      # 会话列表：新建/切换/重命名/删除
│   │   └── ModelPicker.tsx      # 模型选择控件
│   ├── store/                   # 渲染层状态管理
│   └── ipc.ts                   # 调用 preload API 的封装
├── docs/
│   ├── design.md                # 中文设计说明（架构/选型/结构/放弃项）
│   └── ai-usage.md              # 中文 AI 使用说明（模型/Agent/Skill/工具/问题与修正）
└── openspec/                    # 本 OpenSpec 变更与规格
```

## Risks / Trade-offs

- CLI 标志/输出格式随官方版本变化 → 将所有 CLI 交互隔离在 `electron/cli/` 一层，输出解析容错（未知事件忽略、非零退出即报错）；实现前以 `claude --help` 校准。
- CLI 未安装或未认证导致不可用 → 启动时探测 `claude` 可执行性并给出引导；发送失败按 specs 的错误处理 scenario 提示，不崩溃。
- 子进程流式输出的背压/大输出 → 按行缓冲解析，增量刷新 UI，必要时节流渲染，避免主线程卡顿。
- Electron 安全面 → 开启 `contextIsolation`、禁用 `nodeIntegration`、仅经 preload 暴露最小 API，渲染层不触碰 Node/文件系统。
- 会话上下文一致性依赖 CLI 的 session-id 语义 → 由主进程统一保管 `claudeSessionId` 与 GUI 会话的映射，切换会话时严格按映射 `--resume`。
- 本地写坏数据 → 原子写入（临时文件 + rename）+ 写失败提示，保护既有数据。
- Windows 中断难以干净停止（无 POSIX 信号 + 子进程树）→ 用 `taskkill /T /F`（或 job object）杀整棵进程树，并单独验收 Windows 上「中断生成」scenario。
- mac GUI 进程 PATH 缺失导致找不到 `claude` → 主进程补齐/继承登录 shell 的 PATH 后再 spawn，探测失败时给出明确引导。
- 三端平级验收抬高成本：需三套可用环境（各装好并认证 `claude`）→ 采用手动三端验收 + 本地 electron-builder 分别产包；把「探明三端 `claude` 形态与认证」列为靠前的前置任务。
- Windows 上 `claude` 为原生还是需 WSL/Git Bash 尚待确认 → 验收前先在目标环境探明，据此定 spawn 策略，避免后期返工。

## Migration Plan

全新工程，无存量迁移。落地顺序：脚手架与依赖 → 主进程 CLI 通信层（可先用假数据打通 IPC）→ 渲染层聊天闭环 → 持久化 → 会话管理 → 模型切换 → 打包配置。回滚策略：纯新增工程，废弃即删除工程目录，不影响本地 `claude` CLI 与其 `~/.claude` 数据。

## Open Questions

- 模型档位的最终清单与「默认模型」取值，待实现时以当前 CLI 实际支持为准确定（不影响架构与任务拆分）。
- 会话标题的自动生成策略（截取首条消息 vs 由模型概括），可在实现阶段择一，属展示层细节。
- Windows 上 `claude` 为原生可执行还是需 WSL/Git Bash，已列为前置探路任务（tasks 2.2）在验收环境中确认，不在此悬置。
- 无头模式下 `claude` 暴露工具权限请求的具体机制（stream-json 事件 / 权限模式配置 / 需 SDK 或 ACP），已列为前置探路任务（tasks 2.3）；结论决定 AgentTransport 的裸 CLI 实现能否独立满足权限确认，或需提前上 ACP/SDK。因上层只依赖接口，此不确定性不影响架构与任务拆分。
