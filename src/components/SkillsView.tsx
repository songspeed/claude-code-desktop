import { CircleAlert, Puzzle, RefreshCw } from 'lucide-react'
import { skillScopeLabel, useTranslation } from '../i18n'
import { useAppStore } from '../store/appStore'

export default function SkillsView() {
  const skills = useAppStore((state) => state.skills)
  const loading = useAppStore((state) => state.skillsLoading)
  const error = useAppStore((state) => state.skillsError)
  const refreshSkills = useAppStore((state) => state.refreshSkills)
  const { locale, t } = useTranslation()

  return (
    <section className="skills-view" aria-label={t('skills')}>
      <header className="workspace-heading" data-settings-target="skills-heading" tabIndex={-1}>
        <div className="workspace-title-group">
          <h1>{t('skills')}</h1>
          <span>{loading ? t('readingLocalDirectory') : t('skillsDiscovered').replace('{count}', String(skills.length))}</span>
        </div>
        <button
          className="icon-button workspace-icon-action"
          onClick={() => refreshSkills()}
          disabled={loading}
          title={t('refreshSkills')}
          aria-label={t('refreshSkills')}
          data-settings-target="skills-refresh"
        >
          <RefreshCw className={loading ? 'is-spinning' : undefined} size={17} />
        </button>
      </header>

      <div className="skills-scroll">
        {error && (
          <div className="skills-feedback is-error" role="alert">
            <CircleAlert size={17} />
            <span>{t('unableToReadSkills')}{error}</span>
          </div>
        )}

        {loading && !skills.length ? (
          <div className="skills-feedback">
            <RefreshCw className="is-spinning" size={20} />
            <span>{t('scanningLocalSkills')}</span>
          </div>
        ) : !skills.length && !error ? (
          <div className="skills-empty-state">
            <div className="empty-state-symbol"><Puzzle size={28} strokeWidth={1.6} /></div>
            <h2>{t('noSkillsFound')}</h2>
            <p>{t('skillsEmptyDescription')}</p>
          </div>
        ) : (
          <div className="skills-list" aria-live="polite">
            {skills.map((skill) => (
              <article className="skill-entry" key={`${skill.scope}:${skill.path}`}>
                <div className="skill-entry-icon" aria-hidden="true"><Puzzle size={17} /></div>
                <div className="skill-entry-copy">
                  <div className="skill-entry-title">
                    <strong>{skill.name}</strong>
                    <span className={`skill-scope skill-scope-${skill.scope}`}>{skillScopeLabel(locale, skill.scope)}</span>
                  </div>
                  <p>{skill.description || t('noSkillDescription')}</p>
                  <div className="skill-entry-meta" title={skill.path}>
                    <span>{skill.source}</span>
                    <code>{skill.path}</code>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
