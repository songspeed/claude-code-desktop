import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { ClaudeUserModelConfig, ClaudeUserModelConfigPatch } from './types'

const MODEL_FIELDS = [
  ['sonnetModel', 'ANTHROPIC_DEFAULT_SONNET_MODEL'],
  ['opusModel', 'ANTHROPIC_DEFAULT_OPUS_MODEL'],
  ['haikuModel', 'ANTHROPIC_DEFAULT_HAIKU_MODEL'],
  ['fableModel', 'ANTHROPIC_DEFAULT_FABLE_MODEL'],
] as const

type ModelConfigField = (typeof MODEL_FIELDS)[number][0]
type JsonObject = Record<string, unknown>

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function emptyConfig(path: string): ClaudeUserModelConfig {
  return {
    path,
    defaultModel: '',
    sonnetModel: '',
    opusModel: '',
    haikuModel: '',
    fableModel: '',
  }
}

function readRoot(filePath: string): JsonObject {
  if (!existsSync(filePath)) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`无法解析 Claude 用户配置：${String(error)}`)
  }
  if (!isJsonObject(parsed)) throw new Error('Claude 用户配置根节点必须是对象。')
  if ('env' in parsed && !isJsonObject(parsed.env)) {
    throw new Error('Claude 用户配置中的 env 必须是对象。')
  }
  return parsed
}

function configFromRoot(filePath: string, root: JsonObject): ClaudeUserModelConfig {
  const config = emptyConfig(filePath)
  if (typeof root.model === 'string') config.defaultModel = root.model

  const env = root.env as JsonObject | undefined
  for (const [field, key] of MODEL_FIELDS) {
    const value = env?.[key]
    if (typeof value === 'string') config[field] = value
  }
  return config
}

function normalizeValue(value: unknown): string {
  if (typeof value !== 'string') throw new Error('模型配置必须是文本。')
  if (value.length > 200 || /[\r\n]/.test(value)) {
    throw new Error('模型名称不能超过 200 个字符或包含换行。')
  }
  return value.trim()
}

/** 验证 IPC 输入并移除无意义的首尾空白。 */
export function normalizeClaudeUserModelConfigPatch(value: unknown): ClaudeUserModelConfigPatch {
  if (!isJsonObject(value)) throw new Error('无效的 Claude 模型配置。')
  return {
    defaultModel: normalizeValue(value.defaultModel),
    sonnetModel: normalizeValue(value.sonnetModel),
    opusModel: normalizeValue(value.opusModel),
    haikuModel: normalizeValue(value.haikuModel),
    fableModel: normalizeValue(value.fableModel),
  }
}

function setOptional(target: JsonObject, key: string, value: string): void {
  if (value) target[key] = value
  else delete target[key]
}

function applyPatch(root: JsonObject, patch: ClaudeUserModelConfigPatch): void {
  setOptional(root, 'model', patch.defaultModel)

  const hasMappings = MODEL_FIELDS.some(([field]) => Boolean(patch[field]))
  if (!hasMappings && root.env === undefined) return

  const env = root.env as JsonObject | undefined
  const target = env ?? {}
  if (!env) root.env = target
  for (const [field, key] of MODEL_FIELDS) {
    const value = patch[field as ModelConfigField]
    setOptional(target, key, value)
    setOptional(target, `${key}_NAME`, value)
  }
}

function writeRootAtomically(filePath: string, root: JsonObject): void {
  const temporaryPath = `${filePath}.claude-code-desktop.tmp`
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(temporaryPath, `${JSON.stringify(root, null, 2)}\n`, 'utf8')
    if (existsSync(filePath)) {
      chmodSync(temporaryPath, statSync(filePath).mode & 0o777)
    }
    renameSync(temporaryPath, filePath)
  } catch (error) {
    try {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    } catch {
      // Preserve the original write error when temporary-file cleanup also fails.
    }
    throw new Error(`无法保存 Claude 用户配置：${String(error)}`)
  }
}

export function claudeUserSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json')
}

export function readClaudeUserModelConfigFromFile(filePath: string): ClaudeUserModelConfig {
  return configFromRoot(filePath, readRoot(filePath))
}

export function saveClaudeUserModelConfigToFile(
  filePath: string,
  patch: ClaudeUserModelConfigPatch
): ClaudeUserModelConfig {
  const normalizedPatch = normalizeClaudeUserModelConfigPatch(patch)
  const root = readRoot(filePath)
  applyPatch(root, normalizedPatch)
  writeRootAtomically(filePath, root)
  return configFromRoot(filePath, root)
}

export function readClaudeUserModelConfig(): ClaudeUserModelConfig {
  return readClaudeUserModelConfigFromFile(claudeUserSettingsPath())
}

export function saveClaudeUserModelConfig(patch: ClaudeUserModelConfigPatch): ClaudeUserModelConfig {
  return saveClaudeUserModelConfigToFile(claudeUserSettingsPath(), patch)
}
