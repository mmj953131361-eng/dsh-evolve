/**
 * Human `/evolve` commands provide the headless and advanced-control alternative
 * to the ordinary-chat lifecycle and Web interface.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type { RevisionId } from '@dsh-evolve/core/ids'
import { episodeSummary } from '@dsh-evolve/core/lifecycle'
import { diffSummary, diffTrees } from '@dsh-evolve/core/tree'
import type {} from '@dsh-evolve/agent'
import type {} from '@dsh-evolve/sandbox'
import type {} from '@dsh-evolve/probe'

export const name = 'evolve-commands'
export const inject = ['commands', 'evolve', 'evolveEvidence', 'evolveAgent', 'evolveSandbox', 'evolveProbe']

const HELP = [
  'jobs | work [id] | cancel <id> | resume <id> | finish <status> | status | history | diff [id] | rollback [id] | on | off | reflect | propose | probe | library | adoptions | review <id> | accept <id> <contentHash> [--confirm-scope <targetId>] | dismiss <id> <contentHash> | undo <id> <contentHash> | pending | approve <id> | reject <id> | promote <id> | loop <stock|evolve-loop>',
].join('\n')

async function statusText(agent: Agent, ctx: Context): Promise<string> {
  const binding = ctx.evolve.binding(agent)
  if (binding === undefined) return 'evolve: agent is not bound'
  const current = binding.revision
  const budget = await ctx.evolve.budgetSnapshot(agent)
  const state = ctx.evolveAgent.state(agent)
  return [
    `enabled: ${binding.enabled}`,
    `workspace: ${binding.dir}`,
    `revision: ${current?.id ?? '(none)'}`,
    `level: ${current?.level ?? '-'}  cacheImpact: ${current?.cacheImpact ?? '-'}`,
    `taskType: ${state?.taskType ?? '-'}  step: ${state?.step ?? 0}  shaped: ${state?.shaped ?? false}`,
    `evolutions: ${budget.evolutions}  tokens: ${budget.extraTokens}`,
    `surface paths: ${Object.keys(current?.tree ?? {}).join(', ') || '(empty)'}`,
  ].join('\n')
}

async function historyText(agent: Agent, ctx: Context): Promise<string> {
  const binding = ctx.evolve.require(agent)
  const list = await binding.store.list()
  if (list.length === 0) return 'evolve: no revisions'
  return list.map(item => [
    item.id,
    item.level,
    item.origin.kind,
    item.createdAt,
    item.id === binding.revision?.id ? '(current)' : '',
  ].filter(Boolean).join('  ')).join('\n')
}

/**
 * Mount the command set.
 * @param ctx - plugin context with commands, evolve, evolveEvidence, evolveAgent.
 */
