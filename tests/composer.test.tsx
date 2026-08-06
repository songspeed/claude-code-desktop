import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import Composer, {
  applyComposerCompletion,
  getComposerCompletion,
  getComposerPlaceholder,
  getComposerState,
  getComposerTaskState,
  getSlashCompletionOptions,
} from '../src/components/Composer'

describe('Composer', () => {
  it('renders stable editing and action regions with an accessible send control', () => {
    const html = renderToStaticMarkup(
      <Composer value="实现主题切换" onChange={() => {}} focusToken={0} />
    )

    expect(html).toContain('composer-shell is-idle')
    expect(html).toContain('composer-editor')
    expect(html).toContain('composer-action-area')
    expect(html).toContain('aria-label="消息输入"')
    expect(html).toContain('aria-label="发送消息"')
  })

  it('derives idle, ready, and generating states without changing the action region', () => {
    expect(getComposerState('', false, true)).toBe('is-idle')
    expect(getComposerState('实现主题切换', false, true)).toBe('is-ready')
    expect(getComposerState('实现主题切换', true, true)).toBe('is-generating')
    expect(getComposerState('实现主题切换', false, true, false)).toBe('is-idle')
    expect(getComposerState('实现主题切换', false, true, true, false)).toBe('is-idle')

    const source = readFileSync(new URL('../src/components/Composer.tsx', import.meta.url), 'utf8')
    expect(source).toContain('composer-action-area')
    expect(source).toContain("aria-label={t('stopGenerating')}")
  })

  it('maps project, CLI, and generation state to actionable input hints', () => {
    expect(getComposerPlaceholder(false, true, true, true)).toBe('描述任务、@ 文件，或让 Claude 修改当前项目…')
    expect(getComposerPlaceholder(false, true, false, true)).toBe('请先选择项目目录')
    expect(getComposerPlaceholder(false, true, true, false)).toBe('请先安装并登录 Claude Code CLI')
    expect(getComposerPlaceholder(true, true, true, true)).toBe('正在生成回复，可随时停止')
    expect(getComposerPlaceholder(false, true, true, true, 'en')).toBe('Describe a task, @ a file, or ask Claude to change this project…')
    expect(getComposerPlaceholder(false, true, false, true, 'en')).toBe('Choose a project directory first')
    expect(getComposerPlaceholder(false, true, true, true, 'zh-CN', true)).toBe('另一对话正在执行任务，当前仅可浏览')
    expect(getComposerPlaceholder(false, true, true, true, 'en', true)).toBe('Another conversation is running a task. This conversation is read-only.')
  })

  it('keeps another conversation read-only without exposing its stop action', () => {
    expect(getComposerTaskState(true, 'running-session', 'viewed-session')).toEqual({
      isGeneratingCurrentSession: false,
      isTaskRunningElsewhere: true,
      showStopAction: false,
    })
    expect(getComposerTaskState(true, 'running-session', 'running-session')).toEqual({
      isGeneratingCurrentSession: true,
      isTaskRunningElsewhere: false,
      showStopAction: true,
    })
  })

  it('defines distinct ready, focused, and disabled action states', () => {
    const styles = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8')

    expect(styles).toContain('.composer-shell.is-ready')
    expect(styles).toContain('.composer-shell:focus-within')
    expect(styles).toContain('.composer-input:focus-visible { outline: 0; }')
    expect(styles).toContain('.composer-action:disabled')
  })

  it('recognizes @ file and line-start slash references without matching email addresses', () => {
    const fileValue = '检查 @src/Comp'
    const fileCompletion = getComposerCompletion(fileValue, fileValue.length)
    expect(fileCompletion).toEqual({
      kind: 'files', query: 'src/Comp', start: 3, end: fileValue.length,
    })

    const skillValue = '  /review'
    expect(getComposerCompletion(skillValue, skillValue.length)).toEqual({
      kind: 'slash', query: 'review', start: 2, end: skillValue.length,
    })
    expect(getComposerCompletion('name@example.com', 'name@example.com'.length)).toBeNull()
    expect(getComposerCompletion('run /review', 'run /review'.length)).toBeNull()
  })

  it('combines desktop slash commands with discovered Skills', () => {
    const options = getSlashCompletionOptions([
      {
        name: 'review-workspace',
        description: 'Review current changes',
        path: '/tmp/SKILL.md',
        scope: 'project',
        source: '当前项目',
      },
    ], '', 'en')

    expect(options).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'mcp', kind: 'commands' }),
      expect.objectContaining({ value: 'plugin', kind: 'commands' }),
      expect.objectContaining({ value: 'memory', kind: 'commands' }),
      expect.objectContaining({ value: 'review-workspace', kind: 'skills' }),
    ]))
    expect(options.findIndex((option) => option.kind === 'commands')).toBeLessThan(
      options.findIndex((option) => option.kind === 'skills')
    )
  })

  it('inserts selected files and Skills as raw Claude CLI references', () => {
    const fileValue = '检查 @src/Comp'
    const fileCompletion = getComposerCompletion(fileValue, fileValue.length)!
    expect(applyComposerCompletion(fileValue, fileCompletion, 'src/Composer.tsx')).toEqual({
      value: '检查 @src/Composer.tsx ', cursor: 21,
    })

    const skillValue = '/review'
    const skillCompletion = getComposerCompletion(skillValue, skillValue.length)!
    expect(applyComposerCompletion(skillValue, skillCompletion, 'review-workspace')).toEqual({
      value: '/review-workspace ', cursor: 18,
    })
  })

  it('renders an accessible autocomplete input and file lookup integration', () => {
    const html = renderToStaticMarkup(<Composer value="" onChange={() => {}} focusToken={0} />)

    expect(html).toContain('aria-label="消息输入"')
    expect(html).toContain('aria-autocomplete="list"')
    const source = readFileSync(new URL('../src/components/Composer.tsx', import.meta.url), 'utf8')
    expect(source).toContain("ipc.listWorkspaceFiles(activeSessionId, completion.query)")
    expect(source).toContain('role="listbox"')
    expect(source).toContain('role="option"')
  })
})
