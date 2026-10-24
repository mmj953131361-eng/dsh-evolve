/** Reversible, compare-and-swap publication of Evo text and skills to native DSH scopes. */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { isSeq, parseDocument, stringify } from 'yaml'
import { atomicJson, withLock } from './persistence.js'
import { contentHash, normalizeTree, type HarnessTree } from './tree.js'
import { installPromptComponents, installSkillComponents, unsupportedNativePaths } from './native-components.js'
import { parseFrontmatter } from './validator.js'

export type ScopedHarnessTarget =
  | { readonly scope: 'project'; readonly root: string }
  | { readonly scope: 'profile'; readonly root: string; readonly name: string }

export interface ScopedHarnessFile {
  readonly path: string
  readonly before: string | null
  readonly after: string | null
}

export interface ScopedHarnessPlan {
  readonly schema: 1
  readonly id: string
  readonly target: ScopedHarnessTarget
  readonly contentHash: string
  readonly activation: 'new-session' | 'profile-restart'
  readonly activationDetail: string
  readonly skillNames: Readonly<Record<string, string>>
  readonly files: readonly ScopedHarnessFile[]
}

export interface ScopedHarnessReceipt {
  readonly plan: ScopedHarnessPlan
  readonly appliedAt: string
}

interface ManagedState {
  schema: 1
  files: Record<string, string>
  instructionBlock: string | null
  instructionWasAbsent: boolean
  profilePatch: string | null
  patchWasAbsent: boolean
}

const BASE = '.dsh/evolve/scoped-harness'
const STATE = `${BASE}/state.json`
const TRANSACTION = `${BASE}/transaction.json`
const OVERLAY = `${BASE}/profile.overlay.yml`
const ROW = 'evolve-profile-harness-loader'
const START = '<!-- dsh-evolve:managed-harness:start -->'
const END = '<!-- dsh-evolve:managed-harness:end -->'
const TEXT_PATHS = ['prompt/system.md', 'prompt/tool-guidance.md', 'prompt/guardrails.md', 'memory/MEMORY.md', 'prompt/task-context.md']
const emptyState = (): ManagedState => ({ schema: 1, files: {}, instructionBlock: null,
  instructionWasAbsent: false, profilePatch: null, patchWasAbsent: false })

