/** DSH integration for the persistent task/experiment lifecycle. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import type { Evolve } from '@dsh-evolve/core/plugin'
import type { ApplyOutcome } from '@dsh-evolve/core/applier'
import { createRevision } from '@dsh-evolve/core/revision'
import { contentHash } from '@dsh-evolve/core/tree'
import { Lifecycle, DEFAULT_EXPERIMENT_BUDGET, episodeSummary, lifecycleSummary, processingTokens, type EvolutionEpisode, type Requirement, type TaskRun, type TaskStatus } from '@dsh-evolve/core/lifecycle'
import { isContinuationText } from '@dsh-evolve/core'
import { POST_TASK_TOKEN_CEILING, POST_TASK_WALL_CEILING, POST_TASK_OUTPUT_TOKENS } from '@dsh-evolve/core/experiment-budget'
import { checkRequirements, digest } from '@dsh-evolve/core/task-snapshot'
import type { EvidenceSource } from '@dsh-evolve/observer'
import { dueRules, parseLoopRules, type LoopRule } from './loop-rules.js'
import { archiveExistingProbeSessions, experimentModel, localFileRunner } from './experiment-adapter.js'
import { AutomaticLifecycle } from './automatic-lifecycle.js'

export const name = 'evolve-agent'
export const inject = ['agents', 'llm', 'tools', 'evolve', 'evolveEvidence']
/** @deprecated Compatibility inputs only; these modes cannot execute experiments. */
export type LegacyProposer = 'heuristic' | 'script'
export interface Config {
  enabled: boolean
  /** Production experiments require llm; legacy modes return an explicit refusal. */
  proposer: 'llm' | LegacyProposer
  /** @deprecated No executable proposer scripts are loaded. */
  scriptFile?: string
  repeatFailureThreshold: number
  maxProposalTokens: number
  probeMaxOutputTokens: number
  postTaskMaxProcessingTokens: number
  postTaskMaxWallMs: number
  postTaskStrategyVariants?: number
  postTaskMaxDepth?: number
  postTaskMaxProbeRuns?: number
  probe: boolean
  /** @deprecated Model calls use the worker route timeout. */
  proposeTimeoutMs: number
  /** The plugin host owns the background worker by default. */
  worker: boolean
  automaticLifecycle: boolean
  automaticIdleMs: number
  /** Quiet time after the last user message before observation starts; each message restarts it. */
  automaticSettleMs: number
  /** Deadline for each observer attempt, including model-route resolution. Retries get a fresh deadline. */
  automaticTimeoutMs: number
  /** Completed calls per evidence unit, observer stage and input version, not a conversation-turn ceiling. */
  automaticMaxCalls: number
  /** Task-wide processing-token ceiling, including interrupted calls and previous input versions. */
  automaticMaxProcessingTokens: number
  automaticMaxOutputTokens: number
  /** Auto phase checkpoint after a delivery; manual keeps only the explicit action. */
  checkpoint: 'auto' | 'manual'
  checkpointIdleMs: number
  checkpointCooldownMs: number
  /** Require at least one continuation turn before auto-closing a phase. */
  checkpointMinTurns: number
  workerDirectory?: string
  workerProvider?: string
  workerModel?: string
}
export const DEFAULT_CONFIG: Config = { enabled: true, proposer: 'llm', repeatFailureThreshold: 3,
  probeMaxOutputTokens: POST_TASK_OUTPUT_TOKENS, postTaskMaxProcessingTokens: POST_TASK_TOKEN_CEILING, postTaskMaxWallMs: POST_TASK_WALL_CEILING,
  postTaskStrategyVariants: 2, postTaskMaxDepth: 3,
  maxProposalTokens: POST_TASK_OUTPUT_TOKENS, probe: true, proposeTimeoutMs: 60000, worker: true,
  automaticLifecycle: true, automaticIdleMs: 300, automaticSettleMs: 4000, automaticTimeoutMs: 600000, automaticMaxCalls: 6,
  automaticMaxProcessingTokens: 2000000, automaticMaxOutputTokens: 65536,
  checkpoint: 'auto', checkpointIdleMs: 90_000, checkpointCooldownMs: 600_000, checkpointMinTurns: 1 }
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true), proposer: z.union(['llm', 'heuristic', 'script'] as const).default('llm'),
  probeMaxOutputTokens: z.number().step(1).min(1).default(POST_TASK_OUTPUT_TOKENS),
  postTaskMaxProcessingTokens: z.number().step(1).min(1).default(POST_TASK_TOKEN_CEILING),
  postTaskMaxWallMs: z.number().step(1).min(1).default(POST_TASK_WALL_CEILING),
  postTaskStrategyVariants: z.number().step(1).min(1).default(2),
  postTaskMaxDepth: z.number().step(1).min(1).default(3),
  postTaskMaxProbeRuns: z.number().step(1).min(1),
  scriptFile: z.string(), repeatFailureThreshold: z.number().step(1).min(1).default(3),
  maxProposalTokens: z.number().step(1).min(1).default(POST_TASK_OUTPUT_TOKENS), probe: z.boolean().default(true),
  proposeTimeoutMs: z.number().step(1).min(1).default(60000), worker: z.boolean().default(true),
  automaticLifecycle: z.boolean().default(true), automaticIdleMs: z.number().step(1).min(0).default(300),
  automaticSettleMs: z.number().step(1).min(0).default(4000),
  automaticTimeoutMs: z.number().step(1).min(1).default(600000), automaticMaxCalls: z.number().step(1).min(1).default(6),
  automaticMaxProcessingTokens: z.number().step(1).min(1).default(2000000), automaticMaxOutputTokens: z.number().step(1).min(1).default(65536),
  checkpoint: z.union(['auto', 'manual'] as const).default('auto'), checkpointIdleMs: z.number().step(1).min(0).default(90_000),
  checkpointCooldownMs: z.number().step(1).min(0).default(600_000), checkpointMinTurns: z.number().step(1).min(1).default(1),
  workerDirectory: z.string(), workerProvider: z.string(), workerModel: z.string(),
})
export interface ProposeOutcome { ok: boolean; reason: string; revisionId?: string; rationale?: string; episodeId?: string }
export interface EvolveAgentService {
  proposeNow(agent: Agent, trigger?: string): Promise<ProposeOutcome>
  reflect(agent: Agent): Promise<{ entries: number; episodeId?: string; status?: string; reason?: string }>
  state(agent: Agent): { task: string; taskType: string; step: number; shaped: boolean; taskId?: string; automation?: { status: string; detail?: string; taskId?: string } } | undefined
  task(agent: Agent, prompt?: string, requirements?: Requirement[]): Promise<TaskRun>
  finish(agent: Agent, status: Exclude<TaskStatus, 'active'>, evidence: string): Promise<EvolutionEpisode | undefined>
  jobs(agent: Agent): Promise<ReturnType<typeof episodeSummary>[]>
  work(agent: Agent, id?: string): Promise<EvolutionEpisode | undefined>
  retryObservation(agent: Agent): Promise<void>
  checkpoint(agent: Agent): Promise<{ ok: boolean; episodeId?: string; reason: string }>
  cancel(agent: Agent, id: string): Promise<void>
  resume(agent: Agent, id: string): Promise<void>
}
interface State {
  task: string; taskType: string; taskId?: string; step: number; shaped: boolean; edits: number; tokens: number;
  lastCheckpoint: number; lastProposalStep: number; signal?: AbortSignal; preparing?: Promise<TaskRun>; pending: string | undefined; rulesRevision?: string; rules: readonly LoopRule[]; fired: Set<string>; notifiedAdoptions: Set<string>; finalFinish?: string; lastUserText?: string; awaitingUser?: boolean;
  pendingCancellation?: Promise<void>;
}
function classify(task: string): string {
  if (/csv|tsv|表格|分隔符/i.test(task)) return 'csv-cleanup'
  if (/refactor|重构|rename/i.test(task)) return 'code-refactor'
  if (/documentation|openapi|petstore|文档|api specification/i.test(task)) return 'technical-writing'
  if (/summari[sz]|总结|摘要/i.test(task)) return 'doc-summarize'
  if (/bug|fix|修复/i.test(task)) return 'bug-hunt'
  return 'general'
}
function textOf(messages: readonly UserMessage[]): string {
  return messages.filter(m => m.source.kind === 'user').flatMap(m => m.content).map(b => b.type === 'text' ? b.text : '').join('\n').trim()
}

