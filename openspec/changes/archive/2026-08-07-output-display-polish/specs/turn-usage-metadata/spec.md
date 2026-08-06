## Purpose

补充回合级元数据行的展示完整性：将传输已提供但此前未展示的缓存写入 token 纳入元数据行，使 token 消耗信息在界面上完整呈现。

## ADDED Requirements

### Requirement: 展示缓存写入 token

系统 SHALL 在回合元数据行中展示缓存写入 token（`cache_creation_input_tokens` 对应值），与缓存读取 token 同样仅在数值可用且大于零时显示。缺失时 SHALL NOT 显示占位值。

#### Scenario: 回合含缓存写入

- **WHEN** 传输在回合结果中提供缓存创建 token 数值
- **THEN** 元数据行显示缓存写入 token，且与既有缓存读取 token 并列展示

#### Scenario: 无缓存写入数据

- **WHEN** 回合结果未提供或提供为零的缓存创建 token
- **THEN** 元数据行不显示缓存写入字段，其余字段不受影响
