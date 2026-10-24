/**
 * L4: a deliberately small, data-only loop rule language.
 *
 * Rules change loop *behavior* through injected notices; they cannot alter
 * scheduling, approval, sandbox, or any code. Unknown actions and signals are
 * rejected rather than ignored.
 */
import { parse as parseYaml } from 'yaml'

/** Signals a rule may observe. */
export type RuleSignal = 'repeat-tool-call' | 'repeat-tool-error' | 'total-tool-errors'

/** Accepted actions. Only a notice is currently executable. */
export type RuleAction = 'notice'

/** One validated rule. */
export interface LoopRule {
  readonly id: string
  readonly signal: RuleSignal
  readonly threshold: number
  readonly action: RuleAction
  readonly text: string
}

const SIGNALS: readonly RuleSignal[] = ['repeat-tool-call', 'repeat-tool-error', 'total-tool-errors']

/**
 * Parse and validate `loop/rules.yml`.
 * @param text - YAML document shaped as `{ rules: [...] }`.
 * @returns validated rules; malformed entries are dropped.
 */
export function parseLoopRules(text: string): LoopRule[] {
  let document: unknown
  try {
    document = parseYaml(text)
  } catch {
    return []
  }
  if (typeof document !== 'object' || document === null) return []
  const raw = (document as { rules?: unknown }).rules
  if (!Array.isArray(raw)) return []
  const rules: LoopRule[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : undefined
    const signal = typeof record.signal === 'string' ? record.signal as RuleSignal : undefined
    const threshold = typeof record.threshold === 'number' ? record.threshold : undefined
    const action = typeof record.action === 'string' ? record.action as RuleAction : undefined
    const notice = typeof record.text === 'string' ? record.text : undefined
    if (id === undefined || signal === undefined || threshold === undefined || action === undefined || notice === undefined) continue
    if (!SIGNALS.includes(signal)) continue
    if (action !== 'notice') continue
    if (!Number.isFinite(threshold) || threshold <= 0) continue
    if (notice.trim().length === 0 || notice.length > 500) continue
    if (rules.some(rule => rule.id === id)) continue
    rules.push({ id, signal, threshold, action, text: notice })
  }
  return rules
}

/** Read one signal value from the observer snapshot. */
export function signalValue(
  rules: readonly LoopRule[],
  signals: { repeatToolCall: number; repeatToolError: number; totalToolErrors: number },
): Map<string, number> {
  const values = new Map<string, number>()
  for (const rule of rules) {
    const value = rule.signal === 'repeat-tool-call'
      ? signals.repeatToolCall
      : rule.signal === 'repeat-tool-error'
        ? signals.repeatToolError
        : signals.totalToolErrors
    values.set(rule.id, value)
  }
  return values
}

/** Rules that have crossed their threshold and have not fired for this revision. */
export function dueRules(
  rules: readonly LoopRule[],
  signals: { repeatToolCall: number; repeatToolError: number; totalToolErrors: number },
  fired: ReadonlySet<string>,
): LoopRule[] {
  const values = signalValue(rules, signals)
  return rules.filter(rule => !fired.has(rule.id) && (values.get(rule.id) ?? 0) >= rule.threshold)
}