export function apply(ctx: Context, config: Partial<Config> = {}): void {
  const settings = { ...DEFAULT_CONFIG, ...config }
  const states = new WeakMap<Agent, State>()
  const stateOf = (agent: Agent): State => {
    let state = states.get(agent)
    if (!state) { state = { task: '', taskType: 'general', step: 0, shaped: false, edits: 0, tokens: 0, lastCheckpoint: -12, lastProposalStep: -1000, pending: undefined, rules: [], fired: new Set(), notifiedAdoptions: new Set() }; states.set(agent, state) }
    return state
  }
  const allowed = (agent: Agent) => settings.enabled && ctx.evolve.binding(agent)?.enabled === true && ctx.evolve.may('l1-apply')
  const life = (agent: Agent) => ctx.evolve.require(agent).lifecycle
  let wakeWorker = () => {}
  const notifyReview = (messages: UserMessage[], local: State, outcome: ApplyOutcome): void => {
    if (outcome.ok || outcome.reason !== 'confirmation-required' || !outcome.adoptionId || local.notifiedAdoptions.has(outcome.adoptionId)) return
    local.notifiedAdoptions.add(outcome.adoptionId)
    // Never expose the proposed instructions before the user adopts them.
    messages.push({ id: randomUUID() as UserMessage['id'], role: 'user',
      content: [{ type: 'text', text: `Evo prepared a session harness update (${outcome.adoptionId}). It is awaiting user confirmation in the Evo panel and has not been applied. Continue with the current harness.` }],
      source: { kind: 'evolve', form: 'notice', summary: 'harness update awaiting confirmation' } })
  }
  const proposalLimits = (postTask = false) => ({ maxProposalInputTokens: ctx.evolve.settings().maxProposalInputTokens,
    maxProposalOutputTokens: ctx.evolve.settings().maxProposalOutputTokens, modelMaxOutputTokens: postTask ? settings.maxProposalTokens : Math.min(settings.maxProposalTokens, 4096), probeMaxOutputTokens: postTask ? settings.probeMaxOutputTokens : Math.min(settings.probeMaxOutputTokens, 32768) })
  const postTaskLimits = () => ({ ...proposalLimits(true), maxProcessingTokens: settings.postTaskMaxProcessingTokens, maxWallMs: settings.postTaskMaxWallMs,
    ...(settings.postTaskStrategyVariants === undefined ? {} : { strategyVariants: settings.postTaskStrategyVariants }),
    ...(settings.postTaskMaxDepth === undefined ? {} : { maxDepth: settings.postTaskMaxDepth }),
    ...(settings.postTaskMaxProbeRuns === undefined ? {} : { maxProbeRuns: settings.postTaskMaxProbeRuns }) })
  const ensureTask = async (agent: Agent, prompt?: string, requirements?: Requirement[]): Promise<TaskRun> => {
    const local = stateOf(agent); const lifecycle = life(agent)
    // A new turn can start while the prior abort is still writing its terminal state.
    // Observation and task creation must both wait, so the old cancellation cannot close new work.
    await local.pendingCancellation
    if (local.taskId) {
      const previous = (await lifecycle.read()).tasks[local.taskId]
      if (prompt && previous && !['active', 'awaiting-input'].includes(previous.status)) {
        // A checkpoint closes a phase, not the session workstream. Keep the
        // active revision/overlay so the next phase continues from it.
        if (previous.completionKind !== 'checkpoint') await ctx.evolve.clearForTask(agent)
        delete local.taskId; local.shaped = false; local.edits = 0; local.tokens = 0; local.pending = undefined; local.lastProposalStep = -1000; local.notifiedAdoptions.clear()
      }
    }
    if (local.taskId) {
      if (requirements) await lifecycle.requirements(local.taskId, requirements)
      return (await lifecycle.read()).tasks[local.taskId]!
    }
    const resumed = Object.values((await lifecycle.read()).tasks).find(t => t.sessionId === String(agent.session.id) && ['active', 'awaiting-input'].includes(t.status))
    const task = resumed ?? await lifecycle.start({
      sessionId: String(agent.session.id), prompt: prompt ?? local.task, taskType: classify(prompt ?? local.task),
      cwd: agent.session.header.cwd ?? process.cwd(), initialTree: ctx.evolve.current(agent)?.tree ?? {},
      activeRevision: ctx.evolve.current(agent)?.id ?? null, ...(requirements ? { requirements } : {}),
      ...(agent.options.provider ? { provider: agent.options.provider } : {}), ...(agent.options.model ? { model: agent.options.model } : {}),
      capture: prompt !== undefined,
    })
    local.task = task.prompt; local.taskType = task.taskType; local.taskId = task.id
    return task
  }
  const checkpoint = async (agent: Agent): Promise<void> => {
    const local = stateOf(agent)
    if (!local.taskId) return
    const task = (await life(agent).read()).tasks[local.taskId]!
    const checks = await checkRequirements(task.cwd, task.requirements)
    const signals = ctx.evolveEvidence.signals(agent)
    const snapshot = await life(agent).checkpoint(task.id, { step: local.step,
      toolCalls: signals.totalToolCalls, toolErrors: signals.totalToolErrors, edits: local.edits,
      processingTokens: local.tokens, artifactHash: digest(JSON.stringify(checks)), checks }, ctx.evolveEvidence.render(agent))
    local.lastCheckpoint = local.step
    if (snapshot.signals.length && !local.pending) local.pending = snapshot.signals.join(',')
  }
  const proposeNow = async (agent: Agent, trigger = 'manual'): Promise<ProposeOutcome> => {
    if (!allowed(agent)) return { ok: false, reason: 'disabled-by-policy' }
    const task = await ensureTask(agent)
    if (settings.proposer !== 'llm') return { ok: false, reason: `${settings.proposer} mode cannot claim a verified experiment; use explicit test adapters` }
    const local = stateOf(agent)
    const previous = Object.values((await life(agent).read()).episodes).filter(e => e.taskId === task.id && e.phase === 'during-task')
    if (previous.length >= ctx.evolve.settings().maxEvolutionsPerSession) return { ok: false, reason: 'task experiment count exhausted' }
    if (local.step - local.lastProposalStep < ctx.evolve.settings().cooldownSteps) return { ok: false, reason: 'cooldown' }
    const foregroundBudget = Math.min(DEFAULT_EXPERIMENT_BUDGET.maxProcessingTokens, Math.floor(local.tokens * ctx.evolve.settings().maxExtraTokenRatio))
    const spent = previous.flatMap(e => e.reservations).reduce((sum, r) => sum + r.charged, 0)
    if (foregroundBudget <= spent) return { ok: false, reason: 'no remaining foreground token allowance' }
    const episode = await life(agent).enqueue(task.id, 'during-task', trigger, {
      ...proposalLimits(),
      maxProcessingTokens: Math.max(1, foregroundBudget), probeTokens: Math.max(1, Math.floor(foregroundBudget / 5)),
    })
    local.lastProposalStep = local.step
    return { ok: true, reason: episode.status, episodeId: episode.id, rationale: episode.reason }
  }
  const reflect = async (agent: Agent) => {
    if (!allowed(agent)) return { entries: 0 }
    const task = await ensureTask(agent)
    await checkpoint(agent)
    const episode = await life(agent).enqueue(task.id, 'post-task', 'manual reflection', postTaskLimits())
    return { entries: 0, episodeId: episode.id, status: episode.status, reason: `${episode.reason}. One post-task experiment per task; repeated reflect/probe returns the existing experiment. Use resume for an interrupted experiment, or start a new task for another comparison.` }
  }
  const applySelected = async (agent: Agent, job: EvolutionEpisode): Promise<ApplyOutcome | undefined> => {
    if (!allowed(agent) || job.status !== 'selected') return
    const snapshot = await life(agent).read()
    const taskId = stateOf(agent).taskId
    const current = taskId ? snapshot.tasks[taskId] : undefined
    const samePhase = current?.id === job.taskId
    const continuation = job.checkpoint === true && current !== undefined && job.workstreamId !== undefined
      && current.workstreamId === job.workstreamId && current.startedAt > job.createdAt
      && snapshot.workstreams?.[job.workstreamId]?.goalHash === job.goalHash
      && ['active', 'awaiting-input'].includes(current.status)
    if (!samePhase && !continuation) return
    const winner = job.candidates.find(candidate => candidate.id === job.comparison?.winner)
    if (!winner || ctx.evolve.current(agent)?.contentHash === contentHash(winner.tree)) return
    const revision = createRevision({ parent: ctx.evolve.current(agent)?.id ?? null, tree: winner.tree,
      evidence: [{ kind: 'experiment', episodeId: job.id, candidateId: winner.id, snapshotId: job.snapshotId, contentHash: contentHash(winner.tree) }],
      origin: winner.kind === 'compose' ? { kind: 'probe-composed', probeIds: [job.id] } : { kind: 'incremental', trigger: job.trigger },
      createdAt: new Date().toISOString(), level: 'L1', cacheImpact: 'low' })
    return ctx.evolve.apply(agent, revision)
  }
  const work = async (agent: Agent, id?: string): Promise<EvolutionEpisode | undefined> => {
    if (!allowed(agent)) throw new Error('evolution disabled by policy')
    if (!settings.probe || settings.proposer !== 'llm') throw new Error('real experiments require llm proposer and restricted probes')
    const lifecycle = life(agent); const snapshot = await lifecycle.read()
    const episode = id ? snapshot.episodes[id] : Object.values(snapshot.episodes).find(e => e.status === 'queued')
    if (!episode) return undefined
    const task = snapshot.tasks[episode.taskId]!
    const provider = task.provider ?? agent.options.provider; const model = task.model ?? agent.options.model
    if (!provider || !model) throw new Error('worker needs a configured provider and model')
    const result = await lifecycle.run(episode.id, experimentModel(ctx, provider, model), localFileRunner(ctx, provider, model))
    if (agent.status === 'idle') await applySelected(agent, result)
    await (ctx.evolve as Evolve & { suggestPromotions?(agent: Agent): Promise<unknown> }).suggestPromotions?.(agent)
    return result
  }
  const automatic = new AutomaticLifecycle(ctx, {
    enabled: settings.automaticLifecycle && settings.proposer === 'llm', idleMs: settings.automaticIdleMs, settleMs: settings.automaticSettleMs,
    timeoutMs: settings.automaticTimeoutMs, maxCalls: settings.automaticMaxCalls,
    maxProcessingTokens: settings.automaticMaxProcessingTokens, maxOutputTokens: settings.automaticMaxOutputTokens,
    experimentBudget: postTaskLimits(), checkpoint: settings.checkpoint, checkpointIdleMs: settings.checkpointIdleMs,
    checkpointCooldownMs: settings.checkpointCooldownMs, checkpointMinTurns: settings.checkpointMinTurns,
  }, { allowed, task: ensureTask, completedTurn: agent => !stateOf(agent).awaitingUser && stateOf(agent).finalFinish === 'stop' && !stateOf(agent).signal?.aborted, wakeWorker: () => wakeWorker() })
  ctx.effect(() => () => automatic.dispose())
  // Older probe sessions may still be visible in the workspace list. Archive
  // them without deleting their audit trail; new probes archive themselves.
  void archiveExistingProbeSessions(ctx)
  const service: EvolveAgentService = {
    proposeNow, reflect,
    state(agent) { const s = states.get(agent); return s ? { task: s.task, taskType: s.taskType, step: s.step, shaped: s.shaped, ...(s.taskId ? { taskId: s.taskId } : {}), automation: automatic.summary(agent) } : undefined },
    task: ensureTask,
    async finish(agent, status, evidence) {
      if (status === 'awaiting-input') stateOf(agent).awaitingUser = true
      if (status === 'cancelled') automatic.cancel(agent, 'Task explicitly cancelled.', stateOf(agent).taskId)
      const task = await ensureTask(agent); await checkpoint(agent)
      const job = await life(agent).finish(task.id, status, evidence, allowed(agent), postTaskLimits())
      wakeWorker(); return job
    },
    async jobs(agent) {
      const snapshot = await life(agent).read()
      return lifecycleSummary(snapshot).experiments
    },
    work, retryObservation: agent => automatic.retry(agent), checkpoint: agent => automatic.checkpoint(agent, 'manual'),
    cancel: (agent, id) => life(agent).cancel(id), resume: async (agent, id) => { await life(agent).resume(id); wakeWorker() },
  }
  ctx.provide('evolveAgent', service)

  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    if (message.source.kind === 'user' && allowed(agent)) {
      const local = stateOf(agent); const incoming = textOf([message])
      // Re-delivery of unchanged input must not cancel an otherwise valid observation.
      automatic.changed(agent, Boolean(incoming && incoming !== local.lastUserText && !local.task.endsWith(incoming)))
      delete local.finalFinish; delete local.awaitingUser
    }
  })
  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle' || !allowed(agent)) return
    automatic.schedule(agent, true)
    automatic.scheduleCheckpoint(agent)
  })
  ctx.on('agent/disposed', ({ agent }) => automatic.cancel(agent, 'Agent disposed.', undefined, false))

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (!allowed(payload.agent) || decision.kind !== 'enter') return decision
    const agent = payload.agent; const local = stateOf(agent); local.step = payload.step
    try {
      await local.pendingCancellation
      payload.signal.throwIfAborted()
      if (!(await life(agent).read()).enabled) { await ctx.evolve.setEnabled(agent, false); return decision }
      const incoming = textOf(payload.messages)
      let previous = local.taskId ? (await life(agent).read()).tasks[local.taskId] : undefined
      if (incoming && previous && ['active', 'awaiting-input'].includes(previous.status) && isContinuationText(incoming)) {
        await automatic.checkpoint(agent, 'user-continue').catch(error => ctx.logger.warn('evolve continuation checkpoint: %o', error))
        previous = (await life(agent).read()).tasks[previous.id] ?? previous
      }
      if (incoming && previous && ['active', 'awaiting-input'].includes(previous.status) && local.lastUserText !== incoming && !previous.prompt.endsWith(incoming)) {
        // Inbox insertion precedes consuming the message. An observer may have
        // started between those events; invalidate again at the actual version change.
        automatic.changed(agent)
        const updated = await life(agent).updateTaskPrompt(previous.id, incoming)
        local.task = updated.prompt
        automatic.changed(agent)
      }
      if (incoming) local.lastUserText = incoming
      if (local.preparing || !local.taskId || incoming && previous && !['active', 'awaiting-input'].includes(previous.status)) {
        const prompt = incoming || local.task
        if (prompt || local.preparing) {
          local.preparing ??= ensureTask(agent, prompt)
          let timer: ReturnType<typeof setTimeout> | undefined
          const task = await Promise.race([local.preparing, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 500) })]).finally(() => { if (timer) clearTimeout(timer) })
          if (!task) return decision
          delete local.preparing
          // A late observation of the cancelled prior task must not suppress the replacement.
          automatic.changed(agent)
          automatic.schedule(agent, false)
        }
      }
      if (local.taskId && local.signal !== payload.signal) {
        local.signal = payload.signal
        const taskId = local.taskId
        payload.signal.addEventListener('abort', () => {
          if (local.signal !== payload.signal) return
          automatic.cancel(agent, 'Foreground task cancelled.', taskId)
          const cancellation: Promise<void> = (local.pendingCancellation ?? Promise.resolve()).then(async () => {
            const task = (await life(agent).read()).tasks[taskId]
            if (task && ['active', 'awaiting-input'].includes(task.status)) await life(agent).finish(taskId, 'cancelled', 'host task signal aborted', false)
          }).catch(error => ctx.logger.warn('evolve cancellation: %o', error)).finally(() => {
            if (local.pendingCancellation === cancellation) delete local.pendingCancellation
          })
          local.pendingCancellation = cancellation
        }, { once: true })
      }
      if (incoming) automatic.schedule(agent, false)
      if (!local.shaped && local.taskId) {
        local.shaped = true
        // No unvalidated legacy lesson or task-specific answer is copied.
        const experience = Object.values((await life(agent).read()).experiences).find(e => e.taskType === local.taskType && e.state === 'transfer-supported' && e.applicability.toLowerCase().split(/[^\p{L}\p{N}]+/u).some(term => term.length >= 4 && local.task.toLowerCase().includes(term)))
        if (experience && Object.keys(experience.tree).length) {
          const base = ctx.evolve.current(agent)
          const revision = createRevision({ parent: base?.id ?? null, tree: experience.tree,
            evidence: [{ kind: 'experience', experienceId: experience.id, episodeIds: experience.episodes }],
            origin: { kind: 'task-shaping', taskType: local.taskType, libraryEntry: experience.id }, createdAt: new Date().toISOString(), level: 'L1', cacheImpact: 'low' })
          notifyReview(decision.messages, local, await ctx.evolve.apply(agent, revision))
        }
      }
      if (local.taskId && local.step - local.lastCheckpoint >= 12) await checkpoint(agent)
      if (local.pending) { const trigger = local.pending; local.pending = undefined; await proposeNow(agent, trigger) }
      if (local.taskId) {
        const snapshot = await life(agent).read()
        const task = snapshot.tasks[local.taskId]!
        const job = Object.values(snapshot.episodes).find(e => e.taskId === local.taskId && e.status === 'selected' && e.expectedGeneration === task.generation && e.expectedParent === (ctx.evolve.current(agent)?.id ?? null))
        if (job) {
          const applied = await applySelected(agent, job)
          if (applied) notifyReview(decision.messages, local, applied)
        }
      }
      const revision = ctx.evolve.current(agent)
      if (revision?.id !== local.rulesRevision) {
        if (revision) local.rulesRevision = revision.id
        else delete local.rulesRevision
        local.rules = revision ? parseLoopRules(revision.tree['loop/rules.yml'] ?? '') : []
        local.fired.clear()
      }
      for (const rule of dueRules(local.rules, ctx.evolveEvidence.signals(agent), local.fired).slice(0, 3)) {
        local.fired.add(rule.id)
        decision.messages.push({ id: randomUUID() as UserMessage['id'], role: 'user', content: [{ type: 'text', text: `[evolve:loop] ${rule.text}` }], source: { kind: 'evolve', form: 'notice', summary: rule.id } })
      }
    } catch (error) { ctx.logger.warn('evolve checkpoint: %o', error) }
    return decision
  })
  ctx.on('tools/result', (exec) => {
    if (!exec.agent || !allowed(exec.agent) || exec.name.startsWith('evolve_')) return
    const local = stateOf(exec.agent)
    if (/edit|write/.test(exec.name)) local.edits += 1
    const signals = ctx.evolveEvidence.signals(exec.agent)
    if (signals.repeatToolError >= settings.repeatFailureThreshold) local.pending = 'repeat-failure'
    else if (signals.repeatToolCall >= 5) local.pending = 'repeat-call'
  })
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (frame.type === 'chunk' && frame.chunk.type === 'usage' && allowed(agent)) stateOf(agent).tokens += processingTokens(frame.chunk.usage)
    if (frame.type === 'chunk' && frame.chunk.type === 'finish' && allowed(agent)) stateOf(agent).finalFinish = frame.chunk.reason.kind
  })
  ctx.on('agent/turn-stopping', async ({ agent }) => {
    if (allowed(agent)) await checkpoint(agent).catch(error => ctx.logger.warn('evolve checkpoint: %o', error))
  })

  // The host owns this background worker; ordinary chat needs no work command.
  if (settings.worker && settings.probe && settings.proposer === 'llm') {
    let busy = false
    let active: Promise<void> | undefined
    const stop = new AbortController()
    const tick = async () => {
      if (busy || stop.signal.aborted) return
      busy = true
      try {
        for (const { agent } of ctx.evolve.liveBindings()) if (!allowed(agent)) automatic.cancel(agent, 'Evo is disabled.', undefined, false)
        const lifecycles = new Map(ctx.evolve.liveBindings().map(({ binding }) => [binding.dir, binding.lifecycle]))
        if (settings.workerDirectory) lifecycles.set(settings.workerDirectory, new Lifecycle(settings.workerDirectory))
        for (const lifecycle of lifecycles.values()) {
          const snapshot = await lifecycle.read()
          if (!snapshot.enabled || snapshot.autonomy === 'off') continue
          const job = Object.values(snapshot.episodes).find(e => e.status === 'queued' || e.status === 'running'
            || e.attempts < 2 && e.status === 'cancelled' && e.reason.includes('evolve host stopped'))
          // An expired running lease is audited by run(); unknown external calls stay pending.
          // Only a known orderly host shutdown is retried automatically, once, without refunds.
          if (job?.status === 'cancelled') await lifecycle.resume(job.id)
          if (!job) continue
          const task = snapshot.tasks[job.taskId]!
          const provider = settings.workerProvider ?? task.provider; const model = settings.workerModel ?? task.model
          if (!provider || !model) continue
          const owner = ctx.evolve.liveBindings().find(({ agent }) => String(agent.session.id) === task.sessionId)?.agent
          if (owner && (!stateOf(owner).taskId || stateOf(owner).taskId === task.id)) automatic.report(owner, 'running', 'The background worker is independently executing harness candidates.', job.taskId)
          const result = await lifecycle.run(job.id, experimentModel(ctx, provider, model), localFileRunner(ctx, provider, model), { signal: stop.signal })
          if (owner) {
            const local = stateOf(owner)
            const latest = Object.values(snapshot.tasks).filter(value => value.sessionId === task.sessionId).sort((left, right) => left.startedAt.localeCompare(right.startedAt)).at(-1)
            if (!local.taskId && latest?.id === task.id) { local.taskId = task.id; local.task = task.prompt; local.taskType = task.taskType }
            if (local.taskId === task.id) automatic.report(owner, result.status, result.reason, job.taskId)
            if (owner.status === 'idle') await applySelected(owner, result)
            await (ctx.evolve as Evolve & { suggestPromotions?(agent: Agent): Promise<unknown> }).suggestPromotions?.(owner)
          }
        }
      } catch (error) { ctx.logger.warn('evolve worker: %o', error) }
      finally { busy = false }
    }
    wakeWorker = () => { if (!active) active = tick().finally(() => { active = undefined }) }
    const timer = setInterval(wakeWorker, 1000); timer.unref()
    ctx.effect(() => async () => { stop.abort(new Error('evolve host stopped')); clearInterval(timer); wakeWorker = () => {}; await active })
  }
}

declare module '@deepseek-ai/dsh-llm' { interface MessageSourceMap { evolve: { kind: 'evolve'; form: 'notice'; summary: string } } }
declare module '@deepseek-ai/cordis' { interface Context { evolve: Evolve; evolveEvidence: EvidenceSource; evolveAgent: EvolveAgentService } }
export default { name, inject, apply }
