/**
 * Static validator (the DSH-independent portion of PRD §11.1).
 *
 * V1  surface whitelist / denied paths / traversal
 * V2  always-on character budget
 * V3  skill frontmatter and unique kebab-case names
 * V5  diff size budget
 * V7  secret and grader-word leakage
 * V8  no `{{variable}}` references in literal prompt text
 *
 * V4/V6/V9-V13 need the DSH rules DSL, a real prompt assembly, or runtime
 * probes; they live in the applier/evaluator packages.
 */
import { classifyPath, DEFAULT_SURFACE, type SurfaceSpec } from './surface.js'
import { charCount, diffTrees, normalizeTreePath, treeChars, type HarnessTree } from './tree.js'
import type { ValidationCheck, ValidationReport } from './types.js'

/** Limits enforced by the static validator. */
export interface ValidationLimits {
  readonly alwaysOnMaxChars: number
  readonly maxDiffChars: number
}

/** Deployment defaults from PRD §7.13. */
export const DEFAULT_LIMITS: ValidationLimits = Object.freeze({
  alwaysOnMaxChars: 24000,
  maxDiffChars: 4000,
})

/** Input to a static validation pass. */
export interface ValidationContext {
  readonly surface?: SurfaceSpec
  /** Parent tree; omitted means the empty tree. */
  readonly base?: HarnessTree
  readonly limits?: Partial<ValidationLimits>
  /** Disable the benchmark/grader word check (tests and internal docs only). */
  readonly allowGraderWords?: boolean
  /**
   * Check ids that are still evaluated and reported but do not make `ok` false.
   * Only budget-style checks (V5) may be advisory; the offline experiment uses this so a
   * large composed harness reaches the comparison instead of being dropped before it runs.
   * Safety and loadability checks (V1-V3, V7, V8) ignore this option.
   */
  readonly advisoryChecks?: readonly string[]
}

/** Checks that are budgets rather than safety or loadability, and so may be advisory. */
const ADVISORY_ELIGIBLE: ReadonlySet<string> = new Set(['V5'])

const SECRET_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'private key block', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  { name: 'sk- token', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  { name: 'credential assignment', pattern: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}/i },
  { name: 'environment key assignment', pattern: /\b[A-Z][A-Z0-9_]{2,}_(?:KEY|SECRET|TOKEN)\s*=\s*\S+/ },
  { name: 'dotenv line', pattern: /(?:^|\n)\s*[A-Z][A-Z0-9_]{2,}\s*=\s*["']?[^\s"']{8,}/ },
]

const GRADER_WORDS = /\b(?:benchmark|grader|rubric)\b/i
const VARIABLE_REF = /\{\{[A-Za-z_][A-Za-z0-9_.-]*\}\}/

/** Parse flat YAML frontmatter (`key: value` lines) from a skill file. */
export function parseFrontmatter(text: string): Record<string, string> | undefined {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return undefined
  const fields: Record<string, string> = {}
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] as string
    if (line.trim() === '---') return fields
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (match === null) continue
    const key = match[1] as string
    const raw = (match[2] as string).trim()
    fields[key] = raw.replace(/^['"]|['"]$/g, '')
  }
  return undefined
}

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Run the static checks over one candidate tree.
 * @param candidate - the tree to commit.
 * @param context - surface, base, and limits.
 * @returns every check outcome; `ok` is the conjunction.
 * @throws TreePathError when a path is malformed (the caller should reject
 * the proposal rather than treat it as a soft validation failure).
 */
export function validateTree(candidate: HarnessTree, context: ValidationContext = {}): ValidationReport {
  const surface = context.surface ?? DEFAULT_SURFACE
  const limits: ValidationLimits = { ...DEFAULT_LIMITS, ...context.limits }
  const base = context.base ?? {}
  const checks: ValidationCheck[] = []

  // V1 — every path must be surface-allowed.
  const badPaths: string[] = []
  for (const path of Object.keys(candidate)) {
    const normalized = normalizeTreePath(path)
    const kind = classifyPath(normalized, surface)
    if (kind === 'denied' || kind === 'unknown') badPaths.push(`${path} (${kind})`)
  }
  checks.push(badPaths.length === 0
    ? { id: 'V1', ok: true }
    : { id: 'V1', ok: false, detail: `paths outside the surface: ${badPaths.join(', ')}` })

  // V2 — always-on budget.
  const alwaysOnChars = treeChars(candidate, surface.alwaysOn.files)
  checks.push(alwaysOnChars <= limits.alwaysOnMaxChars
    ? { id: 'V2', ok: true, detail: `${alwaysOnChars}/${limits.alwaysOnMaxChars} chars` }
    : { id: 'V2', ok: false, detail: `always-on files use ${alwaysOnChars} chars, limit ${limits.alwaysOnMaxChars}` })

  // V3 — skills.
  const skillIssues: string[] = []
  const skillNames = new Set<string>()
  for (const [path, text] of Object.entries(candidate)) {
    if (classifyPath(path, surface) !== 'skill') continue
    const fields = parseFrontmatter(text)
    if (fields === undefined) {
      skillIssues.push(`${path}: missing frontmatter`)
      continue
    }
    for (const required of surface.skills.frontmatterRequired) {
      const value = fields[required]
      if (value === undefined || value.trim().length === 0) skillIssues.push(`${path}: missing "${required}"`)
    }
    const name = fields.name
    if (name !== undefined) {
      if (!SKILL_NAME.test(name)) skillIssues.push(`${path}: name "${name}" is not kebab-case`)
      if (skillNames.has(name)) skillIssues.push(`${path}: duplicate skill name "${name}"`)
      skillNames.add(name)
    }
  }
  checks.push(skillIssues.length === 0
    ? { id: 'V3', ok: true }
    : { id: 'V3', ok: false, detail: skillIssues.join('; ') })

  // V5 — diff size.
  const diff = diffTrees(base, candidate)
  checks.push(diff.diffChars <= limits.maxDiffChars
    ? { id: 'V5', ok: true, detail: `${diff.diffChars}/${limits.maxDiffChars} chars` }
    : { id: 'V5', ok: false, detail: `diff is ${diff.diffChars} chars, limit ${limits.maxDiffChars}` })

  // V7 — secrets and grader words.
  const leaks: string[] = []
  for (const [path, text] of Object.entries(candidate)) {
    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(text)) leaks.push(`${path}: ${name}`)
    }
    if (context.allowGraderWords !== true && GRADER_WORDS.test(text)) leaks.push(`${path}: grader word`)
  }
  checks.push(leaks.length === 0
    ? { id: 'V7', ok: true }
    : { id: 'V7', ok: false, detail: `possible leakage: ${leaks.join('; ')}` })

  // V8 — literal prompt text must not look like an interpolation reference.
  const variables: string[] = []
  for (const path of surface.alwaysOn.files) {
    const text = candidate[path]
    if (text !== undefined && VARIABLE_REF.test(text)) variables.push(path)
  }
  checks.push(variables.length === 0
    ? { id: 'V8', ok: true }
    : { id: 'V8', ok: false, detail: `literal prompt text contains {{variable}} references: ${variables.join(', ')}` })

  const advisory = new Set((context.advisoryChecks ?? []).filter(id => ADVISORY_ELIGIBLE.has(id)))
  const reported: ValidationCheck[] = checks.map(check => advisory.has(check.id) && !check.ok ? { ...check, advisory: true } : check)
  return Object.freeze({
    ok: reported.every(check => check.ok || check.advisory === true),
    checks: Object.freeze(reported),
  })
}

/** Count characters for one text, exposed for callers that size proposals. */
export { charCount }