/** Preview exact bytes and activation timing; this function never writes files. */
export async function previewScopedHarness(request: { target: ScopedHarnessTarget; tree: HarnessTree }): Promise<ScopedHarnessPlan> {
  const target = await canonicalTarget(request.target)
  const tree = normalizeTree(request.tree)
  const unsupported = unsupportedNativePaths(tree)
  if (unsupported.length) throw new Error(`persistent scope does not support these components: ${unsupported.join(', ')}`)
  const stateText = await readSafe(target.root, STATE)
  const old = stateText === null ? emptyState() : readState(stateText)
  const next = emptyState()
  const files: ScopedHarnessFile[] = []
  const names: Record<string, string> = {}
  const skills = new Map<string, string>()
  for (const [path, text] of Object.entries(tree)) {
    if (!path.startsWith('skills/')) continue
    const fields = parseFrontmatter(text)
    if (!fields?.name || !fields.description || !isSkillName(fields.name)) {
      throw new Error(`invalid skill frontmatter: ${path}`)
    }
    for (const flag of ['disable-model-invocation', 'user-invocable']) {
      if (fields[flag] !== undefined && fields[flag] !== 'true' && fields[flag] !== 'false') throw new Error(`invalid skill ${flag}: ${path}`)
    }
    if (names[fields.name]) throw new Error(`duplicate skill name: ${fields.name}`)
    const name = `evo-${target.scope}-${fields.name}`
    names[fields.name] = name
    skills.set(name, renameSkill(text, name))
  }
  const instructions = TEXT_PATHS.filter(path => tree[path]?.trim()).map(path => `### ${path}\n\n${tree[path]}`).join('\n\n')
  if (instructions.includes(START) || instructions.includes(END)) throw new Error('harness text contains a reserved management marker')
  const aliasText = Object.entries(names).map(([source, name]) => `- ${source}: use the native skill named ${name}.`).join('\n')
  const text = [instructions, aliasText ? `### Evo skill names\n\n${aliasText}` : ''].filter(Boolean).join('\n\n')
  const add = async (path: string, after: string | null): Promise<void> => {
    files.push({ path: join(target.root, path), before: await readSafe(target.root, path), after })
  }
  if (target.scope === 'project') {
    const before = await readSafe(target.root, 'AGENTS.local.md')
    let rest = before ?? ''
    if (old.instructionBlock !== null) {
      if (!rest.includes(old.instructionBlock) || rest.split(START).length !== 2 || rest.split(END).length !== 2) {
        throw new Error('managed AGENTS.local.md block changed; preview refused')
      }
      rest = rest.replace(old.instructionBlock, '')
    } else if (rest.includes(START) || rest.includes(END)) {
      throw new Error('unowned Evo marker in AGENTS.local.md; refusing to replace it')
    }
    next.instructionWasAbsent = old.instructionBlock !== null ? old.instructionWasAbsent : before === null
    next.instructionBlock = text ? `\n\n${START}\n${text}\n${END}\n` : null
    const after = rest + (next.instructionBlock ?? '')
    await add('AGENTS.local.md', !after && next.instructionWasAbsent ? null : after)
    for (const [name, body] of skills) next.files[`.dsh/skills/${name}/SKILL.md`] = body
  } else {
    const before = await readSafe(target.root, 'cordis.patch.yml')
    const doc = parseDocument(before ?? '[]\n')
    if (doc.errors.length || !isSeq(doc.contents)) throw new Error('profile cordis.patch.yml must be a valid patch list')
    doc.contents.flow = false
    const rows = doc.toJS() as unknown[]
    const indices = rows.flatMap((row, index) => hasManagedRow(row) ? [index] : [])
    if (indices.length > 1) throw new Error('duplicate Evo profile loader rows')
    const index = indices[0]
    if (old.profilePatch !== null) {
      if (index === undefined || JSON.stringify(rows[index]) !== old.profilePatch) throw new Error('managed Profile loader changed; preview refused')
      doc.contents.delete(index)
    } else if (index !== undefined) throw new Error('unowned Evo Profile loader; refusing to replace it')
    next.patchWasAbsent = old.profilePatch !== null ? old.patchWasAbsent : before === null
    if (Object.keys(tree).length) {
      const row = { insert: [{ id: ROW, name: '@deepseek-ai/cordis-plugin-include', config: { path: join(target.root, OVERLAY) } }] }
      next.profilePatch = JSON.stringify(row)
      doc.add(row)
      const nativeTree: Record<string, string> = Object.fromEntries(Object.entries(tree).filter(([path]) => !path.startsWith('skills/')))
      for (const [name, content] of skills) nativeTree[`skills/${name}/SKILL.md`] = content
      if (aliasText) nativeTree['prompt/tool-guidance.md'] = [nativeTree['prompt/tool-guidance.md'], `### Evo skill names\n\n${aliasText}`].filter(Boolean).join('\n\n')
      next.files[OVERLAY] = stringify([{ id: 'evolve-profile-harness', name: '@dsh-evolve/bundle/scoped-harness', config: { tree: nativeTree } }])
    }
    // The loader row is committed last, after its referenced overlay exists.
    files.push({ path: join(target.root, 'cordis.patch.yml'), before,
      after: doc.contents.items.length === 0 && next.patchWasAbsent ? null : doc.toString() })
  }
  const ownedFiles: ScopedHarnessFile[] = []
  for (const path of [...new Set([...Object.keys(old.files), ...Object.keys(next.files)])].sort()) {
    if (!(target.scope === 'project'
      ? /^\.dsh\/skills\/evo-project-[a-zA-Z0-9_-]+\/SKILL\.md$/.test(path)
      : path === OVERLAY)) throw new Error(`invalid managed scope file: ${path}`)
    const before = await readSafe(target.root, path)
    if (old.files[path] === undefined ? before !== null : before !== old.files[path]) {
      throw new Error(`managed file conflict: ${path}`)
    }
    ownedFiles.push({ path: join(target.root, path), before, after: next.files[path] ?? null })
  }
  files.unshift(...ownedFiles)
  files.push({ path: join(target.root, STATE), before: stateText, after: JSON.stringify(next, null, 2) + '\n' })
  const data = { schema: 1 as const, target, contentHash: contentHash(tree),
    activation: target.scope === 'project' ? 'new-session' as const : 'profile-restart' as const,
    activationDetail: target.scope === 'project'
      ? 'Open a new DSH session in this project with native agent-instructions and skill-filesystem enabled and verify their loading. Project instructions use the native AGENTS.local.md context mechanism, not identical system/context roles to the original session; current-session refresh is not guaranteed.'
      : `DSH Profile ${target.name}: with HMR enabled the overlay may load automatically and affect existing Agents on subsequent requests; otherwise restart this Profile. Persistence alone does not confirm runtime loading.`,
    skillNames: names, files }
  return { ...data, id: digest(data) }
}

