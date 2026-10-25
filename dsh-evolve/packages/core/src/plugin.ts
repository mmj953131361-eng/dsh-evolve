/**
 * `ctx.evolve`: the DSH-bound face of the core.
 *
 * On every `agent/created` it binds the agent to `<cwd>/.dsh-evolve`, loads the
 * current revision, registers function-valued prompt sections/context and
 * runtime skills on `agent.ctx`, and keeps a transactional overlay manager for
 * later revisions. Sections read the live tree, so swapping a revision needs no
 * re-registration.
 */
import { appendFile, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { dirname, join, isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { OverlayManager, type ApplyOutcome, type Overlay } from './applier.js'
import { FileLibraryStore } from './library.js'
import { decide, isAutonomous, SessionBudget, type Autonomy, type EvolutionAction } from './policy.js'
import { createRevision, type Revision } from './revision.js'
import { FileRevisionStore } from './revision-store.js'
import { asRevisionId, type RevisionId } from './ids.js'
import type { HarnessTree } from './tree.js'
import type { AgentSnapshot } from './snapshot.js'
import { buildEvolutionView } from './view.js'
import { Lifecycle, lifecycleSummary } from './lifecycle.js'
import { eligibleCandidate } from './selection.js'
import { withLock, JsonJournal, readJson } from './persistence.js'
import { adoptionChangeKinds, adoptionHeadline as compactAdoptionHeadline, adoptionId, adoptionSummary, taskStamp, type AdoptionPlan, type AdoptionState } from './adoption.js'
import type { LifecycleState } from './lifecycle-types.js'
import { installPromptComponents, installSkillComponents, unsupportedNativePaths, NATIVE_DISCLOSURE_VERSION } from './native-components.js'
import { contentHash } from './tree.js'
import { classifyPath } from './surface.js'
import { validateTree } from './validator.js'
import { scopeSupport, supportsScope, type ScopeSupport } from './scope-evidence.js'
import { previewScopedHarness, applyScopedHarness, rollbackScopedHarness, inspectScopedHarness, type ScopedHarnessTarget } from './scoped-harness.js'
import { parsePresetDefinitions, presetFingerprint } from './presets.js'

/** Core configuration. Every threshold is explicit and schema-validated. */
export interface Config {
  /** Master switch for new agents. */
  enabled: boolean
  /** Session changes default to quiet adoption; shared scopes always require review. */
  sessionAdoption?: 'auto' | 'review'
  /** Autonomy ladder. */
  autonomy: Autonomy
  /** Workspace directory name under the agent cwd. */
  workspaceDir: string
  /** Static validation limits. */
  alwaysOnMaxChars: number
  maxDiffChars: number
  /** Session budgets. */
  maxEvolutionsPerSession: number
  maxProposalInputTokens: number
  maxProposalOutputTokens: number
  maxExtraTokenRatio: number
  cooldownSteps: number
  /** Repeated-failure threshold. */
  repeatFailureThreshold: number
  /** @deprecated Legacy observation window; lifecycle validation uses reruns. */
  observeSteps: number
  /** Register workspace presets/subagents when the agent-preset registry exists. */
  l2: boolean
}

/** Runtime defaults from PRD §7.13. */
export const DEFAULT_CONFIG: Config = Object.freeze({
  enabled: true,
  sessionAdoption: 'auto',
  autonomy: 'ask-promote',
  workspaceDir: '.dsh-evolve',
  alwaysOnMaxChars: 24000,
  maxDiffChars: 4000,
  maxEvolutionsPerSession: 6,
  maxProposalInputTokens: 8000000,
  maxProposalOutputTokens: 8000000,
  maxExtraTokenRatio: 0.15,
  cooldownSteps: 3,
  repeatFailureThreshold: 3,
  observeSteps: 4,
  l2: true,
})

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  sessionAdoption: z.union(['auto', 'review'] as const).default('auto'),
  autonomy: z.union(['off', 'l1-only', 'ask-promote', 'auto-l2'] as const).default('ask-promote'),
  workspaceDir: z.string().min(1).default('.dsh-evolve'),
  alwaysOnMaxChars: z.number().step(1).min(1).default(24000),
  maxDiffChars: z.number().step(1).min(1).default(4000),
  maxEvolutionsPerSession: z.number().step(1).min(0).default(6),
  maxProposalInputTokens: z.number().step(1).min(0).default(8000000),
  maxProposalOutputTokens: z.number().step(1).min(0).default(8000000),
  maxExtraTokenRatio: z.number().min(0).default(0.15),
  cooldownSteps: z.number().step(1).min(0).default(3),
  repeatFailureThreshold: z.number().step(1).min(1).default(3),
  observeSteps: z.number().step(1).min(0).default(4),
  l2: z.boolean().default(true),
})

/** Per-agent binding state. */
export interface EvolveBinding {
  readonly dir: string
  readonly store: FileRevisionStore
  readonly library: FileLibraryStore
  /** @deprecated Legacy compatibility counter; lifecycle reservations are authoritative. */
  readonly budget: SessionBudget
  readonly lifecycle: Lifecycle
  readonly adoptionJournal: JsonJournal<AdoptionState>
  readonly sharedAdoptionJournal: JsonJournal<AdoptionState>
  readonly presetKeys: Set<string>
  enabled: boolean
  tree: HarnessTree
  revision: Revision | null
  version: number
  overlay: OverlayManager
  sectionDisposers: (() => void)[]
  skillFiber: { dispose(): Promise<void> } | undefined
}

/** The evolve service exposed as `ctx.evolve`. */
export const name = 'evolve-core'
export const inject = ['agents', 'systemPrompt', 'skills']

/** The evolve service exposed as `ctx.evolve`. */
export class Evolve {
  private readonly ctx: Context
  private readonly config: Config
  private readonly bindings = new WeakMap<Agent, EvolveBinding>()
  private readonly presetCache = new Map<string, { fingerprint: string; dispose: () => Promise<void> }>()
  private readonly live = new Map<string, { agent: Agent; binding: EvolveBinding }>()
  private stopped = false

  constructor(ctx: Context, config: Config) {
    this.ctx = ctx
    this.config = { ...DEFAULT_CONFIG, ...config }
    ctx.effect(() => async () => {
      this.stopped = true
      const bindings = [...this.live.values()].map(({ binding }) => binding)
      for (const binding of bindings) { binding.enabled = false; binding.version++; binding.tree = Object.freeze({}) }
      await Promise.allSettled(bindings.flatMap(binding => [
        Promise.resolve().then(() => this.disposeSections(binding)),
        this.disposeSkills(binding), this.disposePresets(binding),
      ]))
      this.live.clear()
    })
    ctx.on('agent/disposed', ({ agent }) => {
      const binding = this.bindings.get(agent)
      if (binding) void this.disposePresets(binding).catch(error => ctx.logger.warn('preset disposal: %o', error))
      this.live.delete(String(agent.id))
    })
    ctx.on('agent/created', async ({ agent }) => {
      if (agent.session.header.agentPreset === 'evolve-probe-internal') return
      try {
        await this.bind(agent)
      } catch (error: unknown) {
        // R23: never fail agent creation because the evolve overlay could not bind.
        ctx.logger.warn('evolve: failed to bind agent %s: %o', agent.id, error)
      }
    })
  }

  /** Live bindings, in creation order. */
  liveBindings(): readonly { agent: Agent; binding: EvolveBinding }[] {
    return [...this.live.values()]
  }

