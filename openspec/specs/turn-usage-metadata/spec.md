# turn-usage-metadata Specification

## Purpose
补充回合级元数据行的展示完整性：将传输已提供但此前未展示的缓存写入 token 纳入元数据行，使 token 消耗信息在界面上完整呈现。
## Requirements
### Requirement: 展示缓存写入 token

系统 SHALL 在回合元数据行中展示缓存写入 token（`cache_creation_input_tokens` 对应值），与缓存读取 token 同样仅在数值可用且大于零时显示。缺失时 SHALL NOT 显示占位值。

#### Scenario: 回合含缓存写入

- **WHEN** 传输在回合结果中提供缓存创建 token 数值
- **THEN** 元数据行显示缓存写入 token，且与既有缓存读取 token 并列展示

#### Scenario: 无缓存写入数据

- **WHEN** 回合结果未提供或提供为零的缓存创建 token
- **THEN** 元数据行不显示缓存写入字段，其余字段不受影响

### Requirement: 展示回合级用量与成本

系统 SHALL 在每个输出回合的终止状态处显示该回合的元数据行，包含可获得的输入 token、输出 token、缓存读取 token、缓存写入 token、耗时与成本。任一元数据缺失时，系统 SHALL 只显示已获得的字段，且 SHALL NOT 显示占位值或推测值。

#### Scenario: 展示完整元数据

- **WHEN** 传输在回合结束时提供 token 用量、成本与耗时
- **THEN** 系统在回合终止状态旁显示包含各项 token、成本与耗时的元数据行

#### Scenario: 部分元数据缺失

- **WHEN** 传输仅提供 token 用量而未提供成本或耗时
- **THEN** 系统仅显示已提供的字段，不显示占位符，不产生任何数值

### Requirement: 回合元数据随会话持久化并恢复

系统 SHALL 将回合元数据随该回合的终止条目一并记录，并在重新打开会话后以与实时显示一致的格式呈现。

#### Scenario: 重新打开会话后显示历史元数据

- **WHEN** 用户重新打开包含已完成回合的会话
- **THEN** 系统在对应回合的终止状态旁显示与该回合一并记录的用量、成本与耗时

#### Scenario: 历史回合缺少元数据

- **WHEN** 会话中的回合终止条目不包含元数据
- **THEN** 系统仅显示该回合的既有内容，不显示占位值或根据其他内容推算的数值

### Requirement: 标识回合所用模型

系统 SHALL 在回合元数据中标识生成该回合所用的模型。模型名以传输提供的信息为准；缺失时系统 SHALL NOT 显示模型信息。

#### Scenario: 显示回合模型

- **WHEN** 传输在回合结果中提供该回合实际使用的模型
- **THEN** 系统在元数据行中显示该模型名

#### Scenario: 模型信息缺失

- **WHEN** 传输未提供回合模型信息
- **THEN** 元数据行不显示模型名，其余字段不受影响

