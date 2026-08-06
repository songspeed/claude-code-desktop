# skill-catalog Specification

## Purpose

让用户在桌面客户端中查看当前项目、用户目录和已安装插件提供的 Claude Code Skills，从而在开始任务前了解本地可用能力。

## Requirements

### Requirement: 发现已安装 Skills
系统 SHALL 发现当前项目、用户目录和已安装插件中的 `SKILL.md` 文件，并返回每项 Skill 的名称、说明、作用域和来源。无法读取的目录或文件 MUST NOT 使客户端不可用。

#### Scenario: 展示多个作用域的 Skills
- **WHEN** 当前项目、用户目录或已安装插件包含有效的 `SKILL.md`
- **THEN** 系统返回对应 Skills，并分别标识为项目、用户或插件作用域

#### Scenario: 忽略重复或不可读取的 Skills
- **WHEN** 同一个 Skill 路径被多个发现来源引用，或某个来源不可读取
- **THEN** 系统最多展示一次该 Skill，并继续显示其余可读取的 Skills

### Requirement: 浏览并刷新 Skills
系统 SHALL 在独立的 Skills 工作区中展示已发现 Skill 的名称、说明、作用域、来源与文件路径，并允许用户手动刷新结果。

#### Scenario: 打开 Skills 工作区
- **WHEN** 用户从工作台导航进入 Skills
- **THEN** 系统加载当前会话项目上下文下可发现的 Skills，并按项目、用户、插件的优先级排序显示

#### Scenario: 刷新 Skills 列表
- **WHEN** 用户在 Skills 工作区执行刷新
- **THEN** 系统重新扫描本地 Skills 并使用最新结果更新列表
