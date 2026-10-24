#!/usr/bin/env node
/** Explicit standalone worker, using published DSH services and the stock loop. */
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import FsLocal from '@deepseek-ai/dsh-fs-local'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { Lifecycle, lifecycleSummary } from '@dsh-evolve/core/lifecycle'
import { digest } from '@dsh-evolve/core/task-snapshot'
import { experimentModel, localFileRunner } from './experiment-adapter.js'

/** Mount only production primitives. Probes mount their own isolated skill registry/loader. */
export async function createWorkerRuntime(config: PiAi.Options): Promise<Context> {
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(Projections)
    await ctx.plugin(SystemPrompt, {}); await ctx.plugin(FsLocal); await ctx.plugin(WorkingDirectory)
    await ctx.plugin(Tools, {}); await ctx.plugin(AgentRegistry)
    await ctx.plugin(PiAi, config); await ctx.plugin(AgentLoop, { agents: [] })
    return ctx
  } catch (error) { await ctx.fiber.dispose(); throw error }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const argument = (name: string) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1] }
  const workspace = argument('--workspace')
  if (!workspace || argv.includes('--help')) {
    process.stdout.write('dsh-evolve-worker --workspace <task directory> --config <provider.json> [--job <id>] [--resume] [--watch]\nRead-only --status or --cancel --job <id> needs no provider config. Use apiKeyEnv, never a literal key.\n')
    return
  }
  const directory = join(resolve(workspace), '.dsh-evolve')
  const lifecycle = new Lifecycle(directory)
  if (argv.includes('--status')) { process.stdout.write(`${JSON.stringify(lifecycleSummary(await lifecycle.read()), null, 2)}\n`); return }
  if (argv.includes('--cancel')) {
    const id = argument('--job'); if (!id) throw new Error('--cancel needs --job')
    await lifecycle.cancel(id); process.stdout.write(`cancelled ${id}\n`); return
  }
  if (argv.includes('--resume')) {
    const id = argument('--job'); if (!id) throw new Error('--resume needs --job')
    await lifecycle.resume(id)
  }
  const configPath = argument('--config')
  if (!configPath) throw new Error('--config is required for a worker')
  const source = await readFile(resolve(configPath), 'utf8')
  const config: PiAi.Options = JSON.parse(source)
  if (/"apiKey"\s*:/.test(source)) throw new Error('worker config must reference apiKeyEnv, not contain a key')
  const ctx = await createWorkerRuntime(config)
  const stop = new AbortController()
  const shutdown = () => stop.abort(new Error('worker stopped'))
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown)
  try {
    do {
      const state = await lifecycle.read()
      const requested = argument('--job')
      const job = requested ? state.episodes[requested] : Object.values(state.episodes).find(e => e.status === 'queued')
      if (job) {
        const task = state.tasks[job.taskId]!
        const provider = argument('--provider') ?? task.provider
        const model = argument('--model') ?? task.model
        if (!provider || !model) throw new Error('task or command must identify provider and model')
        const result = await lifecycle.run(job.id, experimentModel(ctx, provider, model), localFileRunner(ctx, provider, model), { signal: stop.signal, runtimeFingerprint: digest(JSON.stringify({ provider, model, config })) })
        process.stdout.write(`${JSON.stringify({ id: result.id, status: result.status, reason: result.reason, processingTokens: result.reservations.reduce((s, r) => s + r.charged, 0) })}\n`)
        if (!argv.includes('--watch') && !['selected', 'kept-base'].includes(result.status)) process.exitCode = result.status === 'cancelled' ? 130 : 1
      } else if (!argv.includes('--watch')) process.stdout.write('No queued experiments.\n')
      if (!argv.includes('--watch') || requested || stop.signal.aborted) break
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); stop.signal.removeEventListener('abort', done); resolve() }
        const timer = setTimeout(done, 1000); stop.signal.addEventListener('abort', done, { once: true })
      })
    } while (!stop.signal.aborted)
  } finally {
    process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown)
    await ctx.fiber.dispose()
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 })
}