export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'evolve',
    description: 'Inspect, propose, roll back, or disable self-evolution for this agent.',
    input: { hint: 'status|history|diff|rollback|on|off|reflect|propose|checkpoint|probe|library|adoptions|review|accept|dismiss|undo|pending|approve|reject|promote|loop' },
    handler: async ({ agent, rawInput }) => {
      const [subcommand = 'status', argument, hash, ...extra] = rawInput.trim().split(/\s+/)
      try {
        switch (subcommand) {
          case 'adoptions': {
            const plans = await ctx.evolve.adoptions(agent)
            return { kind: 'success', text: plans.length ? plans.map(plan => `${plan.id}  ${plan.status}  ${plan.scope}\n  ${plan.reason}\n  /evolve review ${plan.id}`).join('\n') : 'evolve: no harness changes awaiting review' }
          }
          case 'review': {
            if (!argument) return { kind: 'error', text: 'evolve: review requires an adoption id' }
            const plan = await ctx.evolve.adoption(agent, argument)
            if (!plan) return { kind: 'error', text: 'evolve: adoption not found' }
            const diff = diffTrees(plan.beforeTree, plan.revision.tree)
            const paths = [...diff.added, ...diff.removed, ...diff.changed]
            const files = plan.files ?? paths.map(path => ({ path, before: plan.beforeTree[path] ?? '(absent)', after: plan.revision.tree[path] ?? '(absent)' }))
            return { kind: 'success', text: [
              `adoption: ${plan.id} (${plan.status})`,
              `scope: ${plan.scope}; session: ${plan.targetSessionId}`,
              `reason: ${plan.reason}`,
              ...(plan.expectedEffect ? [`expected effect: ${plan.expectedEffect}`] : []),
              ...(plan.targetLabel || plan.targetDirectory || plan.profileName ? [`target: ${plan.targetLabel ?? ''} ${plan.targetDirectory ?? ''} ${plan.profileName ?? ''}`.trim()] : []),
              ...(plan.impactNote ? [plan.impactNote] : []),
              ...(plan.affectedSessions ? [`affected sessions: ${plan.affectedSessions.join(', ') || '(none currently known)'}`] : []),
              ...(plan.affectedProjects ? [`affected projects: ${plan.affectedProjects.join(', ') || '(none currently known)'}`] : []),
              `activation: ${plan.activation}; rollback: ${plan.rollback}`,
              ...(plan.activationDetail ? [plan.activationDetail] : []),
              `parent: ${plan.parent ?? '(none)'}; contentHash: ${plan.contentHash}`,
              `evidence: ${JSON.stringify(plan.revision.evidence, null, 2)}`,
              ...(plan.verification ?? []),
              ...(plan.detail ? [plan.detail] : []),
              ...files.map(file => `--- ${file.path}\nBEFORE:\n${file.before}\nAFTER:\n${file.after}`),
              `Accept this exact change: /evolve accept ${plan.id} ${plan.contentHash}${plan.scope === 'profile' ? ` --confirm-scope ${plan.targetId}` : ''}`,
              `Reject this exact change: /evolve dismiss ${plan.id} ${plan.contentHash}`,
            ].join('\n\n') }
          }
          case 'accept':
          case 'dismiss':
          case 'undo': {
            const confirmedTargetId = extra.length === 2 && extra[0] === '--confirm-scope' && subcommand === 'accept' ? extra[1] : undefined
            if (!argument || !hash || !/^[a-f0-9]{64}$/.test(hash) || extra.length && !confirmedTargetId) return { kind: 'error', text: `evolve: ${subcommand} requires an adoption id and its full contentHash; use /evolve review <id> first` }
            if (subcommand === 'dismiss') {
              await ctx.evolve.rejectAdoption(agent, argument, hash)
              return { kind: 'success', text: `evolve: rejected ${argument}` }
            }
            const outcome = subcommand === 'undo' ? await ctx.evolve.undoAdoption(agent, argument, hash)
              : await ctx.evolve.approveAdoption(agent, argument, hash, confirmedTargetId ? { confirmedTargetId } : undefined)
            return outcome.ok
              ? { kind: 'success', text: subcommand === 'undo' ? `evolve: undone ${argument}` : `evolve: applied ${outcome.revision.id}; see the reviewed activation details for when the change takes effect.` }
              : { kind: 'error', text: `evolve: not applied (${outcome.reason}): ${outcome.detail}` }
          }
          case 'jobs':
            return { kind: 'success', text: JSON.stringify(await ctx.evolveAgent.jobs(agent), null, 2) }
          case 'work': {
            const job = await ctx.evolveAgent.work(agent, argument)
            return { kind: 'success', text: job ? JSON.stringify(episodeSummary(job), null, 2) : 'no queued job' }
          }
          case 'cancel':
          case 'resume':
            if (!argument) return { kind: 'error', text: 'experiment id required' }
            await ctx.evolveAgent[subcommand](agent, argument)
            return { kind: 'success', text: `evolve: ${subcommand} ${argument}` }
          case 'finish': {
            if (!argument || !['completed', 'failed', 'timeout', 'cancelled', 'awaiting-input'].includes(argument)) return { kind: 'error', text: 'finish expects completed/failed/timeout/cancelled/awaiting-input' }
            const job = await ctx.evolveAgent.finish(agent, argument as Exclude<import('@dsh-evolve/core/lifecycle').TaskStatus, 'active'>, 'explicit user command')
            return { kind: 'success', text: job ? `evolve: task closed; experiment ${job.id} ${job.status}` : 'evolve: task state recorded' }
          }
          case 'status':
            return { kind: 'success', text: await statusText(agent, ctx) }
          case 'history':
            return { kind: 'success', text: await historyText(agent, ctx) }
          case 'diff': {
            const binding = ctx.evolve.require(agent)
            const current = binding.revision
            if (current === null) return { kind: 'error', text: 'evolve: no current revision' }
            const target = argument === undefined ? current : await binding.store.load(argument as RevisionId)
            const parent = target.parent === null ? null : await binding.store.load(target.parent)
            const diff = diffTrees(parent?.tree ?? {}, target.tree)
            return {
              kind: 'success',
              text: `revision ${target.id} vs ${target.parent ?? '(root)'}\n${diffSummary(diff)}\n`
                + `added: ${diff.added.join(', ') || '-'}\nremoved: ${diff.removed.join(', ') || '-'}\nchanged: ${diff.changed.join(', ') || '-'}`,
            }
          }
          case 'rollback': {
            const outcome = await ctx.evolve.rollback(agent, argument as RevisionId | undefined)
            return outcome.ok
              ? { kind: 'success', text: `evolve: rolled back to ${outcome.revision.id}` }
              : { kind: 'error', text: `evolve: rollback failed (${outcome.reason}): ${outcome.detail}` }
          }
          case 'on':
          case 'off': {
            await ctx.evolve.setEnabled(agent, subcommand === 'on')
            return { kind: 'success', text: `evolve: ${subcommand}` }
          }
          case 'reflect': {
            const result = await ctx.evolveAgent.reflect(agent)
            return { kind: 'success', text: `evolve: experiment ${result.episodeId ?? 'not queued'}; ${result.entries} verified entries written; ${result.status ?? ""} ${result.reason ?? ""}` }
          }
          case 'propose': {
            const result = await ctx.evolveAgent.proposeNow(agent, 'manual')
            return result.ok
              ? { kind: 'success', text: `evolve: ${result.reason} ${result.episodeId ?? ''} — ${result.rationale ?? ''}` }
              : { kind: 'error', text: `evolve: not applied (${result.reason}) ${result.rationale ?? ''}` }
          }
          case 'checkpoint': {
            const result = await ctx.evolveAgent.checkpoint(agent)
            return result.ok
              ? { kind: 'success', text: `evolve: checkpoint queued ${result.episodeId ?? ''}` }
              : { kind: 'error', text: `evolve: checkpoint not queued (${result.reason})` }
          }
          case 'loop': {
            const mode = argument ?? 'stock'
            if (mode !== 'stock' && mode !== 'evolve-loop') {
              return { kind: 'error', text: 'evolve: loop expects stock or evolve-loop' }
            }
            const binding = ctx.evolve.require(agent)
            if (!binding.enabled || ctx.evolve.decide('l5-switch') === 'deny') return { kind: 'error', text: 'evolve: loop change disabled by policy' }
            const dir = join(binding.dir, 'bundle')
            await mkdir(dir, { recursive: true })
            const patch = mode === 'evolve-loop'
              ? "- id: agent-loop\n  disabled: true\n- insert:\n    - id: evolve-loop\n      name: '@dsh-evolve/bundle/loop'\n      config:\n        agents: []\n"
              : '[]\n'
            await atomicText(join(dir, 'loop.patch.yml'), patch)
            const mainPatchPath = join(dir, 'cordis.patch.yml')
            const existingMain = await readFile(mainPatchPath, 'utf8').catch(() => undefined)
            if (existingMain === undefined) await atomicText(mainPatchPath, '[]\n')
            const manifestPath = join(dir, 'package.json')
            const manifest = await readFile(manifestPath, 'utf8').then(JSON.parse).catch(() => ({
              name: 'dsh-evolve-workspace',
              version: '0.0.0',
              private: true,
              type: 'module',
              dsh: { bundle: { patch: './cordis.patch.yml' } },
            }))
            manifest.dsh = { bundle: { patch: ['./cordis.patch.yml', './loop.patch.yml'] } }
            await atomicText(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
            return {
              kind: 'success',
              text: `evolve: wrote ${join(dir, 'loop.patch.yml')} (${mode}).\n`
                + 'L5 requires approval and a new composition: add this workspace bundle to the profile '
                + `(dsh plugin --profile <name> add ${dir}) and start a new session.`,
            }
          }
          case 'library': {
            const entries = Object.values((await ctx.evolve.require(agent).lifecycle.read()).experiences)
            if (entries.length === 0) return { kind: 'success', text: 'evolve: library is empty' }
            return {
              kind: 'success',
              text: entries.map(entry => `${entry.taskType}  ${entry.state}  ${entry.applicability}\n  ${entry.lesson}`).join('\n'),
            }
          }
          case 'probe': {
            if (argument) return { kind: 'error', text: 'evolve: probe takes no revision argument; use /evolve probe for the full experiment.' }
            const state = ctx.evolveAgent.state(agent)
            const outcome = await ctx.evolveProbe.run(agent, {
              ...state === undefined ? {} : { task: state.task },
              apply: true,
            })
            return {
              kind: 'success',
              text: JSON.stringify(outcome, null, 2),
            }
          }
          case 'pending': {
            const candidates = await ctx.evolveSandbox.list(agent)
            if (candidates.length === 0) return { kind: 'success', text: 'evolve: no candidates' }
            return {
              kind: 'success',
              text: candidates.map(candidate => `${candidate.id}  ${candidate.status}  ${candidate.name}  ${candidate.report.ok ? 'verified' : 'rejected'}`).join('\n'),
            }
          }
          case 'approve':
          case 'reject':
          case 'promote': {
            if (argument === undefined) return { kind: 'error', text: `evolve: ${subcommand} requires a candidate id` }
            const meta = subcommand === 'approve'
              ? await ctx.evolveSandbox.approve(agent, argument)
              : subcommand === 'reject'
                ? await ctx.evolveSandbox.reject(agent, argument)
                : await ctx.evolveSandbox.promote(agent, argument)
            if (meta === undefined) return { kind: 'error', text: `evolve: candidate ${argument} not found` }
            return { kind: 'success', text: `evolve: ${meta.id} -> ${meta.status}\n${JSON.stringify(meta.report, null, 2)}` }
          }
          default:
            return { kind: 'error', text: `evolve: unknown subcommand "${subcommand}"\n${HELP}` }
        }
      } catch (error: unknown) {
        return { kind: 'error', text: `evolve: ${error instanceof Error ? error.message : String(error)}` }
      }
    },
  })
}

async function atomicText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(temp, text, 'utf8')
  await rename(temp, path)
}

export default { name, inject, apply }
