## 1. 核对项目事实

- [x] 1.1 对照 `package.json`、`electron.vite.config.ts` 和 `tsconfig*.json`，确认依赖版本、开发/检查/测试/构建/跨平台打包命令及实际产物目录。
- [x] 1.2 对照 `electron/main.ts`、`electron/preload.ts`、`src/ipc.ts`、`electron/cli/`、`electron/store/`、`src/store/` 和组件目录，整理进程边界、IPC 事件、会话/项目/Skills/设置/斜杠命令能力清单。
- [x] 1.3 对照 `tests/` 与 stream-json fixture，标注自动化测试已覆盖的行为、仅 Preview 验证的行为和仍需 macOS/Windows/Linux 实机验证的场景。

## 2. 完善用户入口文档

- [x] 2.1 重写根目录 `README.md`，包含项目定位、核心能力、系统要求、Claude CLI 前置条件、快速启动、常用命令、数据与安全边界、平台打包提示和按受众分组的文档索引。
- [x] 2.2 新增 `docs/getting-started.md`，描述安装依赖、检查 `claude` 可执行文件、启动应用、关联项目目录、发送/中断消息、会话管理、模型/权限、Skills、外观/语言和桌面斜杠命令的首次使用路径。
- [x] 2.3 新增 `docs/troubleshooting.md`，按症状提供 CLI/PATH、项目目录、流式输出、中断、会话数据、Claude 用户配置和跨平台打包的安全排查步骤，并避免示例包含敏感值。

## 3. 完善维护与架构文档

- [x] 3.1 新增 `docs/development.md`，说明目录职责、IPC 与安全边界、状态和持久化约定、测试分层、调试方式、文档事实来源及提交前检查清单。
- [x] 3.2 更新 `docs/design.md`，移除过期目录或版本信息，补充当前流式事件组装、transcript 兼容投影、项目 cwd、Skills 扫描、设置持久化和主动放弃项，并链接使用/开发文档。
- [x] 3.3 更新 `docs/validation-matrix.md`，使命令和产物目录与 `package.json` 一致，区分单元测试、Preview 和三端实机验收，修正当前已验证与待验证状态。
- [x] 3.4 在 `docs/ai-usage.md` 顶部补充“开发过程历史记录”定位，并在 README 索引中将其与用户指南、贡献者指南区分开。

## 4. 校验与交付

- [x] 4.1 检查 README 和 docs 内部相对链接、文件路径、脚本名称、版本号和目录树；使用 `rg` 查找已删除路径、错误产物目录及重复/冲突说明。
- [x] 4.2 执行 `npm run typecheck` 和 `npm test`，确认文档变更未引入工作区或测试回归；条件允许时执行 `npm run build` 验证构建命令仍可复现。
- [x] 4.3 将实际校验结果和未完成的平台实机项记录回 `docs/validation-matrix.md`，复读 README 的快速开始路径并确认所有文档索引链接可达。
