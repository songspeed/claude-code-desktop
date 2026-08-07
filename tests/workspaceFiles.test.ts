import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listWorkspaceFiles } from '../electron/workspaceFiles'

const temporaryRoots: string[] = []

function createRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  temporaryRoots.push(root)
  return root
}

afterEach(() => {
  while (temporaryRoots.length) rmSync(temporaryRoots.pop()!, { recursive: true, force: true })
})

describe('workspace file references', () => {
  it('returns ranked relative project files while excluding generated directories and symlinks', () => {
    const project = createRoot('ccd-workspace-project-')
    const outside = createRoot('ccd-workspace-outside-')
    mkdirSync(join(project, 'src'), { recursive: true })
    mkdirSync(join(project, '.github', 'workflows'), { recursive: true })
    mkdirSync(join(project, 'node_modules', 'pkg'), { recursive: true })
    mkdirSync(join(project, 'dist'), { recursive: true })
    writeFileSync(join(project, 'README.md'), '# Project')
    writeFileSync(join(project, 'src', 'Button.tsx'), 'export {}')
    writeFileSync(join(project, '.github', 'workflows', 'check.yml'), 'name: Check')
    writeFileSync(join(project, 'node_modules', 'pkg', 'index.js'), 'ignored')
    writeFileSync(join(project, 'dist', 'app.js'), 'ignored')
    writeFileSync(join(outside, 'secret.txt'), 'outside')
    // Windows file symlinks require a privilege that is not available in all
    // developer environments; directory junctions exercise the same exclusion
    // path without requiring Administrator or Developer Mode.
    if (process.platform === 'win32') {
      symlinkSync(outside, join(project, 'external-link'), 'junction')
    } else {
      symlinkSync(join(outside, 'secret.txt'), join(project, 'external-link.txt'))
    }

    expect(listWorkspaceFiles(project).map((file) => file.path)).toEqual([
      '.github/workflows/check.yml',
      'README.md',
      'src/Button.tsx',
    ])
    expect(listWorkspaceFiles(project, 'button')).toEqual([{ path: 'src/Button.tsx' }])
  })

  it('caps the response so input completion cannot enumerate unbounded workspaces', () => {
    const project = createRoot('ccd-workspace-limit-')
    for (let index = 0; index < 100; index += 1) {
      writeFileSync(join(project, `file-${String(index).padStart(3, '0')}.ts`), '')
    }

    expect(listWorkspaceFiles(project, '', 500)).toHaveLength(80)
  })
})
