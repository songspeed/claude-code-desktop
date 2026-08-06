import { CircleHelp, Cpu, Languages, Palette, Puzzle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { TranslationKey } from '../i18n'

export const SETTINGS_SECTIONS = ['agent-models', 'appearance', 'language', 'skills', 'about'] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export const SETTINGS_GROUPS = ['application', 'agent-models', 'tools-integrations'] as const
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number]

export interface SettingSearchTarget {
  id: string
  labelKey: TranslationKey
  descriptionKey: TranslationKey
}

export interface SettingsCatalogItem {
  id: SettingsSection
  group: SettingsGroup
  labelKey: TranslationKey
  descriptionKey: TranslationKey
  Icon: LucideIcon
  targets: SettingSearchTarget[]
}

export const SETTINGS_CATALOG: SettingsCatalogItem[] = [
  {
    id: 'appearance', group: 'application', labelKey: 'appearance', descriptionKey: 'appearanceSearchDescription', Icon: Palette,
    targets: [{ id: 'appearance-theme', labelKey: 'theme', descriptionKey: 'appearanceSearchDescription' }],
  },
  {
    id: 'language', group: 'application', labelKey: 'language', descriptionKey: 'languageDescription', Icon: Languages,
    targets: [{ id: 'language-options', labelKey: 'language', descriptionKey: 'languageDescription' }],
  },
  {
    id: 'about', group: 'application', labelKey: 'about', descriptionKey: 'aboutDescription', Icon: CircleHelp,
    targets: [{ id: 'about-heading', labelKey: 'about', descriptionKey: 'aboutDescription' }],
  },
  {
    id: 'agent-models', group: 'agent-models', labelKey: 'agentAndModels', descriptionKey: 'agentAndModelsDescription', Icon: Cpu,
    targets: [
      { id: 'claude-model-defaultModel', labelKey: 'defaultModel', descriptionKey: 'defaultModelPlaceholder' },
      { id: 'claude-model-sonnetModel', labelKey: 'sonnetMapping', descriptionKey: 'sonnetModelPlaceholder' },
      { id: 'claude-model-opusModel', labelKey: 'opusMapping', descriptionKey: 'opusModelPlaceholder' },
      { id: 'claude-model-haikuModel', labelKey: 'haikuMapping', descriptionKey: 'haikuModelPlaceholder' },
      { id: 'claude-model-fableModel', labelKey: 'fableMapping', descriptionKey: 'fableModelPlaceholder' },
      { id: 'cli-health', labelKey: 'claudeCli', descriptionKey: 'cliHealthDescription' },
      { id: 'claude-refresh', labelKey: 'refreshConfiguration', descriptionKey: 'refreshConfigurationDescription' },
    ],
  },
  {
    id: 'skills', group: 'tools-integrations', labelKey: 'skills', descriptionKey: 'skillsEmptyDescription', Icon: Puzzle,
    targets: [{ id: 'skills-refresh', labelKey: 'refreshSkills', descriptionKey: 'scanningLocalSkills' }],
  },
]

export interface SettingsSearchResult {
  section: SettingsSection
  targetId: string
  label: string
  description: string
}

export function findSettingsSearchResults(
  query: string,
  translate: (key: TranslationKey) => string,
): SettingsSearchResult[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return []

  return SETTINGS_CATALOG.flatMap((item) => {
    const entries: Array<SettingSearchTarget & { id: string }> = [
      { id: `${item.id}-heading`, labelKey: item.labelKey, descriptionKey: item.descriptionKey },
      ...item.targets,
    ]
    return entries.flatMap((entry) => {
      const label = translate(entry.labelKey)
      const description = translate(entry.descriptionKey)
      return `${label} ${description}`.toLocaleLowerCase().includes(normalized)
        ? [{ section: item.id, targetId: entry.id, label, description }]
        : []
    })
  })
}

export const settingsGroupLabelKeys: Record<SettingsGroup, TranslationKey> = {
  application: 'settingsGroupApplication',
  'agent-models': 'settingsGroupAgentModels',
  'tools-integrations': 'settingsGroupToolsIntegrations',
}
