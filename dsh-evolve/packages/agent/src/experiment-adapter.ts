/** Real DSH model and restricted local-file rollout adapters for experiments. */
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import type { ExperimentModel, ExperimentRunner, Rollout, Usage } from '@dsh-evolve/core/lifecycle'
import { checkRequirements, digest, safeTaskPath, excludedTaskPath } from '@dsh-evolve/core/task-snapshot'
import { processingTokens } from '@dsh-evolve/core/lifecycle'
import { NATIVE_DISCLOSURE_VERSION, initialNativeDisclosure, installPromptComponents, installSkillComponents, unsupportedNativePaths } from '@dsh-evolve/core/native-components'

/** Heuristic context sizing only. Accounting still reserves full UTF-8 bytes. */
export function estimateContextTokens(text: string): number {
  let ascii = 0; let otherBytes = 0
  for (const character of text) {
    if (character.codePointAt(0)! < 128) ascii += 1
    else otherBytes += Buffer.byteLength(character)
  }
  return Math.ceil(ascii / 3) + otherBytes
}

/** Route defaults are deployment choices, not a claim about provider capability. */
export function outputAllowance(requested: number, inputTokens: number, route: { defaultMaxTokens?: number; context?: { contextWindow?: number } }): number {
  const available = route.context?.contextWindow === undefined ? requested : route.context.contextWindow - inputTokens
  const limit = Math.min(requested, route.defaultMaxTokens ?? requested, available)
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('model context cannot fit input plus output; reduce evidence or configure a larger context route')
  return limit
}

/** One-shot model calls use the configured route and actual provider usage. */
export function experimentModel(ctx: Context, provider: string, model: string): ExperimentModel {
  return {
    async outputLimit(prompt, requested, signal) {
      const route = await ctx.llm.resolveModelInfo(provider, model, signal)
      return outputAllowance(requested, estimateContextTokens(prompt) + 1024, route)
    },
    async complete({ prompt, maxTokens, signal, onProgress }) {
      let text = ''; let usage: Usage | undefined; let finish = 'missing'
      const progress: { firstActivityAt?: string; lastActivityAt?: string; textChars: number; reasoningChars: number } = { textChars: 0, reasoningChars: 0 }
      let failure: { code: string; message: string } | undefined
      for await (const chunk of ctx.llm.stream({ provider, model, maxTokens, temperature: 0,
        signal: AbortSignal.any([signal, AbortSignal.timeout(1_800_000)]), messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }] })) {
        signal.throwIfAborted()
        if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
          progress.firstActivityAt ??= new Date().toISOString(); progress.lastActivityAt = new Date().toISOString()
          if (chunk.type === 'text-delta') progress.textChars += chunk.text.length
          else progress.reasoningChars += chunk.text.length
          onProgress?.({ ...progress })
        }
        if (chunk.type === 'text-delta') text += chunk.text
        else if (chunk.type === 'usage') usage = chunk.usage
        else if (chunk.type === 'finish') {
          finish = chunk.reason.kind
          if (chunk.reason.kind === 'aborted' || chunk.reason.kind === 'error') failure = chunk.reason.failure
        }
      }
      return { text, finishReason: finish, ...(usage ? { usage } : {}), ...(failure ? { failure } : {}),
        ...(finish !== 'stop' ? { error: `improver finish: ${finish}; output ceiling ${maxTokens}${failure ? `; ${failure.code}: ${failure.message}` : ''}` } : {}) }
    },
  }
}

const OUTPUT = { schema: { type: 'string' as const }, render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }] }
const TOOL_NAMES = new Set(['probe_read', 'probe_write', 'probe_list', 'skill'])
const PROBE_PRESET = 'evolve-probe-internal'

/** Hide one probe session from the workspace list; storage remains auditable. */
export async function archiveProbeSession(ctx: Context, id: unknown): Promise<void> {
  try {
    const registry = (ctx as unknown as { get?: (name: string) => unknown }).get?.call(ctx, 'workspaceRegistry') as
      { archiveSession?(id: unknown, options?: { stopActivity?: boolean }): Promise<void> } | undefined
    await registry?.archiveSession?.(id, { stopActivity: true })
  } catch (error) { ctx.logger?.warn?.('evolve: could not archive probe session: %o', error) }
}

