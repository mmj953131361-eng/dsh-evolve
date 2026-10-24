/**
 * Conservative repeatability rules for shadow probes.
 *
 * A task is probeable only when nothing observed can reach outside the
 * worktree. Unknown tools, shell execution, network tools, and side-effect
 * verbs in the task text all make it non-probeable. When uncertain, return
 * false: a missed optimization is cheaper than a real external effect.
 */

const SAFE_TOOLS = new Set(['read', 'write', 'edit', 'glob', 'grep', 'list', 'ls'])

const SIDE_EFFECT = /\b(?:send|email|mail|message|post|publish|deploy|upload|download|payment|purchase|order|delete|remove|rm|unlink|network|http|https|api|curl|web|search|fetch|git\s+push|docker|ssh|scp|kubectl|terraform)\b/i

/** Result of the deterministic repeatability assessment. */
export interface Repeatability {
  readonly repeatable: boolean
  readonly reason: string
}

/**
 * Assess whether a task can be re-run in an isolated workspace.
 * @param task - the task text the model received.
 * @param observedTools - tool names observed in the current session.
 * @returns a conservative decision with a human-readable reason.
 */
export function assessRepeatable(task: string, observedTools: readonly string[] = []): Repeatability {
  if (task.trim().length === 0) return { repeatable: false, reason: 'no task text to re-run' }
  const sideEffect = SIDE_EFFECT.exec(task)
  if (sideEffect !== null) {
    return { repeatable: false, reason: `task mentions "${sideEffect[0]}", which may have external effects` }
  }
  const unsafe = observedTools.find(tool => !SAFE_TOOLS.has(tool))
  if (unsafe !== undefined) {
    return { repeatable: false, reason: `observed tool "${unsafe}" is not known to be side-effect-free` }
  }
  return { repeatable: true, reason: 'task text and observed tools are workspace-local' }
}

/** Extract distinct tool names from an observer trace. */
export function toolsFromTrace(trace: string): string[] {
  const names = new Set<string>()
  for (const match of trace.matchAll(/\[ACTION\]\s+(\S+)/g)) {
    if (match[1] !== undefined) names.add(match[1])
  }
  return [...names]
}
