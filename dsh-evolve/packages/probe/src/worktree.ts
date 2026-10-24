/**
 * @deprecated 0.1 historical test fixture; not used by the production lifecycle.
 * Isolated workspaces for probe reruns.
 *
 * Preferred: a detached `git worktree` at HEAD, so the original checkout is
 * untouched and the probe sees only committed content. Fallback: a recursive
 * copy excluding `.git`, `node_modules`, and the live `.dsh-evolve` directory.
 * In both cases the candidate revision is seeded into the copy's
 * `.dsh-evolve`, so a child agent binds to it as its current overlay.
 */
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import type { Revision } from '@dsh-evolve/core/revision'

/** One isolated workspace and its cleanup. */
export interface IsolatedWorkspace {
  readonly dir: string
  readonly kind: 'worktree' | 'copy'
  cleanup(): Promise<void>
}

export interface IsolatedWorkspaceOptions {
  readonly cwd: string
  /** Candidate to seed, or null for the base/empty revision. */
  readonly revision: Revision | null
  /** The live `<workspace>/.dsh-evolve` directory holding stored revisions. */
  readonly revisionSource: string
  readonly gitBin?: string
}

/** Create an isolated workspace and seed the revision pointer. */
export async function createIsolatedWorkspace(options: IsolatedWorkspaceOptions): Promise<IsolatedWorkspace> {
  const git = options.gitBin ?? 'git'
  const parent = await mkdtemp(join(tmpdir(), 'dsh-evolve-probe-'))
  if (isGitWorktree(git, options.cwd)) {
    const target = join(parent, 'worktree')
    const added = spawnSync(git, ['-C', options.cwd, 'worktree', 'add', '--detach', target, 'HEAD'], {
      encoding: 'utf8',
    })
    if (added.status === 0) {
      await seedRevision(target, options.revision, options.revisionSource)
      return {
        dir: target,
        kind: 'worktree',
        cleanup: async () => {
          spawnSync(git, ['-C', options.cwd, 'worktree', 'remove', '--force', target], { encoding: 'utf8' })
          await rm(parent, { recursive: true, force: true })
        },
      }
    }
  }

  const target = join(parent, 'copy')
  await cp(options.cwd, target, {
    recursive: true,
    filter: source => {
      const rel = relative(options.cwd, source)
      return rel === ''
        || (!rel.startsWith('.git')
          && !rel.startsWith('node_modules')
          && !rel.startsWith('.dsh-evolve'))
    },
  })
  await seedRevision(target, options.revision, options.revisionSource)
  return {
    dir: target,
    kind: 'copy',
    cleanup: async () => { await rm(parent, { recursive: true, force: true }) },
  }
}

function isGitWorktree(git: string, cwd: string): boolean {
  const result = spawnSync(git, ['-C', cwd, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' })
  return result.status === 0 && result.stdout.trim() === 'true'
}

async function seedRevision(dir: string, revision: Revision | null, source: string): Promise<void> {
  const evolve = join(dir, '.dsh-evolve')
  await mkdir(evolve, { recursive: true })
  if (revision !== null) {
    await cp(join(source, 'revisions', revision.id), join(evolve, 'revisions', revision.id), { recursive: true })
  }
  await writeFile(
    join(evolve, 'state.json'),
    `${JSON.stringify({ schema: 1, current: revision?.id ?? null }, null, 2)}\n`,
    'utf8',
  )
}
