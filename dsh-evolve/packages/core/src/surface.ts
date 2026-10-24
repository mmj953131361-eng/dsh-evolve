/**
 * Surface: the closed allow-list of paths a Revision may edit.
 *
 * The default surface follows PRD §7.1.2 and must not be widened implicitly:
 * anything not classified here is rejected by the validator. The evolve
 * machinery itself (approval, sandbox, permissions, credentials, and the
 * evolve packages) is explicitly denied.
 */

/** Path classes the surface recognizes. */
export type SurfaceKind =
  | 'always-on'
  | 'skill'
  | 'guard-rule'
  | 'memory'
  | 'l2-preset'
  | 'l2-subagent'
  | 'l2-patch'
  | 'candidate'
  | 'loop-rule'
  | 'loop-variant'
  | 'denied'
  | 'unknown'

/** Declarative surface whitelist carried by Policy. */
export interface SurfaceSpec {
  readonly alwaysOn: { readonly files: readonly string[]; readonly maxChars: number }
  readonly skills: { readonly dir: string; readonly frontmatterRequired: readonly string[] }
  readonly guardRules: { readonly file: string }
  readonly memory: { readonly file: string }
  readonly l2: { readonly presets: boolean; readonly subagents: boolean; readonly patchRows: boolean }
  readonly candidates: { readonly dir: string }
  readonly loopRules: { readonly file: string }
  readonly loopVariant: { readonly dir: string }
  /** Path prefixes that can never enter a Revision; highest priority. */
  readonly denied: readonly string[]
}

/**
 * Deployment default. Changing this object is a security-relevant change and
 * must be reviewed as part of the surface, not as configuration.
 */
export const DEFAULT_SURFACE: SurfaceSpec = Object.freeze({
  alwaysOn: Object.freeze({
    files: Object.freeze([
      'prompt/system.md',
      'prompt/tool-guidance.md',
      'prompt/guardrails.md',
      'prompt/task-context.md',
      'memory/MEMORY.md',
    ]),
    maxChars: 24000,
  }),
  skills: Object.freeze({
    dir: 'skills',
    frontmatterRequired: Object.freeze(['name', 'description']),
  }),
  guardRules: Object.freeze({ file: 'guard/rules.yml' }),
  memory: Object.freeze({ file: 'memory/MEMORY.md' }),
  l2: Object.freeze({ presets: true, subagents: true, patchRows: true }),
  candidates: Object.freeze({ dir: 'candidates' }),
  loopRules: Object.freeze({ file: 'loop/rules.yml' }),
  loopVariant: Object.freeze({ dir: 'loop-variant' }),
  denied: Object.freeze([
    'approval',
    'sandbox',
    'permission',
    'credentials',
    'evolve-core',
    'evolve-observer',
    'evolve-agent',
    'evolve-tools',
    'evolve-commands',
    'evolve-workspace',
    'evolve-sandbox',
    'evolve-probe',
    'evolve-ui',
    'evolve-compat',
    'evolve-bundle',
    'evolve-loop',
    'guard/plugin',
    'guard/code',
    'loop/plugin',
    'loop/code',
    'host',
    'node_modules',
    '.git',
  ]),
})

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

/** Whether a path falls under one of the denied prefixes. */
export function isDenied(path: string, surface: SurfaceSpec = DEFAULT_SURFACE): boolean {
  return surface.denied.some(prefix => isUnder(path, prefix))
}

/**
 * Classify one normalized path against the surface.
 * @param path - a path already checked by {@link normalizeTreePath}.
 * @param surface - surface to apply.
 * @returns the path class; `unknown` and `denied` are never editable.
 */
export function classifyPath(path: string, surface: SurfaceSpec = DEFAULT_SURFACE): SurfaceKind {
  if (isDenied(path, surface)) return 'denied'
  if (path === surface.memory.file) return 'memory'
  if (path === surface.guardRules.file) return 'guard-rule'
  if (path === surface.loopRules.file) return 'loop-rule'
  if (surface.alwaysOn.files.includes(path)) return 'always-on'

  const skillPrefix = `${surface.skills.dir}/`
  if (path.startsWith(skillPrefix)) {
    const rest = path.slice(skillPrefix.length)
    const segments = rest.split('/')
    if (segments.length === 2 && segments[1] === 'SKILL.md' && segments[0] !== undefined) return 'skill'
  }

  if (surface.l2.subagents && path.startsWith('subagents/') && path.endsWith('.yml')) {
    const name = path.slice('subagents/'.length, -'.yml'.length)
    if (name.length > 0 && !name.includes('/')) return 'l2-subagent'
  }
  if (surface.l2.presets && path.startsWith('presets/') && path.endsWith('.yml')) {
    const name = path.slice('presets/'.length, -'.yml'.length)
    if (name.length > 0 && !name.includes('/')) return 'l2-preset'
  }
  if (surface.l2.patchRows && path.startsWith('patch/') && path.endsWith('.yml')) {
    const name = path.slice('patch/'.length, -'.yml'.length)
    if (name.length > 0 && !name.includes('/')) return 'l2-patch'
  }

  if (path.startsWith(`${surface.candidates.dir}/`)) return 'candidate'
  if (path.startsWith(`${surface.loopVariant.dir}/`)) return 'loop-variant'

  return 'unknown'
}

/** Whether the surface allows writing this path at all. */
export function isSurfaceAllowed(path: string, surface: SurfaceSpec = DEFAULT_SURFACE): boolean {
  const kind = classifyPath(path, surface)
  return kind !== 'denied' && kind !== 'unknown'
}

/** Whether a revision may commit this path without a promotion/approval flow. */
export function isDirectEditable(kind: SurfaceKind): boolean {
  return kind === 'always-on'
    || kind === 'memory'
    || kind === 'guard-rule'
    || kind === 'skill'
    || kind === 'loop-rule'
}
