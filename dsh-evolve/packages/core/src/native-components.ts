/** Native DSH disclosure shared by adopted revisions and isolated probes. */
import type { Context } from '@deepseek-ai/cordis'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { HarnessTree } from './tree.js'
import { classifyPath } from './surface.js'
import { parseFrontmatter } from './validator.js'

export interface NativeComponentFiber { dispose(): Promise<void> }
/** Persisted with execution evidence; changing disclosure requires a new version. */
export const NATIVE_DISCLOSURE_VERSION = 'dsh-native-components-v1'
const PROMPT_SECTIONS = [
  ['evolve:system', 900, 'prompt/system.md'],
  ['evolve:tool-guidance', 901, 'prompt/tool-guidance.md'],
  ['evolve:guardrails', 902, 'prompt/guardrails.md'],
  ['evolve:memory', 903, 'memory/MEMORY.md'],
] as const

/** Components that this loader cannot execute must never be silently validated. */
export function unsupportedNativePaths(tree: HarnessTree): string[] {
  const paths = new Set<string>([...PROMPT_SECTIONS.map(([, , path]) => path), 'prompt/task-context.md'])
  return Object.keys(tree).filter(path => !paths.has(path) && classifyPath(path) !== 'skill').sort()
}

/** Text available before skill loading, for conservative request sizing only. */
export function initialNativeDisclosure(tree: HarnessTree): string {
  return [
    ...PROMPT_SECTIONS.map(([, , path]) => tree[path] ?? ''),
    tree['prompt/task-context.md'] ?? '',
    ...skillRegistrations(tree).filter(skill => skill.invocation?.modelInvocable !== false)
      .map(skill => `${skill.name}: ${skill.description}`),
  ].join('\n')
}

/** Live getters preserve prompt refresh; task context stays outside the system prompt. */
export function installPromptComponents(ctx: Context, getTree: () => HarnessTree, namespace = 'evolve'): () => void {
  const disposers = [
    ...PROMPT_SECTIONS.map(([name, order, path]) => ctx.systemPrompt.section({
      name: `${namespace}:${name.slice('evolve:'.length)}`, order, interpolate: false,
      text: () => getTree()[path] ?? '',
    })),
    ctx.systemPrompt.context({ name: `${namespace}:task-context`, order: 910, interpolate: false,
      text: () => getTree()['prompt/task-context.md'] ?? '' }),
  ]
  return () => { for (const dispose of disposers.splice(0)) dispose() }
}

/** Register summaries and bodies with DSH; only its skill loader discloses bodies. */
export async function installSkillComponents(ctx: Context, tree: HarnessTree): Promise<NativeComponentFiber | undefined> {
  const registrations = skillRegistrations(tree)
  if (registrations.length === 0) return undefined
  // `skills` is not injected by the Agent factory. The fiber borrows the
  // caller's registry (which probes isolate) and owns its scoped registrations.
  return await ctx.plugin({
    name: 'evolve-skills', inject: ['skills'],
    apply(scope: Context) { for (const registration of registrations) scope.skills.register(registration) },
  }) as unknown as NativeComponentFiber
}

function skillRegistrations(tree: HarnessTree): SkillRegistration[] {
  const registrations: SkillRegistration[] = []
  for (const [path, text] of Object.entries(tree)) {
    if (classifyPath(path) !== 'skill') continue
    const fields = parseFrontmatter(text)
    if (!fields?.name || !fields.description) throw new Error(`invalid skill frontmatter: ${path}`)
    const invocationFlag = (field: string, fallback: boolean): boolean => {
      const value = fields[field]
      if (value === undefined) return fallback
      if (value !== 'true' && value !== 'false') throw new Error(`invalid skill ${field}: ${path}`)
      return value === 'true'
    }
    registrations.push({
      name: fields.name, description: fields.description, source: 'runtime',
      content: stripFrontmatter(text),
      ...(fields.whenToUse === undefined ? {} : { whenToUse: fields.whenToUse }),
      invocation: { modelInvocable: !invocationFlag('disable-model-invocation', false), userInvocable: invocationFlag('user-invocable', true) },
    })
  }
  return registrations
}

function stripFrontmatter(text: string): string {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return text
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === '---') return lines.slice(index + 1).join('\n').trim()
  }
  return text
}