/** Apply only the reviewed bytes, refusing changed targets and recovering interrupted writes. */
export async function applyScopedHarness(plan: ScopedHarnessPlan): Promise<ScopedHarnessReceipt> {
  await validatePlan(plan)
  await safePath(plan.target.root, `${BASE}/transaction.lock`)
  return withLock(join(plan.target.root, `${BASE}/transaction`), async () => {
    await recover(plan.target)
    const current = await Promise.all(plan.files.map(file => readSafe(plan.target.root, relative(plan.target.root, file.path))))
    if (current.every((value, index) => value === plan.files[index]!.after)) return { plan, appliedAt: new Date().toISOString() }
    for (const [index, file] of plan.files.entries()) {
      if (current[index] !== file.before) throw new Error(`stale scope preview: ${file.path}`)
    }
    await atomicJson(join(plan.target.root, TRANSACTION), plan)
    try {
      for (const file of plan.files) await replaceSafe(plan.target.root, file.path, file.before, file.after)
    } catch (error) {
      try { await recover(plan.target) }
      catch (recoveryError) { throw new AggregateError([error, recoveryError], 'scope application incomplete; recovery journal preserved') }
      throw error
    }
    await rm(join(plan.target.root, TRANSACTION))
    return { plan, appliedAt: new Date().toISOString() }
  })
}

/** Read publication state after recovering a partial transaction; never starts a new application. */
export async function inspectScopedHarness(plan: ScopedHarnessPlan): Promise<'applied' | 'unchanged' | 'conflict'> {
  await validatePlan(plan)
  await safePath(plan.target.root, `${BASE}/transaction.lock`)
  return withLock(join(plan.target.root, `${BASE}/transaction`), async () => {
    await recover(plan.target)
    const current = await Promise.all(plan.files.map(file => readSafe(plan.target.root, relative(plan.target.root, file.path))))
    if (current.every((value, index) => value === plan.files[index]!.after)) return 'applied'
    if (current.every((value, index) => value === plan.files[index]!.before)) return 'unchanged'
    return 'conflict'
  })
}

/** Undo an exact application; user edits after application cause a conflict instead of data loss. */
export async function rollbackScopedHarness(receipt: ScopedHarnessReceipt): Promise<ScopedHarnessReceipt> {
  await validatePlan(receipt.plan)
  const { id: _id, ...original } = receipt.plan
  const data = { ...original, files: [...original.files].reverse().map(file => ({ ...file, before: file.after, after: file.before })) }
  return applyScopedHarness({ ...data, id: digest(data) })
}

/** Recover a process-interrupted publication to its pre-application bytes. */
export async function recoverScopedHarness(target: ScopedHarnessTarget): Promise<void> {
  const canonical = await canonicalTarget(target)
  await safePath(canonical.root, `${BASE}/transaction.lock`)
  await withLock(join(canonical.root, `${BASE}/transaction`), () => recover(canonical))
}

async function recover(target: ScopedHarnessTarget): Promise<void> {
  const raw = await readSafe(target.root, TRANSACTION)
  if (raw === null) return
  const plan = JSON.parse(raw) as ScopedHarnessPlan
  await validatePlan(plan)
  if (JSON.stringify(plan.target) !== JSON.stringify(target)) throw new Error('scope recovery target mismatch')
  for (const file of plan.files) {
    const current = await readSafe(target.root, relative(target.root, file.path))
    if (current !== file.before && current !== file.after) throw new Error(`scope recovery conflict: ${file.path}`)
  }
  for (const file of [...plan.files].reverse()) {
    const current = await readSafe(target.root, relative(target.root, file.path))
    if (current !== file.before) await replaceSafe(target.root, file.path, current, file.before)
  }
  await rm(join(target.root, TRANSACTION))
}

