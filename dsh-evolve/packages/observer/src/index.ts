/**
 * `ctx.evolveEvidence`: folds tool activity into behavioral signals and a
 * harness2-style text trace.
 *
 * The trace is evidence for the proposer, never a model-visible prompt by
 * itself. It is capped and rendered from the same process events the model
 * already produced, so no separate logging channel is needed.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

export const name = 'evolve-observer'
export const inject = ['tools']

/** Consecutive-activity counters for one agent. */
export interface SignalSnapshot {
  /** Consecutive identical tool calls (including successful ones). */
  readonly repeatToolCall: number
  /** Consecutive identical failing tool calls. */
  readonly repeatToolError: number
  readonly totalToolCalls: number
  readonly totalToolErrors: number
}

/** Evidence source consumed by the agent package. */
export interface EvidenceSource {
  render(agent: Agent): string
  signals(agent: Agent): SignalSnapshot
  record(agent: Agent, line: string): void
  reset(agent: Agent): void
}

interface Buffer {
  readonly lines: string[]
  lastCallKey: string | undefined
  sameCall: number
  lastErrorKey: string | undefined
  sameError: number
  totalCalls: number
  totalErrors: number
}

export interface ObserverConfig {
  /** Maximum retained trace lines per agent. */
  maxLines?: number
}

const DEFAULT_MAX_LINES = 80

function empty(): Buffer {
  return {
    lines: [],
    lastCallKey: undefined,
    sameCall: 0,
    lastErrorKey: undefined,
    sameError: 0,
    totalCalls: 0,
    totalErrors: 0,
  }
}

/** Deterministic JSON for tool arguments, so equivalent calls share a key. */
export function stableKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableKey(record[key])}`).join(',')}}`
}

function textOf(result: Readonly<ToolExecutionResult>): string {
  const content = (result as unknown as { content?: readonly { type: string; text?: string }[] }).content
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
}

function truncate(text: string, limit: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}…`
}

class FileEvidenceSource implements EvidenceSource {
  private readonly buffers = new WeakMap<Agent, Buffer>()
  private readonly maxLines: number

  constructor(maxLines: number) {
    this.maxLines = maxLines
  }

  private buffer(agent: Agent): Buffer {
    let buffer = this.buffers.get(agent)
    if (buffer === undefined) {
      buffer = empty()
      this.buffers.set(agent, buffer)
    }
    return buffer
  }

  private push(buffer: Buffer, line: string): void {
    buffer.lines.push(line)
    if (buffer.lines.length > this.maxLines) buffer.lines.splice(0, buffer.lines.length - this.maxLines)
  }

  record(agent: Agent, line: string): void {
    this.push(this.buffer(agent), line)
  }

  observe(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): void {
    const agent = exec.agent
    if (agent === undefined) return
    const buffer = this.buffer(agent)
    const callKey = `${exec.name}:${stableKey(exec.arguments)}`
    buffer.totalCalls += 1
    if (buffer.lastCallKey === callKey) buffer.sameCall += 1
    else {
      buffer.lastCallKey = callKey
      buffer.sameCall = 1
    }
    this.push(buffer, `[ACTION] ${exec.name} ${truncate(stableKey(exec.arguments), 200)}`)
    if (result.isError) {
      buffer.totalErrors += 1
      const errorKey = `${callKey}`
      if (buffer.lastErrorKey === errorKey) buffer.sameError += 1
      else {
        buffer.lastErrorKey = errorKey
        buffer.sameError = 1
      }
      this.push(buffer, `[ERROR] ${exec.name}: ${truncate(textOf(result) || 'tool reported an error', 300)}`)
    } else {
      buffer.lastErrorKey = undefined
      buffer.sameError = 0
      const text = truncate(textOf(result), 200)
      if (text.length > 0) this.push(buffer, `[OBSERVATION] ${text}`)
    }
  }

  render(agent: Agent): string {
    const buffer = this.buffers.get(agent)
    return buffer === undefined ? '' : buffer.lines.join('\n')
  }

  signals(agent: Agent): SignalSnapshot {
    const buffer = this.buffers.get(agent)
    if (buffer === undefined) {
      return { repeatToolCall: 0, repeatToolError: 0, totalToolCalls: 0, totalToolErrors: 0 }
    }
    return {
      repeatToolCall: buffer.sameCall,
      repeatToolError: buffer.sameError,
      totalToolCalls: buffer.totalCalls,
      totalToolErrors: buffer.totalErrors,
    }
  }

  reset(agent: Agent): void {
    const buffer = this.buffers.get(agent)
    if (buffer === undefined) return
    buffer.lines.length = 0
    buffer.lastCallKey = undefined
    buffer.sameCall = 0
    buffer.lastErrorKey = undefined
    buffer.sameError = 0
  }
}

/**
 * Mount the evidence source.
 * @param ctx - plugin context with `tools`.
 * @param config - observer configuration.
 */
export function apply(ctx: Context, config: ObserverConfig = {}): void {
  const source = new FileEvidenceSource(config.maxLines ?? DEFAULT_MAX_LINES)
  ctx.provide('evolveEvidence', source)
  ctx.on('tools/result', (exec, result) => { source.observe(exec, result) })
}

export default { name, inject, apply }

declare module '@deepseek-ai/cordis' {
  interface Context {
    evolveEvidence: EvidenceSource
  }
}
