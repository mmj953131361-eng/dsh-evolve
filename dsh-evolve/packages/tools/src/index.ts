import { episodeSummary } from '@dsh-evolve/core/lifecycle'
/**
 * Model-facing `evolve_*` tools. They mirror the `/evolve` command surface so
 * the agent can report and adjust its own scaffolding (PRD §7.4).
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { RevisionId } from '@dsh-evolve/core/ids'
import type {} from '@dsh-evolve/agent'
import type {} from '@dsh-evolve/sandbox'
import type {} from '@dsh-evolve/probe'

export const name = 'evolve-tools'
export const inject = ['tools', 'evolve', 'evolveAgent', 'evolveSandbox', 'evolveProbe']

const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

/**
 * Mount the tool set.
 * @param ctx - plugin context with tools, evolve, evolveAgent.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'evolve_status',
    description: 'Report this agent current evolved revision, level, task type, and evolution budget.',
    parameters: {},
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (_args, exec) => {
      const agent = exec.agent
      if (agent === undefined) return 'evolve: no agent in this execution'
      const binding = ctx.evolve.binding(agent)
      if (binding === undefined) return 'evolve: agent is not bound'
      const state = ctx.evolveAgent.state(agent)
      const budget = await ctx.evolve.budgetSnapshot(agent)
      return JSON.stringify({
        enabled: binding.enabled,
        workspace: binding.dir,
        revision: binding.revision?.id ?? null,
        level: binding.revision?.level ?? null,
        paths: Object.keys(binding.revision?.tree ?? {}),
        taskType: state?.taskType ?? null,
        step: state?.step ?? 0,
        automation: state?.automation,
        evolutions: budget.evolutions,
        extraTokens: budget.extraTokens,
      }, null, 2)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'evolve_propose',
    description: 'Queue an evidence-driven INV/DOM experiment. Selection and verified application occur separately.',
    parameters: {
      trigger: { type: 'string', description: 'Short reason for the proposal (optional).' },
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const agent = exec.agent
      if (agent === undefined) throw new Error('evolve_propose: no agent in this execution')
      const result = await ctx.evolveAgent.proposeNow(agent, args.trigger ?? 'manual')
      return JSON.stringify(result, null, 2)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'evolve_rollback',
    description: 'Roll this agent back to a stored revision. Omit the revision to return to the parent of the current one.',
    parameters: {
      revision: { type: 'string', description: 'Revision event id. Omit for the previous revision.' },
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const agent = exec.agent
      if (agent === undefined) throw new Error('evolve_rollback: no agent in this execution')
      const outcome = await ctx.evolve.rollback(agent, args.revision as RevisionId | undefined)
      return outcome.ok
        ? `evolve: rolled back to ${outcome.revision.id}`
        : `evolve: rollback failed (${outcome.reason}): ${outcome.detail}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'evolve_library',
    description: 'Browse lessons recorded in the workspace Library, optionally filtered by task type.',
    parameters: {
      taskType: { type: 'string', description: 'Optional task type filter.' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      const agent = exec.agent
      if (agent === undefined) throw new Error('evolve_library: no agent in this execution')
      const entries = Object.values((await ctx.evolve.require(agent).lifecycle.read()).experiences)
      const selected = args.taskType === undefined ? entries : entries.filter(entry => entry.taskType === args.taskType)
      return JSON.stringify(selected, null, 2)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'evolve_probe',
    description: 'Queue a full baseline/INV/DOM/compose experiment from frozen task input. The built-in background worker executes it; queuing itself never applies a harness.',
    parameters: {
      revision: { type: 'string', description: 'Deprecated: standalone candidate comparison is unsupported. Omit this field.' },
      apply: { type: 'boolean', description: 'Deprecated and ignored; selected results use the lifecycle adoption gate.' },
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const agent = exec.agent
      if (agent === undefined) throw new Error('evolve_probe: no agent in this execution')
      if (args.revision !== undefined) throw new Error('evolve_probe takes no revision: queue a full task experiment without this field.')
      const state = ctx.evolveAgent.state(agent)
      const outcome = await ctx.evolveProbe.run(agent, {
        ...state === undefined ? {} : { task: state.task },
        apply: args.apply === true,
      })
      return JSON.stringify(outcome, null, 2)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'evolve_candidate',
    description: 'Submit plugin source for static checks. It stays pending until a trusted isolated verifier passes, followed by approval bound to the exact source hash.',
    parameters: {
      name: { type: 'string', description: 'Candidate name.', required: true },
      description: { type: 'string', description: 'What the candidate does.', required: true },
      source: { type: 'string', description: 'Complete ES module source exporting name and apply(ctx).', required: true },
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const agent = exec.agent
      if (agent === undefined) throw new Error('evolve_candidate: no agent in this execution')
      const meta = await ctx.evolveSandbox.submit(agent, args)
      return JSON.stringify(meta, null, 2)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'evolve_promote',
    description: 'Promote a dynamically verified and human-approved candidate with an unchanged source hash. Static checks alone are insufficient.',
    parameters: {
      id: { type: 'string', description: 'Candidate id.', required: true },
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const agent = exec.agent
      if (agent === undefined) throw new Error('evolve_promote: no agent in this execution')
      const meta = await ctx.evolveSandbox.promote(agent, args.id)
      return meta === undefined ? 'evolve: candidate not found' : JSON.stringify(meta, null, 2)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'evolve_note',
    description: 'Record a reusable lesson in the workspace library for this task type.',
    parameters: {
      cue: { type: 'string', description: 'Situation that should trigger this lesson.', required: true },
      lesson: { type: 'string', description: 'What to do in that situation.', required: true },
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const agent = exec.agent
      if (agent === undefined) throw new Error('evolve_note: no agent in this execution')
      const task = await ctx.evolveAgent.task(agent)
      const entry = await ctx.evolve.require(agent).lifecycle.note(task.id, args.lesson, args.cue)
      return `evolve: recorded hypothesis ${entry.id}; no effectiveness claim`

    },
  }))
  ctx.tools.register(defineTool({
    name: 'evolve_task',
    description: 'Optional advanced override for automatic task tracking; ordinary conversation needs no calls to this tool. Declare user-task requirements or report task state. Requirements are a JSON array of {id,description,source,required,check?:{path,kind:exists|json|contains,value?}}. Checks supplement semantic correctness. Reporting completion persists an independent learning job; it never waits for learning.',
    parameters: {
      requirements: { type: 'string', description: 'JSON requirements with the user/source requirement, optional.' },
      status: { type: 'string', description: 'active, awaiting-input, completed, failed, timeout or cancelled.' },
      evidence: { type: 'string', description: 'Concrete completion, failure or cancellation evidence.' },
    }, output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const agent = exec.agent
      if (!agent) throw new Error('no agent')
      const raw: unknown = args.requirements ? JSON.parse(args.requirements) : undefined
      if (raw !== undefined && (!Array.isArray(raw) || raw.some(r => !r || typeof r.id !== 'string' || typeof r.description !== 'string' || typeof r.source !== 'string' || typeof r.required !== 'boolean' || (r.check && (typeof r.check.path !== 'string' || !['exists', 'json', 'contains'].includes(r.check.kind)))))) throw new Error('invalid requirements')
      const task = await ctx.evolveAgent.task(agent, undefined, raw as import('@dsh-evolve/core/lifecycle').Requirement[] | undefined)
      if (args.status && args.status !== 'active') {
        if (!['awaiting-input', 'completed', 'failed', 'timeout', 'cancelled'].includes(args.status)) throw new Error('invalid task status')
        const episode = await ctx.evolveAgent.finish(agent, args.status as Exclude<import('@dsh-evolve/core/lifecycle').TaskStatus, 'active'>, args.evidence ?? '')
        return JSON.stringify({ taskId: task.id, status: args.status, episode: episode ? episodeSummary(episode) : undefined })
      }
      return JSON.stringify({ id: task.id, status: task.status, requirements: task.requirements.slice(0, 50), snapshotId: task.snapshotId })
    },
  }))
  ctx.tools.register(defineTool({
    name: 'evolve_jobs', description: 'Read the latest 20 durable experiment summaries, decisions, usage and pending reasons. Full artifacts stay in the local journal.',
    parameters: {}, output: TEXT_OUTPUT, isConcurrencySafe: () => true,
    execute: async (_args, exec) => exec.agent ? JSON.stringify(await ctx.evolveAgent.jobs(exec.agent)) : 'no agent',
  }))
  ctx.tools.register(defineTool({
    name: 'evolve_work', description: 'Optional manual execution of one queued learning experiment. The built-in worker already handles ordinary conversations automatically. This diagnostic call waits for execution using frozen inputs and restricted local-file tools.',
    parameters: { id: { type: 'string', description: 'Experiment ID; otherwise the oldest queued job.' } }, output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      if (!exec.agent) return 'no agent'
      const job = await ctx.evolveAgent.work(exec.agent, args.id)
      return job ? JSON.stringify(episodeSummary(job)) : 'no queued job'
    },
  }))

}

export default { name, inject, apply }
