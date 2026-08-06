import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listInstalledSkills, readSkillMetadata } from '../electron/skills'

const temporaryRoots: string[] = []

function createRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  temporaryRoots.push(root)
  return root
}

function writeSkill(root: string, name: string, description: string): void {
  const directory = join(root, name)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: \"${description}\"\n---\n`, 'utf8')
}

afterEach(() => {
  while (temporaryRoots.length) rmSync(temporaryRoots.pop()!, { recursive: true, force: true })
})

describe('本地 Skills 发现', () => {
  it('扫描项目、用户和插件目录，并按作用域排序和去重', () => {
    const home = createRoot('ccd-skills-home-')
    const project = createRoot('ccd-skills-project-')
    const plugin = createRoot('ccd-skills-plugin-')

    writeSkill(join(project, '.claude', 'skills'), 'project-skill', '项目级 Skill')
    writeSkill(join(home, '.claude', 'skills'), 'user-skill', '用户级 Skill')
    writeSkill(join(plugin, 'skills'), 'plugin-skill', '插件 Skill')
    mkdirSync(join(home, '.claude', 'plugins'), { recursive: true })
    writeFileSync(
      join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({
        plugins: {
          'sample-plugin': [{ installPath: plugin }],
          duplicate: [{ installPath: join(project, '.claude') }],
        },
      }),
      'utf8'
    )

    const skills = listInstalledSkills(project, home)

    expect(skills.map((skill) => [skill.name, skill.scope, skill.source])).toEqual([
      ['project-skill', 'project', '当前项目'],
      ['user-skill', 'user', '用户级'],
      ['plugin-skill', 'plugin', 'sample-plugin'],
    ])
  })

  it('在无 frontmatter 或不可读取目录时使用回退值并继续返回其他结果', () => {
    const home = createRoot('ccd-skills-fallback-home-')
    const project = createRoot('ccd-skills-fallback-project-')
    const root = join(project, '.claude', 'skills', 'plain')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'SKILL.md'), '# Plain skill', 'utf8')

    expect(readSkillMetadata(join(root, 'SKILL.md'), 'plain')).toEqual({ name: 'plain', description: '' })
    expect(listInstalledSkills(project, home)).toMatchObject([{ name: 'plain', scope: 'project' }])
  })
})
