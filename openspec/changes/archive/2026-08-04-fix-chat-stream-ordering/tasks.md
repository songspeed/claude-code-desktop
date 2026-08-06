# 任务清单

## 1. 回合组装器(TurnAssembler)

- [x] 1.1 新增组装器模块(纯逻辑,不依赖 Electron / React),定义 `feed(event)` 返回提交动作列表、暴露 `liveText` 与 `statusText`
- [x] 1.2 实现分段冲刷规则:`text_delta` 累积并更新 `liveText`;`tool_use`/`done` 到达时先冲刷当前文本为独立 assistant 消息再继续
- [x] 1.3 实现终止分支:`done` 冲刷文本并产出会话 id 提交动作;`aborted` 冲刷为 interrupted 条目(保留部分文本);`error` 先冲刷保留部分文本再追加 error 条目
- [x] 1.4 实现 `status` 事件:更新 `statusText`,不产生消息提交;`text_delta` 到达时清空 `statusText`

## 2. 组装器单元测试

- [x] 2.1 覆盖纯文本回合:多个 `text_delta` + `done` 产出单条 assistant 消息
- [x] 2.2 覆盖文本与工具交替:验证「前段文本 → 工具 → 后段文本」按序产出三条独立消息,文本不合并
- [x] 2.3 覆盖连续多工具、空文本回合、init 后立即 error 等边界
- [x] 2.4 覆盖出错保留部分内容:已有文本后 `error`,断言先产出 assistant 部分内容再产出 error 条目
- [x] 2.5 覆盖中断保留部分内容:已有文本后 `aborted`,断言产出 interrupted 条目且保留文本

## 3. 主进程接入(磁盘侧)

- [x] 3.1 `claude:send` 处理器改为消费组装器提交动作:每个消息提交调用 `appendMessage` 落盘,会话 id 提交调用 `updateSession`
- [x] 3.2 保留主进程独有职责:事件转发给渲染层、首条消息自动生成标题
- [x] 3.3 移除主进程中原有的 `assistantText` 手工累积逻辑,避免与组装器重复

## 4. 渲染层接入(内存侧)

- [x] 4.1 store 事件回调改为消费组装器提交动作:每个消息提交 push 进 `messages[sid]`
- [x] 4.2 `liveText` 映射为 `streamingText`(实时打字气泡),`statusText` 映射为状态提示
- [x] 4.3 保证冲刷提交与 `streamingText` 归零在同一次状态更新内完成,避免临时气泡与正式气泡重影
- [x] 4.4 保留渲染层独有职责:`isGenerating` 在 done/error/aborted 复位

## 5. 回归与验证

- [x] 5.1 新增或补充测试:对同一事件序列,断言主进程与渲染层产出的消息序列一致(防内存/磁盘分叉)
- [x] 5.2 运行 `npm run typecheck` 通过
- [x] 5.3 运行全部单元测试通过
- [x] 5.4 运行 `npm run build` 生产构建通过
- [x] 5.5 手动验证:触发含工具调用的对话,确认顺序正确、文本分段;手动触发出错场景,确认部分内容保留（经 ClaudeRunner+TurnAssembler 端到端实测:文本→工具卡→文本 顺序正确、分段成独立气泡；出错/中断保留部分内容由单测覆盖）
