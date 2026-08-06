## 背景与问题

`ClaudeRunner` 向上层推送一串内部事件:`text_delta` / `tool_use` / `status` / `done` / `aborted` / `error`。这串事件需要被转换成有序的消息列表(`Message[]`)。当前这个转换在两处各实现了一遍:

- 主进程 `electron/main.ts` 的 `claude:send` 处理器:累积 `assistantText`,在 `done` 时 `appendMessage` 落盘。
- 渲染层 `src/store/appStore.ts` 的事件回调:累积 `streamingText`,在 `done` 时 push 进内存 `messages`。

两处逻辑重复,导致两个缺陷同时存在于两侧:

- **A 顺序错乱 / 文本合并**:文本缓冲整回合只增不减,只在 `done` 落成一个气泡;`tool_use` 却即时插入。工具卡片被前置,工具前后文字被合并。
- **B 出错丢内容**:`error` 分支清空文本缓冲,已流式内容丢失(`aborted` 分支却保留,不一致)。

## 目标

- 消息组装规则收敛到**一处**,主进程与渲染层共用,杜绝内存/磁盘分叉。
- 保证同一回合内消息按事件到达顺序呈现:文字段与工具卡交替正确。
- 回合终止(done/aborted/error)时保留已接收的部分文本。
- 不改变 `Message` 数据结构,历史会话兼容。

## 核心决策:回合组装器(TurnAssembler)

抽出一个纯逻辑单元,只负责「事件 → 提交动作」,不触碰任何 I/O、不依赖 Electron 或 React。这样它可被独立单测,且主进程与渲染层各自接入时只保留自己的独有职责。

为什么不是「纯 reducer 每次吐完整消息列表」:主进程需要**增量落盘**(每条消息 `appendMessage`,不想每次重写整个文件),渲染层需要一个游离于已提交消息之外的**实时打字文本**。因此组装器输出的是「提交动作流 + 实时文本」,而非整份列表。

```
┌───────────────────────────────────────────────────────────┐
│  TurnAssembler (纯逻辑,新文件)                             │
│  ─────────────────────────────────────────────────────     │
│  feed(event): Commit[]      // 本次事件产生的待提交消息     │
│  get liveText(): string     // 尚未提交的文本(UI 实时打字) │
│  get statusText(): string   // 过渡状态(如重试提示)        │
│                                                             │
│  Commit = { message: Message } | { session: {...} }         │
└───────────────────────────────────────────────────────────┘
         │                                    │
   主进程:每个 Commit.message            渲染层:每个 Commit.message
          → appendMessage 落盘                  → push 到 messages[sid]
          liveText 忽略                         liveText → streamingText
          session commit → updateSession        statusText → statusText
```

## 分段冲刷状态机

组装器内部维护一个文本缓冲 `buf`。规则(A、B 的修复都集中在这一处):

```
     事件              动作
  ──────────────────────────────────────────────────────────
   text_delta(d)   buf += d;  更新 liveText;  清空 statusText
   status(m)       statusText = m
   tool_use(t)     flush();  commit(tool 消息)
   done(sid)       flush();  commit(session: {claudeSessionId: sid})
   aborted         flushAs('interrupted', aborted:true)
   error(msg)      flush();  commit(error 消息)
  ──────────────────────────────────────────────────────────

   flush():   若 buf 非空 → commit({role:'assistant', text:buf}); buf=''
   flushAs(role): 总是 commit 一条该 role 消息(text=buf,可空); buf=''
```

- **A 修复**:`tool_use` 与 `done` 到来时先 `flush()`,当前文本立即定格为独立气泡,后续文本进入新缓冲 → 顺序与分段都正确。
- **B 修复**:`error` 到来时先 `flush()` 保留已接收文本,再追加错误条目 → 与 `aborted` 行为一致,符合规格。
- **多段=多气泡**:一回合内被工具切开的每段文字都是一条独立 `assistant` 消息,无需给 `Message` 新增字段。

## 渲染顺序对照

```
   CLI 事件流:  text"我来看下" → tool_use Read → text"内容是X" → done

     修前(错乱)              修后(分段冲刷)
   ┌──────────────┐         ┌──────────────┐
   │ 🔧 Read      │         │ 💬 我来看下   │  ← flush 定格
   │ 💬 我来看下   │   ──▶   │ 🔧 Read      │  ← 工具卡
   │   内容是X     │         │ 💬 内容是X    │  ← 新气泡
   └──────────────┘         └──────────────┘
```

## 两处接入职责划分

抽出组装规则后,两侧仅保留各自独有职责:

```
                        主进程(磁盘侧)          渲染层(内存侧)
  ──────────────────────────────────────────────────────────────
  组装规则                共用 TurnAssembler(同一份代码)
  ──────────────────────────────────────────────────────────────
  转发事件给渲染层        ✓ sender.send          —
  Commit(message)         appendMessage 落盘      push 到 messages[sid]
  Commit(session)         updateSession(sid)      更新 session.sid
  liveText                忽略                     → streamingText(打字)
  statusText              忽略                     → statusText(重试提示)
  自动标题                ✓ 首条消息生成标题       —
  isGenerating 开关       —                        ✓ done/error/aborted 复位
  ──────────────────────────────────────────────────────────────
```

## 实时打字与最终气泡的衔接

渲染层当前用 `streamingText` 显示未完成的实时气泡。接入组装器后:

- `liveText` 有值 → 渲染临时打字气泡(带光标)。
- 一旦 `flush()` 提交,该段成为 `messages[sid]` 里的正式 `assistant` 气泡,同时 `liveText` 归空 → 临时气泡消失、正式气泡出现,视觉上无缝。
- 需保证 flush 提交与 liveText 归零在同一次状态更新内完成,避免出现「正式气泡已现、临时气泡未消」的一帧重影。

## 备选方案与取舍

- **两边各改一遍(最小改动)**:在 main 与 appStore 各自实现分段冲刷。改动小,但重复仍在——正是这次 A/B 能同时存在于两处的原因,未来第三个 bug 还得改两处。已否决。
- **纯 reducer 吐完整列表**:对渲染层友好,但与主进程增量落盘、渲染层实时文本两个约束冲突。已否决,改用「提交动作流 + liveText」形态。

## 风险与验证

- **段边界遗漏**:多工具连续、init 后立即 error、空文本回合等边界需覆盖。通过组装器单测枚举验证。
- **主进程/渲染层分叉回归**:两侧消费同一组装器后,针对同一事件序列断言两侧产出的消息序列一致。
- **实时气泡重影**:在渲染层验证 flush 与 liveText 归零的原子性。

