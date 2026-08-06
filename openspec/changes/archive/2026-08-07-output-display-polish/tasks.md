## 1. ANSI 转义序列剥离

- [x] 1.1 `streamParser.ts` 新增 `stripAnsi`（标准 CSI 正则，零依赖），并在 `stringifyValue` 输出路径统一剥离颜色/样式/光标控制序列
- [x] 1.2 `tests/streamParser.test.ts` 新增用例：含颜色码输出剥离后无转义码、无效/空序列安全剥离、有效文本原样保留

## 2. 缓存写入 token 显示

- [x] 2.1 `UsageLine` 并列显示缓存写入 token（>0 才显示），`src/i18n.ts` 补充 `usageCacheWrite` 中英文案
- [x] 2.2 更新 `tests/transcriptView.test.tsx`：含缓存写入的元数据行渲染断言与缺失时隐藏断言

## 3. 实时阶段状态

- [x] 3.1 `agentTransport.ts` 新增 `phase_update` 事件（携带阶段字符串）
- [x] 3.2 `streamParser.ts` 解析 `system/status`（value 为字符串时）为 `phase_update`
- [x] 3.3 `turnAssembler.ts` 维护 `livePhase`：覆盖式更新，回合结束/错误/中断时清零
- [x] 3.4 `appStore.ts` 新增 `streamingPhase` 状态：flush 时同步，发送/结束/错误/中断清零（与 `streamingThinkingTokens` 同模式）
- [x] 3.5 `TranscriptView.tsx` 生成区显示阶段徽章；`src/i18n.ts` 补充已知阶段中英文案映射，未知阶段回退显示原文
- [x] 3.6 `src/App.css` 补充阶段徽章样式（浅色/深色主题）
- [x] 3.7 更新测试：`streamParser` 阶段解析用例、`turnAssembler` 的 `livePhase` 生命周期用例、`transcriptView` 阶段徽章渲染断言

## 4. 流式渲染节流

- [x] 4.1 新增 `useThrottledStream` hook：60ms 窗口合并更新，空串/终态立即提交
- [x] 4.2 `ChatView.tsx` 接入节流：节流后值同时驱动输出签名与渲染，保证未读计数不错位
- [x] 4.3 `MarkdownContent` 与 `ThinkingBlock` 以 `React.memo` 包裹，流式期间已落盘内容跳过重解析
- [x] 4.4 更新测试：hook 用假定时器验证合并与终态立即提交；`chatView` 签名测试保持通过

## 5. 差异预览定位文件

- [x] 5.1 `preload.ts` 新增 `openPath`（透传 `shell.openPath`），`main.ts` 注册对应 IPC
- [x] 5.2 `EditDiffBlock` 显示 `file_path` 与「打开」按钮：相对路径拼接工作区根，无工作区关联时按钮禁用；`src/i18n.ts` 补充文案
- [x] 5.3 `src/App.css` 补充 diff 打开按钮样式
- [x] 5.4 更新 `tests/transcriptView.test.tsx`：路径展示、按钮可用/禁用状态断言

## 6. 验证

- [x] 6.1 运行 `npm run typecheck` 与 `npm test`，全部通过（注：`workspaceFiles` 的 symlink 用例在 Windows 无开发者模式下 EPERM，属预存环境限制，与本改动无关；其余 139 项全部通过）
- [x] 6.2 勾选本任务清单全部条目
