/**
 * @deprecated 0.1 historical test fixture; not used by the production lifecycle.
 * A probe runner seam. The default implementation delegates to a spawned
 * subagent in the isolated workspace; tests and alternative substrates can
 * exercise it directly. Production `setRunner()` rejects legacy runners.
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { Revision } from '@dsh-evolve/core/revision'
import type { RunMetrics } from './compose.js'

/** Input to one rerun. */
export interface ProbeRunInput {
  readonly task: string
  readonly cwd: string
  readonly revision: Revision | null
  readonly signal: AbortSignal
  /** The live agent that owns this probe; the child inherits its options. */
  readonly parent: Agent
}

/** Runner contract. */
export interface ProbeRunner {
  run(input: ProbeRunInput): Promise<RunMetrics>
}

interface SnapshotEvent {
  readonly type: string
  readonly data?: {
    readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number }
    readonly message?: { readonly isError?: boolean; readonly content?: readonly { type: string; text?: string }[] }
  }
}

interface ChildAgent extends Agent {
  readonly session: Agent['session'] & { snapshotEvents?: () => readonly SnapshotEvent[] }
}

interface SubagentActivationLike {
  readonly childId: unknown
  readonly result: Promise<{ readonly stopReason: string; readonly diagnostic?: string }>
  dispose(): Promise<void>
}

interface SubagentsLike {
  startActivation(spec: Record<string, unknown>): Promise<SubagentActivationLike>
}

/**
 * Build the default runner from the mounted subagent provider.
 * @param ctx - plugin context.
 * @param provider - subagent provider name.
 * @returns a runner, or undefined when delegation is not mounted.
 */
export function createSubagentRunner(
  ctx: Context,
  provider: string,
): ProbeRunner | undefined {
  let subagents: SubagentsLike | undefined
  try {
    const get = (ctx as unknown as { get?: (name: string) => unknown }).get
    subagents = (get?.call(ctx, 'subagents') ?? (ctx as unknown as { subagents?: SubagentsLike }).subagents) as SubagentsLike | undefined
  } catch {
    return undefined
  }
  if (subagents?.startActivation === undefined) return undefined

  return {
    async run({ task, cwd, signal, parent }) {
      const agents = (ctx as unknown as { agents?: { get(id: unknown): ChildAgent | undefined } }).agents
      if (agents === undefined) throw new Error('probe: no agent registry')
      const activation = await subagents.startActivation({
        provider,
        label: 'evolve-probe',
        request: {
          parent,
          cwd,
          prompt: [{ type: 'text', text: task }],
          signal,
        },
        signal,
        delivery: 'caller',
      })
      const child = agents.get(activation.childId)
      try {
        const result = await activation.result
        const events = child?.session.snapshotEvents?.() ?? []
        let steps = 0
        let toolCalls = 0
        let toolErrors = 0
        let inputTokens = 0
        let outputTokens = 0
        for (const event of events) {
          if (event.type === 'step/end') steps += 1
          else if (event.type === 'tool/result') {
            toolCalls += 1
            if (event.data?.message?.isError === true) toolErrors += 1
          } else if (event.type === 'assistant/message') {
            inputTokens += event.data?.usage?.inputTokens ?? 0
            outputTokens += event.data?.usage?.outputTokens ?? 0
          }
        }
        const evidence = (ctx as unknown as { evolveEvidence?: { render(agent: Agent): string } }).evolveEvidence
        const trace = child === undefined ? '' : evidence?.render(child) ?? ''
        return {
          completed: result.stopReason === 'completed',
          steps,
          toolCalls,
          toolErrors,
          inputTokens,
          outputTokens,
          trace,
          ...result.diagnostic === undefined ? {} : { error: result.diagnostic },
        }
      } finally {
        await activation.dispose().catch(() => {})
      }
    },
  }
}