  /** Read-only snapshots for the Web panel and status surfaces. */
  async summarize(): Promise<readonly AgentSnapshot[]> {
    const sandbox = (() => {
      try { return (this.ctx as unknown as { get?: (name: string) => unknown }).get?.call(this.ctx, 'evolveSandbox') as
        { list(agent: Agent): Promise<readonly { id: string; name: string; status: string; report: { ok: boolean; findings: readonly { rule: string; detail: string }[] } }[]> } | undefined
      } catch { return undefined }
    })()
    const agentState = (() => {
      try { return (this.ctx as unknown as { get?: (name: string) => unknown }).get?.call(this.ctx, 'evolveAgent') as
        { state(agent: Agent): { task: string; taskType: string; step: number; automation?: { status: string; detail?: string; taskId?: string } } | undefined } | undefined
      } catch { return undefined }
    })()
    return await Promise.all(this.liveBindings().slice(-20).map(async ({ agent, binding }) => {
      const history = await binding.store.list()
      const library = await binding.library.all()
      const lifecycle = await binding.lifecycle.read()
      const sessionTasks = Object.fromEntries(Object.entries(lifecycle.tasks).filter(([, task]) => task.sessionId === String(agent.session.id)))
      const projection = lifecycleSummary({ ...lifecycle, tasks: sessionTasks,
        episodes: Object.fromEntries(Object.entries(lifecycle.episodes).filter(([, job]) => sessionTasks[job.taskId])) })
      const candidates = sandbox === undefined ? [] : await sandbox.list(agent)
      const state = agentState?.state(agent)
      const task = Object.values(sessionTasks).sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1)
      const workstream = task?.workstreamId ? lifecycle.workstreams?.[task.workstreamId] : undefined
      const workstreamTitle = workstream?.title ?? task?.title
      const snapshot: Omit<AgentSnapshot, 'view'> = {
        id: String(agent.id), sessionId: String(agent.session.id),
        workspace: binding.dir,
        ...(workstreamTitle ? { workstreamTitle } : {}),
        ...projection,
        adoptions: (await this.adoptions(agent)).map(adoptionSummary),
        enabled: binding.enabled,
        revision: binding.revision?.id ?? null,
        level: binding.revision?.level ?? null,
        cacheImpact: binding.revision?.cacheImpact ?? null,
        taskType: state?.taskType ?? 'general',
        task: state?.task.slice(0, 500) ?? '',
        step: state?.step ?? 0,
        ...(state?.automation ? { automation: state.automation } : {}),
        budget: await this.budgetSnapshot(agent),
        history: history.slice(-30).map(item => ({
          id: item.id,
          parent: item.parent,
          level: item.level,
          origin: item.origin.kind,
          createdAt: item.createdAt,
          current: item.id === binding.revision?.id,
        })),
        library: library.slice(-20).map(entry => ({
          id: entry.id,
          taskType: entry.taskType,
          cue: entry.cue.slice(0, 500),
          lesson: entry.lesson.slice(0, 1000),
          confidence: entry.confidence,
          uses: entry.uses,
          rollbacks: entry.rollbacks,
          lastUsedAt: entry.lastUsedAt,
        })),
        candidates: candidates.slice(-20).map(candidate => ({
          id: candidate.id,
          name: candidate.name,
          status: candidate.status,
          verified: candidate.status === 'approved' || candidate.status === 'promoted',
          findings: candidate.report.findings.map(finding => `${finding.rule}: ${finding.detail}`),
        })),
      }
      return { ...snapshot, view: buildEvolutionView(snapshot, { baseline: Object.keys(binding.tree).length === 0,
        ...(task ? { task } : {}), agentStatus: agent.status, completedLearningCount: Object.values(lifecycle.episodes)
          .filter(job => sessionTasks[job.taskId] && ['selected', 'kept-base'].includes(job.status)).length }) }
    }))
  }

  /** Actual experiment usage (including unknown reserved usage) shared by every UI. */
  async budgetSnapshot(agent: Agent): Promise<AgentSnapshot['budget']> {
    const binding = this.require(agent)
    const state = await binding.lifecycle.read()
    const taskIds = new Set(Object.values(state.tasks).filter(task => task.sessionId === String(agent.session.id)).map(task => task.id))
    const experimentCalls = Object.values(state.episodes).filter(job => taskIds.has(job.taskId)).flatMap(job => job.reservations)
    const observations = await readJson<{ schema: number; tasks: Record<string, { calls: { stage?: string; status?: string; charged: number; usage?: import('./lifecycle-types.js').Usage }[] }> }>(
      join(binding.dir, 'automation', `${agent.session.id}.json`), () => ({ schema: 1, tasks: {} }))
    if (observations.schema !== 1) throw new Error('unsupported automatic observation ledger schema')
    const reservations = [...experimentCalls, ...Object.values(observations.tasks).flatMap(task => task.calls)]
    const history = await binding.store.list()
    const stages = new Map<string, { charged: number; unknown: number }>()
    for (const reservation of reservations) {
      const stage = reservation.stage ?? 'observation'
      const entry = stages.get(stage) ?? { charged: 0, unknown: 0 }
      entry.charged += reservation.charged
      if (reservation.status === 'unknown') entry.unknown += reservation.charged
      stages.set(stage, entry)
    }
    const charged = (status: string) => reservations.filter(r => r.status === status).reduce((sum, r) => sum + r.charged, 0)
    const settledTokens = charged('settled')
    const unknownTokens = charged('unknown')
    return {
      evolutions: history.filter(r => ['incremental', 'probe-composed', 'task-shaping'].includes(r.origin.kind)).length,
      inputTokens: reservations.reduce((sum, r) => sum + (r.usage?.inputTokens ?? 0) + (r.usage?.cacheReadTokens ?? 0) + (r.usage?.cacheWriteTokens ?? 0), 0),
      outputTokens: reservations.reduce((sum, r) => sum + (r.usage?.outputTokens ?? 0), 0),
      extraTokens: reservations.reduce((sum, r) => sum + r.charged, 0),
      settledTokens,
      unknownTokens,
      stageTokens: [...stages.entries()].map(([stage, value]) => ({ stage, ...value })).sort((a, b) => b.charged - a.charged).slice(0, 20),
    }
  }

  /** Configuration snapshot (read-only). */
  settings(): Readonly<Config> {
    return this.config
  }

  /** Binding for one agent, or undefined before creation completes. */
  binding(agent: Agent): EvolveBinding | undefined {
    return this.bindings.get(agent)
  }

  /** Binding, throwing when the agent was never bound. */
  require(agent: Agent): EvolveBinding {
    const binding = this.bindings.get(agent)
    if (binding === undefined) throw new Error(`evolve: agent ${agent.id} is not bound`)
    return binding
  }

  /** Whether the action may run autonomously under the configured ladder. */
  may(action: EvolutionAction): boolean {
    return isAutonomous(action, this.config.autonomy)
  }

  /** Policy decision for one action. */
  decide(action: EvolutionAction) {
    return decide(action, this.config.autonomy)
  }

  /** Current revision, if any. */
  current(agent: Agent): Revision | null {
    return this.bindings.get(agent)?.revision ?? null
  }

  /** Stored revision summaries, oldest first. */
  async history(agent: Agent) {
    const binding = this.require(agent)
    return await binding.store.list()
  }

  /** Look up one stored revision. */
  async get(agent: Agent, id: RevisionId): Promise<Revision> {
    return await this.require(agent).store.load(asRevisionId(id))
  }

  /** Skills visible to this agent's scope (diagnostics and tests). */
  async visibleSkills(agent: Agent): Promise<{ skills: readonly { name: string }[]; complete: boolean }> {
    return await this.ctx.skills.snapshot({ scope: agent as unknown as never })
  }

  /**
   * Append one structured audit event to `<workspace>/audit/<session>.jsonl`.
   * Audit failures never affect the caller.
   */
  async audit(agent: Agent, event: Readonly<Record<string, unknown>>): Promise<void> {
    try {
      const binding = this.require(agent)
      const dir = join(binding.dir, 'audit')
      await mkdir(dir, { recursive: true })
      const line = JSON.stringify({ time: new Date().toISOString(), ...event })
      await appendFile(join(dir, `${agent.session.id}.jsonl`), `${line}\n`, 'utf8')
    } catch {
      // Auditing is best-effort; the revision store is authoritative.
    }
  }

  /** Enable or disable the overlay for one agent. */
  async setEnabled(agent: Agent, enabled: boolean): Promise<void> {
    const binding = this.require(agent)
    if (enabled && this.config.autonomy === 'off') throw new Error('autonomy off must be changed in configuration before enabling evolution')
    await binding.lifecycle.setEnabled(enabled)
    for (const { agent: liveAgent, binding: live } of this.liveBindings()) {
      if (live.dir !== binding.dir) continue
      live.enabled = enabled
      if (enabled) {
        this.installSections(liveAgent, live)
        await this.installSkills(liveAgent, live)
        await this.installPresets(liveAgent, live)
      } else {
        this.disposeSections(live)
        await this.disposeSkills(live)
        await this.disposePresets(live)
      }
    }
  }

  /** Verified session changes apply quietly by default; optional review mode stays available. */
  async apply(agent: Agent, revision: Revision): Promise<ApplyOutcome> {
    const binding = this.require(agent)
    return withLock(join(binding.dir, 'sessions', `${agent.session.id}.apply`), async () => {
      if (binding.revision?.id === revision.id && contentHash(binding.tree) === revision.contentHash) {
        return { ok: true, revision: binding.revision, warnings: [] }
      }
      return binding.lifecycle.journal.update(async state => {
        const failure = await this.checkAdoption(agent, binding, revision, state)
        if (failure) return failure
        const now = new Date().toISOString()
        const changedPaths = [...new Set([...Object.keys(binding.tree), ...Object.keys(revision.tree)])]
          .filter(path => binding.tree[path] !== revision.tree[path])
        const draft = {
          scope: 'session' as const, adoptionMode: this.config.sessionAdoption === 'review' ? 'review' as const : 'auto' as const,
          targetId: `session:${agent.session.id}`, targetLabel: '当前会话', expectedEffect: this.adoptionReason(revision, state),
          headline: this.adoptionHeadline(revision, state), changeKinds: adoptionChangeKinds(changedPaths), fileCount: changedPaths.length,
          affectedSessions: [String(agent.session.id)], affectedProjects: [], impactNote: '仅影响当前会话，可撤销。',
          targetSessionId: String(agent.session.id), contentHash: revision.contentHash,
          parent: revision.parent, revision, beforeTree: binding.tree, taskStamp: taskStamp(state, String(agent.session.id)),
          reason: this.adoptionReason(revision, state), createdAt: now, updatedAt: now,
          verification: this.adoptionVerification(revision, state),
          activation: 'next-request' as const,
          activationDetail: '当前任务后续请求会更新提示和技能目录；技能正文仍按需加载。新任务需重新验证适用性，已有对话历史不回写。',
          rollback: '可在进化状态中撤销本次改进。已载入对话历史的技能正文会保留。',
        }
        const id = adoptionId(draft)
        const plan = await binding.adoptionJournal.update(journal => {
          const existing = Object.values(journal.plans).find(item => item.scope === 'session' && item.parent === draft.parent
            && item.targetSessionId === draft.targetSessionId && item.contentHash === draft.contentHash && item.taskStamp === draft.taskStamp)
          if (existing) return existing
          return journal.plans[id] ??= { ...draft, id, status: 'pending' }
        })
        if (plan.status === 'pending' && this.config.sessionAdoption !== 'review') {
          const outcome = await this.commitSessionPlan(agent, binding, plan, state)
          await this.setAdoptionStatus(binding, plan.id, outcome.ok ? 'applied' : outcome.reason === 'stale' ? 'stale' : 'pending', outcome.ok ? undefined : outcome.detail)
          if (outcome.ok) await this.audit(agent, { event: 'adoption-automatic', adoption: plan.id, revision: plan.revision.id, contentHash: plan.contentHash, scope: 'session' })
          return outcome
        }
        return { ok: false, reason: plan.status === 'rejected' ? 'rejected' : plan.status === 'pending' ? 'confirmation-required' : 'stale',
          detail: plan.status === 'pending' ? 'Review and confirm this exact session harness before adoption.' : `adoption ${plan.status}`,
          adoptionId: plan.id } as ApplyOutcome
      })
    })
  }

  /** Pending reviews survive restarts; stale proposals remain visible with their reason. */
  async adoptions(agent: Agent): Promise<AdoptionPlan[]> {
    const binding = this.require(agent)
    return this.withAdoptionLock(agent, binding, async () => {
      await this.recoverSharedAdoptions(agent, binding)
      await this.recoverCommittedAdoption(binding)
      const state = await binding.lifecycle.read()
      const own = await binding.adoptionJournal.update(journal => {
        for (const plan of Object.values(journal.plans)) {
          if (plan.status !== 'pending' || plan.scope !== 'session') continue
          if (binding.revision?.id === plan.revision.id && binding.revision.contentHash === plan.contentHash) {
            plan.status = 'applied'; plan.updatedAt = new Date().toISOString()
          } else if (plan.parent !== (binding.revision?.id ?? null) || plan.taskStamp !== taskStamp(state, plan.targetSessionId)) {
            plan.status = 'stale'; plan.detail = 'Task or parent revision changed while awaiting review.'
            plan.updatedAt = new Date().toISOString()
          }
        }
        return Object.values(journal.plans).map(plan => ({ ...plan, canUndo: plan.status === 'applied' && (plan.scope === 'session' ? binding.revision?.id === plan.revision.id : !!plan.scopedReceipt) })).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      })
      const profile = await this.profileTarget()
      const shared = Object.values((await binding.sharedAdoptionJournal.read()).plans)
        .filter(plan => plan.scope === 'project' || plan.scope === 'profile' && plan.targetDirectory === profile?.root)
        .map(plan => ({ ...plan, canUndo: plan.status === 'applied' && !!plan.scopedReceipt }))
      return [...own, ...shared].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    })
  }

  async adoption(agent: Agent, id: string): Promise<AdoptionPlan | null> {
    return (await this.adoptions(agent)).find(plan => plan.id === id) ?? null
  }

  /** Human-only entry point: recheck the reviewed content and its evidence at commit. */
  async approveAdoption(agent: Agent, id: string, hash: string, options?: { confirmedTargetId?: string }): Promise<ApplyOutcome> {
    const binding = this.require(agent)
    return this.withAdoptionLock(agent, binding, async () => {
      const plan = await this.readAdoption(binding, id)
      if (!plan || !['session', 'project', 'profile'].includes(plan.scope) || plan.parent !== plan.revision.parent || plan.contentHash !== hash || plan.scope === 'session' && plan.targetSessionId !== String(agent.session.id)
        || plan.id !== adoptionId(plan) || contentHash(plan.revision.tree) !== hash || plan.revision.contentHash !== hash) {
        return { ok: false, reason: 'invalid', detail: 'Reviewed plan, target or content hash does not match.' }
      }
      if (plan.scope !== 'session') return this.approveScopedPlan(agent, binding, plan, options)
      // Idempotent after a duplicate click or a crash following the durable pointer commit.
      if (binding.revision?.id === plan.revision.id && binding.revision.contentHash === hash) {
        if (await binding.store.currentId() !== plan.revision.id) return { ok: false, reason: 'stale', detail: 'durable session revision changed' }
        // Complete the lifecycle half if the process died after persisting the
        // revision pointer. Never overwrite a later task generation.
        await binding.lifecycle.journal.update(state => {
          if (taskStamp(state, plan.targetSessionId) !== plan.taskStamp) return
          this.recordAdoptedTask(state, plan)
        })
        await this.setAdoptionStatus(binding, id, 'applied')
        return { ok: true, revision: binding.revision, warnings: [] }
      }
      if (plan.status !== 'pending') return { ok: false, reason: plan.status === 'rejected' ? 'rejected' : 'stale', detail: `adoption ${plan.status}` }
      const outcome = await binding.lifecycle.journal.update<ApplyOutcome>(async state => {
        if (plan.taskStamp !== taskStamp(state, plan.targetSessionId) || contentHash(plan.beforeTree) !== contentHash(binding.tree)) {
          return { ok: false, reason: 'stale', detail: 'Task or harness changed while awaiting review.' }
        }
        return this.commitSessionPlan(agent, binding, plan, state)
      })
      await this.setAdoptionStatus(binding, id, outcome.ok ? 'applied' : outcome.reason === 'stale' ? 'stale' : outcome.reason === 'invalid' ? 'failed' : 'pending', outcome.ok ? undefined : outcome.detail)
      if (outcome.ok) {
        await this.writeWorkspaceBundle(binding)
        await this.audit(agent, { event: 'adoption-confirmed', adoption: id, revision: plan.revision.id, contentHash: hash, parent: plan.parent, scope: plan.scope })
      }
      return outcome
    })
  }

  async rejectAdoption(agent: Agent, id: string, hash: string): Promise<void> {
    const binding = this.require(agent)
    await this.withAdoptionLock(agent, binding, async () => {
      const plan = await this.readAdoption(binding, id)
      if (!plan || plan.contentHash !== hash || (plan.scope === 'session' && plan.targetSessionId !== String(agent.session.id)) || plan.id !== adoptionId(plan)) throw new Error('Reviewed plan or content hash does not match.')
      if (!await this.targetMatches(agent, plan)) throw new Error('目标项目或 Profile 已变化。')
      if (plan.status === 'rejected') return
      if (plan.status !== 'pending') throw new Error(`Cannot reject ${plan.status} adoption.`)
      await this.setAdoptionStatus(binding, id, 'rejected', 'Declined by the user.')
      await this.audit(agent, { event: 'adoption-rejected', adoption: id, contentHash: hash })
    })
  }

  private async withAdoptionLock<T>(agent: Agent, binding: EvolveBinding, operation: () => Promise<T>): Promise<T> {
    return withLock(join(binding.dir, 'shared-adoptions.apply'), () =>
      withLock(join(binding.dir, 'sessions', `${agent.session.id}.apply`), operation))
  }

  private async targetMatches(agent: Agent, plan: AdoptionPlan): Promise<boolean> {
    if (plan.scope === 'session') return plan.targetSessionId === String(agent.session.id)
    if (plan.scope === 'project') return plan.targetDirectory === await realpath(agent.session.header.cwd ?? process.cwd())
    const profile = await this.profileTarget()
    return plan.targetDirectory === profile?.root && plan.profileName === profile?.name
  }

  private async readAdoption(binding: EvolveBinding, id: string): Promise<AdoptionPlan | undefined> {
    return (await binding.adoptionJournal.read()).plans[id] ?? (await binding.sharedAdoptionJournal.read()).plans[id]
  }

  private async adoptionJournalFor(binding: EvolveBinding, id: string): Promise<JsonJournal<AdoptionState>> {
    return (await binding.adoptionJournal.read()).plans[id] ? binding.adoptionJournal : binding.sharedAdoptionJournal
  }

  private async setAdoptionStatus(binding: EvolveBinding, id: string, status: AdoptionPlan['status'], detail?: string): Promise<void> {
    const journal = await this.adoptionJournalFor(binding, id)
    await journal.update(state => {
      const plan = state.plans[id]!
      plan.status = status; plan.updatedAt = new Date().toISOString()
      if (status === 'applied' && plan.scope === 'session') plan.appliedRevisionId = plan.revision.id
      if (detail === undefined) delete plan.detail
      else plan.detail = detail
    })
  }

  private async profileTarget(): Promise<Extract<ScopedHarnessTarget, { scope: 'profile' }> | undefined> {
    try {
      const get = (this.ctx as unknown as { get(name: string): unknown }).get
      const profile = get.call(this.ctx, 'profileContext') as { dir?: string; name?: string } | undefined
      if (profile?.dir && profile.name && isAbsolute(profile.dir)) return { scope: 'profile', root: await realpath(profile.dir), name: profile.name }
    } catch { /* headless may have no profile context */ }
    return undefined
  }

  private async gatherScopeSupport(agent: Agent): Promise<ScopeSupport[]> {
    const binding = this.require(agent)
    const project = await realpath(agent.session.header.cwd ?? process.cwd())
    const roots = new Set([project])
    const profile = await this.profileTarget()
    if (profile) {
      const registry = new JsonJournal<{ schema: 1; projects: string[] }>(join(profile.root, '.dsh-evolve', 'projects.json'), () => ({ schema: 1, projects: [] }))
      for (const root of await registry.update(state => {
        if (!state.projects.includes(project)) state.projects.push(project)
        return state.projects
      })) if (isAbsolute(root)) roots.add(root)
    }
    const facts: ScopeSupport[] = []
    for (const root of roots) {
      try {
        const state = root === project ? await binding.lifecycle.read() : JSON.parse(await readFile(join(root, this.config.workspaceDir, 'lifecycle.json'), 'utf8')) as LifecycleState
        if (state.schema === 2 && state.enabled) facts.push(...scopeSupport(state, root))
      } catch { /* inaccessible projects cannot count as current evidence */ }
    }
    return facts
  }

  /** Nominate shared reuse only after independent support; never apply a wider scope silently. */
  async suggestPromotions(agent: Agent): Promise<AdoptionPlan[]> {
    const binding = this.require(agent)
    if (!binding.enabled || this.config.autonomy === 'off' || this.config.autonomy === 'l1-only') return []
    const project = await realpath(agent.session.header.cwd ?? process.cwd())
    const facts = await this.gatherScopeSupport(agent)
    const hashes = new Set(facts.filter(fact => fact.project === project).map(fact => fact.contentHash))
    const proposed: AdoptionPlan[] = []
    for (const hash of hashes) {
      const fact = facts.find(item => item.project === project && item.contentHash === hash)!
      const targets: ScopedHarnessTarget[] = []
      if (supportsScope(facts, hash, 'project', project)) targets.push({ scope: 'project', root: project })
      const profile = await this.profileTarget()
      if (profile && supportsScope(facts, hash, 'profile', project)) targets.push(profile)
      for (const target of targets) {
        const existing = Object.values((await binding.sharedAdoptionJournal.read()).plans).find(plan => plan.scope === target.scope && plan.targetDirectory === target.root && plan.contentHash === hash && plan.status !== 'stale')
        if (existing) continue
        const scopedPlan = await previewScopedHarness({ target, tree: fact.tree })
        if (!scopedPlan.files.some(file => file.before !== file.after)) continue
        const support = facts.filter(item => item.contentHash === hash && (target.scope === 'profile' || item.project === project))
        const revision = createRevision({ parent: null, tree: fact.tree, origin: { kind: 'reflection' }, createdAt: new Date().toISOString(), level: 'L1', cacheImpact: 'low' })
        const now = new Date().toISOString()
        const changedFiles = scopedPlan.files.filter(file => file.before !== file.after)
        const draft = {
          scope: target.scope, adoptionMode: 'review' as const, targetId: `${target.scope}:${target.root}`,
          targetLabel: target.scope === 'project' ? '本项目的新会话' : `Profile ${target.name} 的 Agent`,
          targetDirectory: target.root, ...(target.scope === 'profile' ? { profileName: target.name } : {}),
          targetSessionId: String(agent.session.id), contentHash: hash, parent: null,
          headline: compactAdoptionHeadline(fact.expectedEffect, '共享范围改进'), changeKinds: adoptionChangeKinds(changedFiles.map(file => file.path)), fileCount: changedFiles.length,
          revision, beforeTree: {}, taskStamp: '', reason: fact.reason, expectedEffect: fact.expectedEffect,
          verification: support.map(item => `${item.project} · ${item.session} · ${item.episode}: ${item.reason}`),
          support: support.map(({ project, problem, session, episode }) => ({ project, problem, session, episode })),
          affectedSessions: this.liveBindings().filter(item => target.scope === 'profile' || item.binding.dir === binding.dir).map(item => String(item.agent.session.id)),
          affectedProjects: [...new Set(support.map(item => item.project))],
          impactNote: target.scope === 'project' ? '目录及其子目录的新会话会读取项目指令和技能；当前已加载会话不会强制刷新。' : '影响此 Profile 中继承该配置的 Agent，包括尚未打开的项目。当前列出的项目和会话仅是已知范围。',
          activation: target.scope === 'project' ? 'new-session' as const : 'restart' as const,
          activationDetail: scopedPlan.activationDetail,
          rollback: '撤销仅恢复 Evo 本次修改；若文件已被编辑，保留现状并提示冲突。已有对话历史不会被删除。',
          scopedPlan,
          files: changedFiles.map(file => ({ path: file.path, status: file.before === null ? 'added' as const : file.after === null ? 'removed' as const : 'changed' as const, before: file.before ?? '', after: file.after ?? '' })),
          createdAt: now, updatedAt: now,
        }
        const plan: AdoptionPlan = { ...draft, id: adoptionId(draft), status: 'pending' }
        await binding.sharedAdoptionJournal.update(state => { state.plans[plan.id] ??= plan })
        proposed.push(plan)
      }
    }
    return proposed
  }

  private async approveScopedPlan(agent: Agent, binding: EvolveBinding, plan: AdoptionPlan, options?: { confirmedTargetId?: string }): Promise<ApplyOutcome> {
    if (!plan.scopedPlan || plan.scope === 'session') return { ok: false, reason: 'invalid', detail: '缺少范围应用计划。' }
    const state = await binding.lifecycle.read()
    if (!binding.enabled || !state.enabled || ['off', 'l1-only'].includes(state.autonomy)) return { ok: false, reason: 'policy-denied', detail: '共享范围优化已关闭。' }
    const project = await realpath(agent.session.header.cwd ?? process.cwd())
    const profile = await this.profileTarget()
    const target = plan.scopedPlan.target
    if (plan.targetId !== `${target.scope}:${target.root}` || target.scope !== plan.scope
      || (target.scope === 'project' ? target.root !== project : target.root !== profile?.root || target.name !== profile?.name)) return { ok: false, reason: 'stale', detail: '目标项目或 Profile 已变化。' }
    if (plan.scope === 'profile' && options?.confirmedTargetId !== plan.targetId) return { ok: false, reason: 'confirmation-required', detail: '请明确确认受影响的 Profile 和 Agent 范围。', adoptionId: plan.id }
    if (plan.status === 'applied') return { ok: true, revision: plan.revision, warnings: [] }
    if (plan.status !== 'pending') return { ok: false, reason: 'stale', detail: `方案状态：${plan.status}` }
    const facts = await this.gatherScopeSupport(agent)
    const reviewedFacts = facts.filter(fact => plan.support?.some(item => item.project === fact.project && item.episode === fact.episode && item.problem === fact.problem && item.session === fact.session))
    if (!supportsScope(reviewedFacts, plan.contentHash, plan.scope, project)) {
      await this.setAdoptionStatus(binding, plan.id, 'stale', '独立支持证据已变化或被撤回。')
      return { ok: false, reason: 'stale', detail: '需要重新验证独立任务/项目证据。' }
    }
    const validation = validateTree(plan.revision.tree, { limits: { maxDiffChars: this.config.maxDiffChars, alwaysOnMaxChars: this.config.alwaysOnMaxChars }, advisoryChecks: ['V5'] })
    if (!validation.ok || unsupportedNativePaths(plan.revision.tree).length || contentHash(plan.revision.tree) !== plan.scopedPlan.contentHash) return { ok: false, reason: 'invalid', detail: '方案内容未通过组件验证。' }
    await binding.sharedAdoptionJournal.update(journal => {
      journal.plans[plan.id]!.confirmation = { at: new Date().toISOString(), targetId: plan.targetId!, contentHash: plan.contentHash }
    })
    let receipt
    try { receipt = await applyScopedHarness(plan.scopedPlan) }
    catch (error) {
      await this.setAdoptionStatus(binding, plan.id, 'stale', String(error))
      return { ok: false, reason: 'stale', detail: String(error) }
    }
    // A receipt write failure must leave the durable confirmation pending:
    // the next read can recover the already committed files and restore undo.
    await binding.sharedAdoptionJournal.update(journal => { const live = journal.plans[plan.id]!; live.scopedReceipt = receipt; live.status = 'applied'; live.updatedAt = new Date().toISOString() })
    await this.audit(agent, { event: 'scope-adoption-confirmed', adoption: plan.id, scope: plan.scope, target: plan.targetId, contentHash: plan.contentHash })
    return { ok: true, revision: plan.revision, warnings: [plan.activationDetail ?? '在新会话或 Profile 重启后加载。'] }
  }

  /** A crash after a confirmed file commit must not leave an already applied change awaiting review. */
  private async recoverSharedAdoptions(agent: Agent, binding: EvolveBinding): Promise<void> {
    const plans = Object.values((await binding.sharedAdoptionJournal.read()).plans)
    for (const plan of plans) {
      if (plan.status !== 'pending' || !plan.scopedPlan || !plan.confirmation || !await this.targetMatches(agent, plan)
        || plan.confirmation.contentHash !== plan.contentHash || plan.confirmation.targetId !== plan.targetId || plan.id !== adoptionId(plan)) continue
      let actual: Awaited<ReturnType<typeof inspectScopedHarness>>
      try { actual = await inspectScopedHarness(plan.scopedPlan) }
      catch (error) {
        await this.audit(agent, { event: 'scope-adoption-recovery-delayed', adoption: plan.id, detail: String(error) })
        continue
      }
      await binding.sharedAdoptionJournal.update(journal => {
          const live = journal.plans[plan.id]!
          if (actual === 'applied') {
            live.status = 'applied'; live.scopedReceipt = { plan: plan.scopedPlan!, appliedAt: plan.confirmation!.at }
          } else {
            live.status = actual === 'conflict' ? 'stale' : 'pending'
            live.detail = actual === 'conflict' ? '文件已变化，未继续应用。' : '上次写入被中断，已恢复原文件；可重新确认。'
            delete live.confirmation
          }
          live.updatedAt = new Date().toISOString()
      })
    }
  }

  private async commitSessionPlan(agent: Agent, binding: EvolveBinding, plan: AdoptionPlan, state: LifecycleState): Promise<ApplyOutcome> {
    const failure = await this.checkAdoption(agent, binding, plan.revision, state)
    if (failure) return failure
    await binding.store.save(plan.revision)
    const applied = await binding.overlay.apply(plan.revision)
    if (applied.ok) {
      this.recordAdoptedTask(state, plan)
    }
    return applied
  }

  private recordAdoptedTask(state: LifecycleState, plan: AdoptionPlan): void {
    const finishedTaskIds = new Set(plan.revision.evidence.flatMap(ref => ref.kind === 'experiment'
      && state.episodes[ref.episodeId]?.phase === 'post-task' ? [state.episodes[ref.episodeId]!.taskId] : []))
    for (const task of Object.values(state.tasks)) {
      if (task.sessionId !== plan.targetSessionId || !(['active', 'awaiting-input'].includes(task.status) || finishedTaskIds.has(task.id))) continue
      task.activeRevision = plan.revision.id; task.activeTree = plan.revision.tree; task.generation += 1
    }
  }

  /** Undo only the named change; a later revision cannot be accidentally withdrawn. */
  async undoAdoption(agent: Agent, id: string, hash: string): Promise<ApplyOutcome> {
    const binding = this.require(agent)
    const plan = await this.readAdoption(binding, id)
    if (!plan || plan.contentHash !== hash || plan.id !== adoptionId(plan) || plan.status !== 'applied' || !await this.targetMatches(agent, plan)) return { ok: false, reason: 'stale', detail: '该改进已变化或已撤销。' }
    if (plan.scope !== 'session') {
      return this.withAdoptionLock(agent, binding, async () => {
        const live = await this.readAdoption(binding, id)
        if (!live?.scopedReceipt || live.status !== 'applied' || !await this.targetMatches(agent, live)) return { ok: false, reason: 'stale', detail: '该共享改进已变化。' }
        try {
          await rollbackScopedHarness(live.scopedReceipt)
          await this.setAdoptionStatus(binding, id, 'undone', '已撤回受管文件；已有会话历史不会被改写。')
          return { ok: true, revision: plan.revision, warnings: [] }
        } catch (error) { return { ok: false, reason: 'stale', detail: String(error) } }
      })
    }
    const outcome = await this.rollback(agent, plan.parent ?? undefined, plan.revision.id)
    if (outcome.ok) await this.setAdoptionStatus(binding, id, 'undone')
    return outcome
  }

  /** Repair the only cross-document crash window after the durable pointer commit. */
  private async recoverCommittedAdoption(binding: EvolveBinding): Promise<void> {
    const current = binding.revision
    if (!current || await binding.store.currentId() !== current.id) return
    const plans = Object.values((await binding.adoptionJournal.read()).plans)
    const plan = plans.find(item => item.scope === 'session' && ['pending', 'applied'].includes(item.status) && item.revision.id === current.id
      && item.contentHash === current.contentHash && item.id === adoptionId(item))
    if (!plan) return
    if (taskStamp(await binding.lifecycle.read(), plan.targetSessionId) === plan.taskStamp) {
      await binding.lifecycle.journal.update(state => {
        if (taskStamp(state, plan.targetSessionId) !== plan.taskStamp) return
        this.recordAdoptedTask(state, plan)
      })
    }
    if (plan.status !== 'applied') await this.setAdoptionStatus(binding, plan.id, 'applied')
  }

  private adoptionHeadline(revision: Revision, state: LifecycleState): string {
    const reference = revision.evidence.find(ref => ref.kind === 'experiment')
    const candidate = reference?.kind === 'experiment'
      ? state.episodes[reference.episodeId]?.candidates.find(item => item.id === reference.candidateId)
      : undefined
    return compactAdoptionHeadline(candidate?.hypothesis ?? candidate?.expectedChanges[0], '本次会话改进')
  }

  private adoptionReason(revision: Revision, state: LifecycleState): string {
    const reasons = revision.evidence.map(ref => ref.kind === 'experiment'
      ? state.episodes[ref.episodeId]?.comparison?.rationale
      : ref.kind === 'experience' ? state.experiences[ref.experienceId]?.lesson : ref.note).filter(Boolean)
    return reasons.join('\n') || `Proposed ${revision.origin.kind} harness revision.`
  }

  private adoptionVerification(revision: Revision, state: LifecycleState): string[] {
    const facts = revision.evidence.flatMap(ref => {
      if (ref.kind === 'experiment') {
        const job = state.episodes[ref.episodeId]!
        const candidate = job.candidates.find(item => item.id === ref.candidateId)!
        const run = candidate.rollout!
        return [
          `Experiment ${job.id}: ${candidate.kind}, ${run.status}${run.limit ? ` (${run.limit})` : ''}; ${run.steps} steps, ${run.toolErrors} tool errors. Loader: ${run.loaderVersion}.`,
          ...run.checks.map(check => `${check.id}: ${check.status} — ${check.evidence}`),
          ...(job.comparison?.evidence ?? []),
          ...(candidate.advisories ?? []),
          'Evidence comes from an isolated local-file runner. It does not validate external tools, project/Profile changes, or replacement of already loaded conversation history.',
        ]
      }
      if (ref.kind === 'experience') {
        const entry = state.experiences[ref.experienceId]!
        return [`Experience ${entry.id}: ${entry.state}; applicability: ${entry.applicability}; loader: ${entry.loaderVersion}.`,
          ...entry.effects.map(effect => `${effect.path}: ${effect.effect} — ${effect.evidence}`),
          ...entry.counterEvidence.map(note => `Counter-evidence / limitation: ${note}`)]
      }
      return [ref.note]
    })
    return facts.length ? facts : ['Static checks only. No independently executed improvement evidence is attached to this manual revision.']
  }

  private async checkAdoption(agent: Agent, binding: EvolveBinding, revision: Revision, state: LifecycleState): Promise<Extract<ApplyOutcome, { ok: false }> | undefined> {
    try { asRevisionId(revision.id) } catch { return { ok: false, reason: 'invalid', detail: 'invalid revision identity' } }
    if (!binding.enabled || !state.enabled || state.autonomy === 'off' || this.config.autonomy === 'off') return { ok: false, reason: 'policy-denied', detail: 'evolution is off' }
    const persisted = await binding.store.current()
    if (revision.parent !== (binding.revision?.id ?? null) || revision.parent !== (persisted?.id ?? null)) return { ok: false, reason: 'stale', detail: 'expected parent changed' }
    if (contentHash(revision.tree) !== revision.contentHash) return { ok: false, reason: 'invalid', detail: 'revision content hash mismatch' }
    for (const path of Object.keys(revision.tree)) {
      const kind = classifyPath(path)
      const action: EvolutionAction = kind === 'loop-rule' ? 'l4-rule' : kind.startsWith('l2-') ? 'l2-write' : kind === 'candidate' ? 'l3-promote' : kind === 'loop-variant' ? 'l5-switch' : 'l1-apply'
      if (this.decide(action) !== 'allow' || decide(action, state.autonomy) !== 'allow') return { ok: false, reason: 'policy-denied', detail: `${action} needs policy/approval` }
    }
    for (const ref of revision.evidence) {
      if (ref.kind === 'experiment') {
        const job = state.episodes[ref.episodeId]; const task = job && state.tasks[job.taskId]
        const candidate = job?.candidates.find(c => c.id === ref.candidateId)
        const sessionTasks = Object.values(state.tasks).filter(item => item.sessionId === String(agent.session.id))
        const latestTask = sessionTasks.sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1)
        const workstream = job?.workstreamId ? state.workstreams?.[job.workstreamId] : undefined
        const continuation = job?.checkpoint === true && task !== undefined && latestTask !== undefined && job.workstreamId !== undefined
          && latestTask.workstreamId === job.workstreamId && latestTask.startedAt > task.startedAt
          && ['active', 'awaiting-input'].includes(latestTask.status) && workstream?.goalHash === job.goalHash
          && latestTask.activeRevision === job.expectedParent
        const phaseMatches = continuation
          || (job?.phase === 'during-task' ? task && ['active', 'awaiting-input'].includes(task.status)
            : job?.phase === 'post-task' && task && ['completed', 'failed', 'timeout'].includes(task.status) && latestTask?.id === task.id)
        const generationMatches = continuation || task?.generation === job?.expectedGeneration
        const parentMatches = continuation ? latestTask?.activeRevision === job?.expectedParent : task?.activeRevision === job?.expectedParent
        if (!job || !task || job.status !== 'selected' || !phaseMatches
          || task.sessionId !== String(agent.session.id)
          || !generationMatches || !parentMatches
          || revision.parent !== job.expectedParent || ref.snapshotId !== job.snapshotId
          || job.runnerCapabilities?.loaderVersion !== NATIVE_DISCLOSURE_VERSION || job.comparison?.loaderVersion !== NATIVE_DISCLOSURE_VERSION
          || candidate?.rollout?.loaderVersion !== NATIVE_DISCLOSURE_VERSION
          || !job.comparison?.complete || job.comparison.winner !== ref.candidateId || !candidate || !eligibleCandidate(candidate, task.requirements)
          || contentHash(candidate.tree) !== revision.contentHash || ref.contentHash !== revision.contentHash) {
          return { ok: false, reason: 'stale', detail: 'experiment no longer authorizes this task/revision' }
        }
      } else if (ref.kind === 'experience') {
        const entry = state.experiences[ref.experienceId]
        if (entry?.state !== 'transfer-supported' || entry.loaderVersion !== NATIVE_DISCLOSURE_VERSION || contentHash(entry.tree) !== revision.contentHash) return { ok: false, reason: 'stale', detail: 'experience was changed, revoked or needs validation with the current component loader' }
      }
    }
    const validated = revision.evidence.some(ref => ref.kind === 'experiment' || ref.kind === 'experience')
    const validation = validateTree(revision.tree, { base: binding.tree,
      limits: { maxDiffChars: this.config.maxDiffChars, alwaysOnMaxChars: this.config.alwaysOnMaxChars },
      advisoryChecks: validated ? ['V5'] : [] })
    if (!validation.ok) return { ok: false, reason: 'invalid', detail: JSON.stringify(validation.checks.filter(c => !c.ok)) }
    const unsupported = unsupportedNativePaths(revision.tree)
    if (unsupported.length) return { ok: false, reason: 'policy-denied', detail: `Session adoption currently supports native prompt/context/skill components only: ${unsupported.join(', ')}` }
    return undefined
  }

  /** Begin a distinct user task in the same session without inheriting its old overlay. */
  async clearForTask(agent: Agent): Promise<void> {
    const binding = this.require(agent)
    await withLock(join(binding.dir, 'sessions', `${agent.session.id}.apply`), async () => {
      await binding.store.setCurrent(null)
      binding.version += 1; binding.tree = Object.freeze({}); binding.revision = null
      await this.disposeSkills(binding); await this.disposePresets(binding)
      await binding.adoptionJournal.update(state => {
        for (const plan of Object.values(state.plans)) if (plan.status === 'pending') {
          plan.status = 'stale'; plan.detail = 'A distinct task cleared the session harness.'; plan.updatedAt = new Date().toISOString()
        }
      })
      await this.audit(agent, { event: 'task-overlay-cleared' })
    })
  }

  /**
   * Roll back to a stored revision. The rollback is itself recorded as a new
   * revision whose parent is the revision being left, keeping history linear.
   */
  async rollback(agent: Agent, to?: RevisionId, expectedCurrent?: RevisionId): Promise<ApplyOutcome> {
    const binding = this.require(agent)
    return withLock(join(binding.dir, 'sessions', `${agent.session.id}.apply`), async () => {
    const current = binding.revision
    if (current === null) {
      return { ok: false, reason: 'no-current', detail: 'no revision is applied' }
    }
    if (await binding.store.currentId() !== current.id) return { ok: false, reason: 'stale', detail: 'durable session revision changed' }
    if (expectedCurrent && current.id !== expectedCurrent) return { ok: false, reason: 'stale', detail: 'A newer change is active; this undo cannot withdraw it.' }
    const targetId = to ?? current.parent
    // The model-visible rollback tool may withdraw this session's own changes,
    // but must not import another session's revision from the shared store.
    if (targetId) {
      const ancestors = new Set<string>()
      let cursor: Revision | null = current
      while (cursor && !ancestors.has(cursor.id)) {
        ancestors.add(cursor.id)
        cursor = cursor.parent ? await binding.store.load(cursor.parent) : null
      }
      if (!ancestors.has(targetId)) return { ok: false, reason: 'policy-denied', detail: 'rollback target is not in this session revision history; propose it for review instead' }
    }
    const target = targetId === null || targetId === undefined
      ? null
      : await binding.store.load(targetId)
    const rollback = createRevision({
      parent: current.id,
      tree: target?.tree ?? {},
      origin: { kind: 'rollback', of: targetId ?? current.id },
      evidence: [],
      createdAt: new Date().toISOString(),
      level: target?.level ?? current.level,
      cacheImpact: 'low',
    })
    await binding.store.save(rollback)
    const outcome = await binding.overlay.apply(rollback)
    if (outcome.ok) {
      await binding.lifecycle.journal.update(state => {
        for (const task of Object.values(state.tasks)) if (task.sessionId === String(agent.session.id) && ['active', 'awaiting-input'].includes(task.status)) {
          task.activeRevision = rollback.id; task.activeTree = rollback.tree; task.generation += 1
        }
        for (const entry of Object.values(state.experiences)) if (contentHash(entry.tree) === current.contentHash) {
          entry.state = 'revoked'; entry.counterEvidence.push(`Explicit rollback of revision ${current.id}`)
        }
      })
      await this.writeWorkspaceBundle(binding)
      await this.audit(agent, { event: 'rolled-back', revision: rollback.id, of: targetId ?? current.id })
    }
    return outcome
    })
  }

  private async bind(agent: Agent): Promise<void> {
    if (this.stopped || this.bindings.has(agent)) return
    const cwd = agent.session.header.cwd ?? process.cwd()
    const dir = join(cwd, this.config.workspaceDir)
    const store = new FileRevisionStore(dir, String(agent.session.id))
    const library = new FileLibraryStore({ dir: join(dir, 'library') })
    const budget = new SessionBudget({
      maxEvolutionsPerSession: this.config.maxEvolutionsPerSession,
      maxProposalInputTokens: this.config.maxProposalInputTokens,
      maxProposalOutputTokens: this.config.maxProposalOutputTokens,
      maxExtraTokenRatio: this.config.maxExtraTokenRatio,
      cooldownSteps: this.config.cooldownSteps,
    })

    const binding: EvolveBinding = {
      dir,
      store,
      library,
      budget,
      lifecycle: new Lifecycle(dir, this.config.autonomy, { maxDiffChars: this.config.maxDiffChars, alwaysOnMaxChars: this.config.alwaysOnMaxChars }),
      sharedAdoptionJournal: new JsonJournal<AdoptionState>(join(dir, 'shared-adoptions.json'), () => ({ schema: 1, plans: {} })),
      adoptionJournal: new JsonJournal<AdoptionState>(join(dir, 'adoptions', `${agent.session.id}.json`), () => ({ schema: 1, plans: {} })),
      presetKeys: new Set(),
      enabled: this.config.enabled && this.config.autonomy !== 'off',
      tree: Object.freeze({}) as HarnessTree,
      revision: null,
      version: 0,
      overlay: undefined as unknown as OverlayManager,
      sectionDisposers: [],
      skillFiber: undefined,
    }

    const legacy = await library.all()
    await binding.lifecycle.importLegacy(await Promise.all(legacy.map(async entry => ({ ...entry,
      ...(entry.adoptedRevision ? { tree: (await store.load(entry.adoptedRevision).catch(() => undefined))?.tree ?? {} } : {}),
    }))))
    if ((await binding.lifecycle.read()).autonomy !== this.config.autonomy) await binding.lifecycle.journal.update(state => { state.autonomy = this.config.autonomy })
    if (!this.config.enabled || this.config.autonomy === 'off') await binding.lifecycle.setEnabled(false)
    const persisted = await binding.lifecycle.read()
    binding.enabled &&= persisted.enabled
    const current = await store.current()
    if (current !== null && binding.enabled) {
      binding.tree = current.tree
      binding.revision = current
    }

    binding.overlay = new OverlayManager({
      store,
      install: async (revision) => this.installRevision(agent, binding, revision),
      verify: async (revision) => binding.tree === revision.tree,
      onApplied: (revision) => { binding.revision = revision },
    })

    if (this.stopped) return
    this.bindings.set(agent, binding)
    this.live.set(String(agent.id), { agent, binding })
    await withLock(join(binding.dir, 'sessions', `${agent.session.id}.apply`), () => this.recoverCommittedAdoption(binding))
    if (current !== null) await this.writeWorkspaceBundle(binding)
    if (!binding.enabled) return
    this.installSections(agent, binding)
    await this.installSkills(agent, binding)
    await this.installPresets(agent, binding)
  }

  private async installRevision(agent: Agent, binding: EvolveBinding, revision: Revision): Promise<Overlay> {
    if (this.stopped) throw new Error('Evo has been unloaded')
    const previous = { tree: binding.tree, revision: binding.revision }
    const token = binding.version + 1
    binding.version = token
    binding.tree = revision.tree
    binding.revision = revision
    try {
      await this.installSkills(agent, binding)
      await this.installPresets(agent, binding)
    } catch (error) {
      binding.tree = previous.tree; binding.revision = previous.revision
      await this.installSkills(agent, binding); await this.installPresets(agent, binding)
      throw error
    }
    return {
      dispose: async () => {
        if (binding.version !== token) return
        binding.tree = previous.tree
        binding.revision = previous.revision
        await this.installSkills(agent, binding)
        await this.installPresets(agent, binding)
      },
    }
  }

  /**
   * Materialize L2 data (`presets/`, `subagents/`, `patch/`) into a legal
   * workspace bundle. Applying it to a new composition still requires a new
   * session/profile; this method only makes the change durable and reviewable.
   */
  private async writeWorkspaceBundle(binding: EvolveBinding): Promise<void> {
    const l2 = Object.entries(binding.tree).filter(([path]) => (
      path.startsWith('presets/') || path.startsWith('subagents/') || path.startsWith('patch/')
    ))
    if (l2.length === 0) return
    const dir = join(binding.dir, 'bundle')
    const patch = l2.filter(([path]) => path.startsWith('patch/')).map(([, text]) => text.trim()).join('\n')
    const loopPatch = await readFile(join(dir, 'loop.patch.yml'), 'utf8').catch(() => undefined)
    const manifest = {
      name: 'dsh-evolve-workspace',
      version: '0.0.0',
      private: true,
      type: 'module',
      dsh: {
        bundle: {
          patch: loopPatch === undefined
            ? './cordis.patch.yml'
            : ['./cordis.patch.yml', './loop.patch.yml'],
        },
      },
    }
    await atomicText(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await atomicText(join(dir, 'cordis.patch.yml'), patch.length === 0 ? '[]\n' : `${patch}\n`)
    for (const [path, text] of l2) {
      if (path.startsWith('patch/')) continue
      await atomicText(join(dir, ...path.split('/')), text)
    }
  }

  /**
   * Register workspace `presets/` and `subagents/` declarations through the
   * agent-preset registry. Profiles without that service (headless/base) skip
   * this method; the files remain durable for a web/new composition.
   */
  private async installPresets(agent: Agent, binding: EvolveBinding): Promise<void> {
    if (this.stopped || !this.config.l2 || !binding.enabled || !this.may('l2-write')) return
    let registry: { register(definition: never): Promise<() => Promise<void>> } | undefined
    try {
      const get = (this.ctx as unknown as { get?: (name: string) => unknown }).get
      registry = (get?.call(this.ctx, 'agentPresets') ?? (this.ctx as unknown as {
        agentPresets?: { register(definition: never): Promise<() => Promise<void>> }
      }).agentPresets) as { register(definition: never): Promise<() => Promise<void>> } | undefined
    } catch {
      return
    }
    if (registry?.register === undefined) return
    const { definitions, errors } = parsePresetDefinitions(binding.tree)
    for (const error of errors) this.ctx.logger.warn('evolve: %s', error)
    const prefix = `evolve-${contentHash({ workspace: binding.dir }).slice(0, 8)}-${String(agent.session.id)}-`
    const desired = new Set(definitions.map(definition => prefix + definition.id))
    for (const key of binding.presetKeys) if (!desired.has(key)) {
      await this.presetCache.get(key)?.dispose(); this.presetCache.delete(key); binding.presetKeys.delete(key)
    }
    for (const original of definitions) {
      const definition = { ...original, id: prefix + original.id }
      const fingerprint = presetFingerprint(definition)
      const cached = this.presetCache.get(definition.id)
      if (cached?.fingerprint === fingerprint) continue
      if (cached !== undefined) {
        try { await cached.dispose() } catch { /* registry teardown is best effort */ }
        this.presetCache.delete(definition.id)
      }
      try {
        const dispose = await registry.register(definition as never)
        if (this.stopped) { await dispose(); continue }
        this.presetCache.set(definition.id, { fingerprint, dispose })
        binding.presetKeys.add(definition.id)
        await this.audit(agent, { event: 'l2-preset-registered', preset: definition.id, fingerprint })
      } catch (error: unknown) {
        this.ctx.logger.warn('evolve: preset %s was not registered: %o', definition.id, error)
      }
    }
  }

  private async disposePresets(binding: EvolveBinding): Promise<void> {
    for (const key of binding.presetKeys) {
      await this.presetCache.get(key)?.dispose(); this.presetCache.delete(key)
    }
    binding.presetKeys.clear()
  }

  private installSections(agent: Agent, binding: EvolveBinding): void {
    if (this.stopped) return
    if (binding.sectionDisposers.length > 0) return
    binding.sectionDisposers.push(installPromptComponents(agent.ctx, () => binding.tree))
  }

  private disposeSections(binding: EvolveBinding): void {
    for (const dispose of binding.sectionDisposers.splice(0)) dispose()
  }

  private async installSkills(agent: Agent, binding: EvolveBinding): Promise<void> {
    await this.disposeSkills(binding)
    if (this.stopped || !binding.enabled) return
    binding.skillFiber = await installSkillComponents(agent.ctx, binding.tree)
    if (this.stopped) await this.disposeSkills(binding)
  }

  private async disposeSkills(binding: EvolveBinding): Promise<void> {
    const fiber = binding.skillFiber
    binding.skillFiber = undefined
    await fiber?.dispose()
  }
}

async function atomicText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(temp, text, 'utf8')
  await rename(temp, path)
}

export default { name, inject, apply }

/**
 * Mount the evolve service on the calling context.
 * @param ctx - plugin context with `agents`, `systemPrompt`, and `skills`.
 * @param config - validated core configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const evolve = new Evolve(ctx, config)
  ctx.provide('evolve', evolve)
}

 declare module '@deepseek-ai/cordis' {
  interface Context {
    evolve: Evolve
  }
}
