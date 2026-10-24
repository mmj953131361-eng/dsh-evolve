/** Probe entry point delegates to the durable full experiment protocol. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Revision } from '@dsh-evolve/core/revision'
import type {} from '@dsh-evolve/core/plugin'
import type { EvolutionEpisode } from '@dsh-evolve/core/lifecycle'
import type { ProbeRunner } from './runs.js'
import { assessRepeatable, toolsFromTrace, type Repeatability } from './repeatable.js'
export const name = 'evolve-probe'
export const inject = ['agents', 'evolve', 'evolveEvidence']
export interface Config { enabled: boolean; k: number; maxK: number; timeoutMs: number; provider: string; apply: boolean }
export const DEFAULT_CONFIG: Config = { enabled: true, k: 1, maxK: 3, timeoutMs: 120000, provider: 'local-files', apply: false }
export interface ProbeOptions { task?: string; candidate?: Revision; k?: number; apply?: boolean; signal?: AbortSignal }
export interface ProbeOutcome { repeatable: boolean; reason: string; unavailable?: boolean; episodeId?: string; status?: EvolutionEpisode['status'] }
export interface EvolveProbeService {
  setRunner(runner: ProbeRunner): void
  assess(task: string, trace?: string): Repeatability
  run(agent: Agent, options?: ProbeOptions): Promise<ProbeOutcome>
}
export function apply(ctx: Context, config: Partial<Config> = {}): void {
  const settings = { ...DEFAULT_CONFIG, ...config }
  ctx.provide('evolveProbe', {
    // Legacy unconstrained runners must never silently re-enable a safety bypass.
    setRunner() { throw new Error('legacy runner removed; implement ExperimentRunner with enforced local capabilities') },
    assess(task: string, trace = '') { return assessRepeatable(task, toolsFromTrace(trace)) },
    async run(agent: Agent, options: ProbeOptions = {}): Promise<ProbeOutcome> {
      const binding = ctx.evolve.require(agent)
      if (!settings.enabled || !binding.enabled || !ctx.evolve.may('l1-apply')) return { repeatable: false, reason: 'disabled-by-policy' }
      options.signal?.throwIfAborted()
      if (options.candidate) return { repeatable: false, unavailable: true, reason: 'standalone candidate comparison removed; use the full INV/DOM experiment to preserve baseline and compose evidence' }
      const task = Object.values((await binding.lifecycle.read()).tasks).find(t => t.sessionId === String(agent.session.id))
      if (!task) return { repeatable: false, unavailable: true, reason: 'no frozen task input; start a task first' }
      const episode = await binding.lifecycle.enqueue(task.id, 'post-task', 'manual probe')
      return { repeatable: !!task.snapshotId, reason: `${episode.reason}; one post-task experiment per task, repeated probes return this existing job`, episodeId: episode.id, status: episode.status }
    },
  } satisfies EvolveProbeService)
}
declare module '@deepseek-ai/cordis' { interface Context { evolveProbe: EvolveProbeService } }
export default { name, inject, apply }
