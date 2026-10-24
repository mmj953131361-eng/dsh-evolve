import type { Requirement } from '@dsh-evolve/core/lifecycle'

export type CompletionResponse = Record<string, unknown>
const object = (value: unknown): CompletionResponse => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as CompletionResponse : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []

/** Exact citations are necessary evidence, never a substitute for the model's semantic check. */
export function assessCompletion(response: CompletionResponse, requirements: Requirement[], shown: Record<string, string>, fileDelivery: boolean) {
  const supports = (item: unknown) => {
    const claim = object(item); const quote = text(claim.quote).trim()
    return quote.length >= 3 && shown[text(claim.path)]?.includes(quote) === true
  }
  const malformed = !['completed', 'awaiting-input', 'continue', 'changed'].includes(text(response.decision)) || typeof response.requiresUserInput !== 'boolean'
  const issues: string[] = malformed ? ['Use a supported decision and an explicit boolean requiresUserInput; a missing or string value cannot establish completion.'] : []
  const missing = requirements.filter(requirement => requirement.required && !list(response.requirements).some(item => {
    const claim = object(item)
    return claim.id === requirement.id && claim.status === 'pass' && (!requirement.check || claim.path === requirement.check.path) && supports(item)
  }))
  for (const requirement of missing) issues.push(`Requirement ${requirement.id} lacks a passing exact, contiguous quote from its permitted delivery path${requirement.check ? ` (${requirement.check.path})` : ''}.`)
  const delivery = list(response.delivery).filter(supports)
  const deliveryMissing = !delivery.length || fileDelivery && !delivery.some(item => text(object(item).path) !== '$answer')
  if (deliveryMissing) issues.push('Delivery needs an exact contiguous citation from the supplied evidence' + (fileDelivery ? ' in an artifact, not only the final answer.' : '.'))
  return { issues, missing, delivery, deliveryMissing, malformed, complete: response.decision === 'completed' && response.requiresUserInput === false && issues.length === 0 }
}

/** Replace only requested IDs. A repair cannot rewrite already accepted claims or inject new ones. */
export function mergeCompletionRepair(previous: CompletionResponse, patch: CompletionResponse, ids: string[], repairDelivery: boolean): CompletionResponse {
  return { ...previous, ...patch,
    requirements: [...list(previous.requirements).filter(item => !ids.includes(text(object(item).id))), ...list(patch.requirements).filter(item => ids.includes(text(object(item).id)))],
    delivery: repairDelivery ? patch.delivery : previous.delivery,
  }
}
