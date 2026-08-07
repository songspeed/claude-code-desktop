# Tasks: 输出体验增强（第三轮）

## 1. 基础准备

- [x] 1.1 安装 `remark-gfm` 运行时依赖并确认 `package.json` 更新
- [x] 1.2 在 `src/components/markdown/` 下新建模块目录，规划插件与解析工具的存放位置

## 2. GFM 扩展语法渲染（markdown-rendering）

- [x] 2.1 在 `MarkdownContent` 的 react-markdown 管线中追加 `remark-gfm` 插件
- [x] 2.2 为表格补充 `overflow-x: auto` 容器样式，验证长表格不破坏布局
- [x] 2.3 验证表格、`- [ ]` 任务列表、删除线、脚注的渲染效果，确认无原始标记符号泄漏

## 3. file:line 路径引用（markdown-rendering）

- [x] 3.1 实现 mdast 文本节点遍历的 remark 插件 `remarkCodePathLinks`：匹配 `路径:行号`（要求路径含 `/`、`\` 或以代码扩展名结尾，行号 1~6 位），替换为 `ccd-file://` 链接节点
- [x] 3.2 编写误匹配抑制用例（时间 `12:30`、版本号、无扩展名片段不识别）并跑通插件单元测试
- [x] 3.3 在 `MarkdownContent` 的 `components.a` 中识别 `ccd-file://` 协议：相对路径拼接工作区根后调用 `ipc.openPath`
- [x] 3.4 实现不可点击降级：无工作区/路径越界/文件不存在时链接禁用样式且不触发 IPC
- [x] 3.5 验证点击后文件在编辑器中打开且定位到对应行号

## 4. Todo 清单实时进度（turn-progress）

- [x] 4.1 实现 `useTodoProgress(text)` hook：按行扫描 `- [x]`/`- [ ]` 块，输出 `done`/`total`，计数钳制在 `[0, total]`
- [x] 4.2 为 hook 编写单元测试（无清单、单行不识别、勾选回退不越界、多块文本）
- [x] 4.3 生成中在流式正文顶部渲染「待办 done/total」进度条，随 `streamingText` 实时更新
- [x] 4.4 回合结束后在 terminal 摘要区渲染「待办 done/total」徽章，数据源为已落盘正文重放解析
- [x] 4.5 验证会话重载后徽章由正文重新解析得到一致统计

## 5. 回合结束动作（agent-output-transcript）

- [x] 5.1 在 `appStore` 新增 `retryLastTurn(sessionId)`：取最后一条 user 条目文本，复用发送链路；生成冲突时置 `statusText` 不发送
- [x] 5.2 在 `TranscriptView` 的失败/中断 terminal 条目上显示「重试」按钮，正常完成回合不显示
- [x] 5.3 实现「复制整回合」按钮：按序拼接该回合全部 assistant 正文写入剪贴板，成功后短暂反馈，无正文时禁用
- [x] 5.4 验证重试后产生新回合、正文独立，且中断回合计数与新回合互不干扰

## 6. 桌面集成（desktop-integration）

- [x] 6.1 新增 i18n key：`generatingTitleSuffix`（生成中…）与通知文案（完成/失败/中断），补齐 zh-CN/en-US
- [x] 6.2 实现 `useRoundEndNotifications` hook：订阅 `isGenerating` 下降沿，按结果发送 HTML5 Notification（含会话标题），点击聚焦窗口
- [x] 6.3 在 `App.tsx` 挂载通知 hook，并新增窗口标题 effect（生成中「标题 · 生成中…」，结束恢复）
- [x] 6.4 验证：完成/失败/中断各触发一条通知，纯切换会话不触发；窗口标题随生成状态变化

## 7. 输入体验（input-experience）

- [x] 7.1 在 `Composer` 实现输入历史：会话级 `historyRef` + 索引导航，仅在无补全列表时 ↑/↓ 生效，当前草稿可恢复，发送后历史保留
- [x] 7.2 验证历史导航与补全列表、多行编辑互不冲突；切换会话后历史清空
- [x] 7.3 新建 `CommandPalette` 组件：Ctrl+K 开关、Esc 关闭、↑/↓ 选择、Enter 执行、结果过滤
- [x] 7.4 接入六个动作：新建会话、会话搜索、打开设置、切换主题、切换语言、打开项目目录（无工作区时禁用后两项）
- [x] 7.5 在 `App.tsx` 集成命令面板并注册 Ctrl+K；确认与现有快捷键（Ctrl+, 等）无冲突

## 8. 验证与收尾

- [x] 8.1 为改动相关组件补充/更新单元测试（命令面板导航、重试 action、复制整回合、标题 effect 等）
- [x] 8.2 运行 `npm run typecheck`、`npm test`，全部通过（已知 `workspaceFiles` EPERM 用例除外）
- [x] 8.3 运行 `npm run build`（如项目配置），确认生产构建无警告
- [ ] 8.4 手动回归：生成完整回合（含表格、todo、file:line、失败/中断分支）走查五项新体验
- [x] 8.5 运行 `openspec validate --strict` 通过并勾选本清单全部任务