/** Archive probe sessions left by earlier plugin runs (best effort, host only). */
export async function archiveExistingProbeSessions(ctx: Context): Promise<void> {
  try {
    const persistence = (ctx as unknown as { get?: (name: string) => unknown }).get?.call(ctx, 'sessionPersistence') as
      { list?(): Promise<readonly { header?: { id?: unknown; agentPreset?: string } }[]> } | undefined
    const live = new Set(((ctx as unknown as { agents?: { list?(): { session: { id: unknown } }[] } }).agents?.list?.() ?? [])
      .map(agent => String(agent.session.id)))
    for (const stored of await persistence?.list?.() ?? []) {
      if (stored.header?.agentPreset === PROBE_PRESET && stored.header.id !== undefined && !live.has(String(stored.header.id))) {
        await archiveProbeSession(ctx, stored.header.id)
      }
    }
  } catch (error) { ctx.logger?.warn?.('evolve: could not scan probe sessions: %o', error) }
}

/** No shell, network, plugin loading, code execution or delegation capability. */
export function localFileRunner(ctx: Context, provider: string, model: string): ExperimentRunner {
  return {
    capabilities: { filesystem: 'isolated', tools: 'allowlist', network: 'model-only', recursiveEvolution: false,
      loaderVersion: NATIVE_DISCLOSURE_VERSION,
      toolDescriptions: [
        'probe_list: list isolated local regular files.',
        'probe_read: read UTF-8 files using relative paths inside the task snapshot.',
        'probe_write: write or append UTF-8 files; cannot execute them.',
        'skill: discover candidate skill names/descriptions in the native catalog and load a skill body on demand. Skill bodies are not present before loading.',
        'Harness prompt and memory files use native sections; task-context uses native context. Candidate skills use an isolated native registry.',
        'No shell, Python execution, file deletion or external network tools. Writing a validation script does not run it.',
      ] },
    async run(input) {
      const unsupported = unsupportedNativePaths(input.candidate.tree)
      if (unsupported.length) throw new Error(`unsupported native harness components: ${unsupported.join(', ')}`)
      const started = Date.now()
      const timeout = AbortSignal.timeout(input.timeoutMs)
      const signal = AbortSignal.any([input.signal, timeout])
      let steps = 0; let toolCalls = 0; let toolErrors = 0; let limited = false; let failure = ''; let ceiling: Rollout['limit']
      let answer = ''; const trace: string[] = []; const written = new Set<string>()
      const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
      const fallbackUsage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
      let messageUsage = false
      let truncated = false; let recoveries = 0; let writeQueue: Promise<unknown> = Promise.resolve()
      const outputLimit = input.maxOutputTokens ?? 1_000_000
      if (!Number.isSafeInteger(outputLimit) || outputLimit < 1) throw new Error('invalid probe output limit')
      const route = await ctx.llm.resolveModelInfo(provider, model, signal)
      let charged = 0; let pendingMaximum = 0; let unknownUsage = false
      const handle = await ctx.agents.create({
        sessionId: SessionId(`evolve-probe-${randomUUID()}`),
        meta: { cwd: input.directory, agentPreset: PROBE_PRESET },
        agentOptions: { provider, model, maxTokens: outputLimit }, signal,
        setup: async scope => {
          // Global end-capabilities are invisible; a guard also blocks scoped
          // tools injected by other plugins after this setup.
          scope.tools.restrict({ allow: [] })
          scope.tools.guard(call => TOOL_NAMES.has(call.name) ? undefined : 'experiment permits only local file and skill-loading tools')
          // An independent registry is essential even when this runner is
          // called inside a foreground host with project/global skills.
          const components = scope.isolate('skills')
          await components.plugin(SkillRegistry)
          installPromptComponents(components, () => input.candidate.tree)
          await installSkillComponents(components, input.candidate.tree)
          await components.plugin(ToolSkill, { catalogDescriptionMaxLength: 500 })
          const initialComponentTokens = estimateContextTokens(initialNativeDisclosure(input.candidate.tree))
          scope.on('tools/post-execute', async (exec, result, next) => {
            if (exec.name === 'skill') {
              toolCalls += 1
              if (result.isError) toolErrors += 1
              const args = exec.arguments as { name?: unknown }
              trace.push(`[SKILL_LOAD] ${String(args.name)} ${result.isError ? 'failed' : 'loaded'}`)
            }
            return next()
          })
          scope.on('agent/request', async ({ agent }, next) => {
            const config = await next()
            // The loop freezes requests after this hook. Size the history and
            // allow room for tool schemas/system framing before preparation.
            const inputTokens = estimateContextTokens(JSON.stringify(agent.session.deriveMessages()))
              + initialComponentTokens + 16_384
            return { ...config, maxTokens: outputAllowance(outputLimit, inputTokens, route) }
          })
          scope.tools.register(defineTool({
            name: 'probe_list', description: 'List regular files under the isolated task directory.',
            parameters: {}, output: OUTPUT,
            execute: async () => {
              toolCalls += 1; const paths: string[] = []
              const walk = async (dir: string, prefix = ''): Promise<void> => {
                for (const entry of await readdir(dir, { withFileTypes: true })) {
                  if (entry.name.startsWith('.') || excludedTaskPath(prefix + entry.name)) continue
                  if (paths.length >= 500) return
                  if (entry.isDirectory()) await walk(join(dir, entry.name), `${prefix}${entry.name}/`)
                  else if (entry.isFile()) paths.push(prefix + entry.name)
                }
              }
              await walk(input.directory); trace.push(`[LIST] ${paths.join(', ')}`); return paths.join('\n')
            },
          }))
          scope.tools.register(defineTool({
            name: 'probe_read', description: 'Read a local UTF-8 source or artifact. No outside paths or symlinks.',
            parameters: { path: { type: 'string', required: true }, offset: { type: 'integer' }, length: { type: 'integer' } }, output: OUTPUT,
            execute: async args => {
              toolCalls += 1
              try {
                const path = await safeTaskPath(input.directory, args.path)
                const info = await lstat(path)
                if (!info.isFile() || info.size > 5_000_000) throw new Error('file exceeds local tool limit')
                const text = await readFile(path, 'utf8')
                const offset = Math.max(0, args.offset ?? 0); const length = Math.min(128000, Math.max(1, args.length ?? 32000))
                trace.push(`[READ] ${args.path} sha256:${digest(text)} range:${offset}:${offset + length}`)
                return text.slice(offset, offset + length)
              } catch (error) { toolErrors += 1; throw error }
            },
          }))
          scope.tools.register(defineTool({
            name: 'probe_write', description: 'Write UTF-8 text. For large files write sections, then append=true with expectedBytes from the previous result. Appends reject stale offsets; never repeat an already accepted chunk. Cannot execute files.',
            parameters: { path: { type: 'string', required: true }, content: { type: 'string', required: true }, append: { type: 'boolean' }, expectedBytes: { type: 'integer' } }, output: OUTPUT,
            execute: async args => {
              toolCalls += 1
              const write = writeQueue.then(async () => {
                signal.throwIfAborted()
                if (written.size >= 100 && !written.has(args.path)) throw new Error('artifact limit')
                const path = await safeTaskPath(input.directory, args.path)
                let content = args.content
                if (args.append) {
                  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return undefined })
                  if (info && (!info.isFile() || info.size > 5_000_000)) throw new Error('artifact limit')
                  const previous = info ? await readFile(path, 'utf8') : ''
                  if (!Number.isSafeInteger(args.expectedBytes) || args.expectedBytes !== Buffer.byteLength(previous)) throw new Error('append expectedBytes mismatch; read the file before retrying')
                  content = previous + content
                }
                const bytes = Buffer.byteLength(content)
                if (bytes > 5_000_000) throw new Error('artifact limit')
                await mkdir(dirname(path), { recursive: true }); await writeFile(path, content, { mode: 0o600 })
                written.add(args.path); trace.push(`[WRITE] ${args.path} bytes:${bytes} sha256:${digest(content)}`)
                return `wrote ${args.path}; bytes=${bytes}`
              })
              writeQueue = write.catch(() => {})
              try { return await write } catch (error) { toolErrors += 1; throw error }
            },
          }))
          scope.on('agent/pre-step', async (_payload, next) => {
            if (signal.aborted || steps >= input.maxSteps) { limited = true; if (!signal.aborted) ceiling ??= 'steps'; failure ||= 'probe step limit reached'; return { kind: 'reject' } }
            steps += 1; return next()
          })
          scope.on('agent/assistant-stream', ({ frame }) => {
            if (frame.type !== 'chunk') return
            const chunk = frame.chunk
            if (chunk.type === 'text-delta') answer += chunk.text
            if (chunk.type === 'usage') {
              // Streaming usage is a fallback. The durable assistant/message
              // event below is authoritative and avoids double counting.
              for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) fallbackUsage[key] = (fallbackUsage[key] ?? 0) + (chunk.usage[key] ?? 0)
            }
            if (chunk.type === 'finish' && chunk.reason.kind === 'max-tokens') { truncated = true; trace.push('[OUTPUT_LIMIT] model output truncated; completion not established') }
          })
          scope.on('agent/error', ({ error }) => { failure = String(error) })
        },
      })
      const disposeBudget = ctx.on('llm/stream', (request, next) => {
        if (String(request.sessionId) !== String(handle.agent.session.id)) return next()
        signal.throwIfAborted()
        if (pendingMaximum) { charged += pendingMaximum; unknownUsage = true; pendingMaximum = 0 }
        const serialized = JSON.stringify({ messages: request.messages, tools: request.tools, toolHistory: request.toolHistory })
        const inputBound = Buffer.byteLength(serialized, 'utf8') + 1024
        const contextEstimate = estimateContextTokens(serialized) + 1024
        const effective = request.maxTokens ?? outputLimit
        if (effective > outputAllowance(outputLimit, contextEstimate, route)) throw new Error('assembled request exceeds route context allowance')
        trace.push(`[OUTPUT_ALLOWANCE] requested=${outputLimit} effective=${effective} inputBytes=${inputBound} estimatedContextTokens=${contextEstimate}`)
        const maximum = inputBound + effective
        if (charged + maximum > input.maxTokens) { limited = true; ceiling ??= 'processing-tokens'; throw new Error('probe processing-token budget exhausted before dispatch') }
        truncated = false; answer = ''
        pendingMaximum = maximum
        return next()
      })
      const disposeUsage = ctx.on('session/event', (session, event) => {
        if (String(session.id) !== String(handle.agent.session.id) || event.type !== 'assistant/message') return
        const reported = (event.data as { usage?: Usage } | undefined)?.usage
        if (reported === undefined) return
        messageUsage = true
        for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) usage[key] = (usage[key] ?? 0) + (reported[key] ?? 0)
        charged += processingTokens(reported)
        pendingMaximum = 0
      })
      const abort = () => handle.agent.cancel({ kind: 'user' })
      signal.addEventListener('abort', abort, { once: true })
      try {
        signal.throwIfAborted()
        handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text:
          `Complete this task using only the isolated local file tools. Inspect sources, produce the requested files, validate against requirements, and stop when finished. No external operations are possible. Use relative paths inside this snapshot; original task paths refer to its frozen copies. Write large files in sections using probe_write append with expectedBytes; read back and verify the final file before declaring completion.\n\n${input.task.prompt.replaceAll(input.task.cwd, input.directory)}` }] }))
        await handle.agent.whenIdle()
        while (truncated && !limited && !failure && !signal.aborted && recoveries < 8 && steps < input.maxSteps) {
          recoveries += 1
          trace.push(`[RECOVER_OUTPUT_LIMIT] ${recoveries}/8`)
          handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'The last response hit its output limit. Inspect files already written; do not assume a truncated call succeeded. Continue unfinished sections with small writes/appends and exact expectedBytes. Verify every requested deliverable, then finish explicitly. Do not repeat accepted chunks.' }] }))
          await handle.agent.whenIdle()
        }
        if (truncated) { limited = true; ceiling ??= 'output-tokens'; failure ||= 'model output limit reached after bounded recovery' }
        if (pendingMaximum) unknownUsage = true
        const artifacts: Record<string, string> = {}
        for (const path of written) artifacts[path] = await readFile(await safeTaskPath(input.directory, path), 'utf8')
        const checks = await checkRequirements(input.directory, input.task.requirements)
        const reportedUsage = messageUsage ? usage
          : Object.values(fallbackUsage).some(value => value > 0) ? fallbackUsage : undefined
        // A rollout without usage is charged its full reservation and cannot be costed. Say which of the three
        // causes applies instead of dropping it silently, so a host that never reports usage can be told apart
        // from a run that was interrupted mid-request.
        if (reportedUsage === undefined) trace.push('[USAGE_MISSING] no assistant/message usage and no streamed usage chunk was observed')
        else if (unknownUsage) trace.push(`[USAGE_PARTIAL] a request had no settled usage; reporting withheld (message=${messageUsage}, streamed=${Object.values(fallbackUsage).some(value => value > 0)})`)
        const result: Rollout = {
          loaderVersion: NATIVE_DISCLOSURE_VERSION,
          status: input.signal.aborted ? 'cancelled' : timeout.aborted ? 'timeout' : limited || failure ? 'failed' : 'completed',
          answer, artifacts, checks, trace: trace.join('\n'), steps, toolCalls, toolErrors,
          wallMs: Date.now() - started, ...(reportedUsage === undefined || unknownUsage ? {} : { usage: reportedUsage }),
          ...(failure ? { reason: failure } : {}), ...(ceiling ? { limit: ceiling } : {}),
        }
        return result
      } finally {
        disposeBudget(); disposeUsage(); signal.removeEventListener('abort', abort)
        const sessionId = handle.agent.session.id
        await handle.dispose()
        // Probe sessions are evidence, not user conversations. Their facts are
        // already copied into the rollout, so hide them from the workspace list.
        await archiveProbeSession(ctx, sessionId)
      }
    },
  }
}