async function canonicalTarget(target: ScopedHarnessTarget): Promise<ScopedHarnessTarget> {
  if (!isAbsolute(target.root)) throw new Error('scope root must be absolute')
  const root = await realpath(target.root)
  if (!(await lstat(root)).isDirectory()) throw new Error('scope root must be a directory')
  if (target.scope === 'profile' && (!target.name || /[\\/]/.test(target.name))) throw new Error('invalid Profile name')
  return { ...target, root }
}

async function safePath(root: string, path: string): Promise<string> {
  const full = resolve(root, path)
  const rel = relative(root, full)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`scope path escapes target: ${path}`)
  let cursor = root
  for (const part of rel.split(sep)) {
    cursor = join(cursor, part)
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error(`symbolic link in scope path: ${cursor}`) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return full
}

async function readSafe(root: string, path: string): Promise<string | null> {
  const full = await safePath(root, path)
  try { return await readFile(full, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}

async function replaceSafe(root: string, file: string, expected: string | null, next: string | null): Promise<void> {
  await safePath(root, file)
  if (await readSafe(root, file) !== expected) throw new Error(`concurrent scope edit: ${file}`)
  if (next === expected) return
  if (next === null) { await rm(file); return }
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  const handle = await open(temp, 'wx', 0o600)
  try { await handle.writeFile(next, 'utf8'); await handle.sync() }
  finally { await handle.close() }
  try {
    await safePath(root, file)
    if (await readSafe(root, file) !== expected) throw new Error(`concurrent scope edit: ${file}`)
    await rename(temp, file)
  } finally { await rm(temp, { force: true }) }
}

async function validatePlan(plan: ScopedHarnessPlan): Promise<void> {
  const { id, ...data } = plan
  if (plan.schema !== 1 || id !== digest(data)) throw new Error('invalid scope plan digest')
  const target = await canonicalTarget(plan.target)
  if (target.root !== plan.target.root) throw new Error('scope target moved')
  const seen = new Set<string>()
  for (const file of plan.files) {
    const path = relative(target.root, file.path).split(sep).join('/')
    const allowed = path === STATE || (target.scope === 'project'
      ? path === 'AGENTS.local.md' || /^\.dsh\/skills\/evo-project-[a-zA-Z0-9_-]+\/SKILL\.md$/.test(path)
      : path === OVERLAY || path === 'cordis.patch.yml')
    if (!allowed || seen.has(path) || (file.before !== null && typeof file.before !== 'string') || (file.after !== null && typeof file.after !== 'string')) throw new Error(`invalid scope plan file: ${path}`)
    seen.add(path)
    await safePath(target.root, path)
  }
}

function readState(text: string): ManagedState {
  const state = JSON.parse(text) as ManagedState
  if (state.schema !== 1 || !state.files || typeof state.files !== 'object'
    || !Object.values(state.files).every(value => typeof value === 'string')
    || !(state.instructionBlock === null || typeof state.instructionBlock === 'string')
    || !(state.profilePatch === null || typeof state.profilePatch === 'string')) throw new Error('invalid managed scope state')
  return state
}

function hasManagedRow(row: unknown): boolean {
  if (!row || typeof row !== 'object') return false
  const value = row as Record<string, unknown>
  return value.id === ROW || (Array.isArray(value.insert) && value.insert.some(item => item && typeof item === 'object' && item.id === ROW))
}

function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }

function renameSkill(text: string, name: string): string {
  const match = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/)
  if (!match) throw new Error('invalid skill frontmatter delimiters')
  const doc = parseDocument(match[1]!)
  if (doc.errors.length) throw new Error('invalid skill YAML')
  doc.set('name', name)
  return `---\n${doc.toString()}---\n${match[2]}`
}

/** Native Profile overlay plugin. It contributes global entries inherited by preset scopes. */
export const name = 'evolve-profile-harness'
export const inject = ['systemPrompt', 'skills']
export interface Config { tree: HarnessTree }

/** Register independent prompt/skill names; Cordis owns their disposal on Profile unload. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const tree = normalizeTree(config.tree)
  if (unsupportedNativePaths(tree).length) throw new Error('unsupported component in Evo Profile overlay')
  for (const [path, content] of Object.entries(tree)) {
    if (!path.startsWith('skills/')) continue
    const fields = parseFrontmatter(content)
    if (!fields?.name || !isSkillName(fields.name) || !fields.name.startsWith('evo-profile-')) throw new Error('invalid Evo Profile skill')
  }
  installPromptComponents(ctx, () => tree, 'evolve:profile')
  await installSkillComponents(ctx, tree)
}
