/** Durable task and experiment protocol. No host objects or credentials are persisted. */
import type { HarnessTree } from './tree.js'
import type { Autonomy } from './policy.js'

export type TaskStatus = 'active' | 'awaiting-input' | 'completed' | 'failed' | 'timeout' | 'cancelled'
export type ExperimentStatus = 'queued' | 'running' | 'pending-validation' | 'selected' | 'kept-base' | 'failed' | 'cancelled' | 'budget-exhausted' | 'stale'
export type LessonState = 'hypothesis' | 'task-validated' | 'transfer-supported' | 'revoked'
export type Effect = 'helped' | 'hurt' | 'no-observed-effect' | 'confounded'

/** Deterministic checks supplement semantic evaluation; existence alone proves no correctness. */
export interface Requirement {
  id: string
  description: string
  source: string
  required: boolean
  check?: { path: string; kind: 'exists' | 'json' | 'contains'; value?: string }
}
export interface RequirementCheck {
  id: string
  status: 'pass' | 'fail' | 'unknown'
  evidence: string
}
export interface ProgressSnapshot {
  at: string
  step: number
  toolCalls: number
  toolErrors: number
  edits: number
  processingTokens: number
  artifactHash: string
  checks: RequirementCheck[]
  signals: string[]
}
export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}
export interface Reservation {
  id: string
  stage: string
  maximum: number
  maximumInput: number
  maximumOutput: number
  model: boolean
  status: 'reserved' | 'settled' | 'unknown'
  charged: number
  usage?: Usage
}
export interface ExperimentBudget {
  maxProcessingTokens: number
  /** Token charge; absent a tokenizer, dispatch reserves UTF-8 bytes conservatively. */
  maxProposalInputTokens: number
  maxProposalOutputTokens: number
  maxWallMs: number
  maxProbeRuns: number
  maxConcurrent: number
  maxDepth: number
  probeTokens: number
  probeSteps: number
  probeTimeoutMs: number
  /** Probe model output per dispatch, distinct from total processing tokens. */
  probeMaxOutputTokens?: number
  /** Optional per-call output ceiling for models whose reasoning consumes output tokens. */
  modelMaxOutputTokens?: number
  /** Independent strategies per family; absent on old persisted jobs means one. */
  strategyVariants?: number
  /**
   * Blind comparisons of the same candidates under fresh anonymous labels. A candidate is adopted
   * only with a strict majority of all rounds; absent on old persisted jobs means one round.
   */
  selectionRounds?: number
}
export const DEFAULT_EXPERIMENT_BUDGET: ExperimentBudget = Object.freeze({
  maxProcessingTokens: 1_000_000, maxProposalInputTokens: 160_000,
  maxProposalOutputTokens: 32_768, maxWallMs: 900_000, maxProbeRuns: 4,
  probeMaxOutputTokens: 32768, modelMaxOutputTokens: 4096, maxConcurrent: 2, maxDepth: 2, probeTokens: 150_000, probeSteps: 40, probeTimeoutMs: 120_000,
})
export interface TaskRun {
  id: string
  sessionId: string
  prompt: string
  taskType: string
  cwd: string
  status: TaskStatus
  completionEvidence: string
  generation: number
  activeRevision: string | null
  initialTree: HarnessTree
  activeTree?: HarnessTree
  snapshotId: string | null
  snapshotReason: string
  inputBytes?: number
  problemKey?: string
  requirements: Requirement[]
  progress: ProgressSnapshot[]
  trace: string
  startedAt: string
  finishedAt?: string
  provider?: string
  model?: string
}
export interface Rollout {
  /** Actual component loading semantics attested by this execution; absent on legacy evidence. */
  loaderVersion?: string
  status: 'completed' | 'failed' | 'timeout' | 'cancelled'
  answer: string
  artifacts: Record<string, string>
  checks: RequirementCheck[]
  trace: string
  steps: number
  toolCalls: number
  toolErrors: number
  wallMs: number
  usage?: Usage
  reason?: string
  /**
   * Set only when the run ended on a resource ceiling (output tokens, steps, or processing
   * tokens) rather than an agent or runtime error. Such a run may still hold a usable deliverable,
   * so it reaches the comparison with this flag as evidence; it is never treated as a clean pass.
   */
  limit?: 'output-tokens' | 'steps' | 'processing-tokens'
}
export interface Candidate {
  id: string
  /** Durable search stage; old single-candidate episodes use kind. */
  stage?: string
  kind: 'baseline' | 'invariant' | 'domain' | 'compose' | 'reuse'
  tree: HarnessTree
  hypothesis: string
  expectedChanges: string[]
  validation: 'valid' | 'invalid'
  reason?: string
  repairs?: { reason: string; originalHash: string; outcome: string }[]
  /** Non-blocking budget findings (for example V5 diff size) shown to the selector as facts. */
  advisories?: string[]
  rollout?: Rollout
}
export interface Comparison {
  /** Set only when all compared executions attest the same advertised loading semantics. */
  loaderVersion?: string
  winner: string | null
  rationale: string
  evidence: string[]
  labels: Record<string, string>
  complete: boolean
}
export interface Experience {
  /** Loading semantics under which this lesson was observed; legacy evidence remains unversioned. */
  loaderVersion?: string
  id: string
  taskType: string
  lesson: string
  applicability: string
  tree: HarnessTree
  state: LessonState
  tasks: string[]
  episodes: string[]
  effects: { path: string; effect: Effect; evidence: string; candidateId?: string; artifactPath?: string; quote?: string }[]
  counterEvidence: string[]
  createdAt: string
}
export interface EvolutionEpisode {
  id: string
  taskId: string
  phase: 'during-task' | 'post-task'
  trigger: string
  scope: 'full-task' | 'local'
  snapshotId: string
  expectedParent: string | null
  baselineTree?: HarnessTree
  expectedGeneration: number
  /** Source/requirements identity frozen at dispatch, required for wider-scope support. */
  taskEvidenceHash?: string
  expectedRecommendation: string | null
  recommendation?: { episodeId: string; tree: HarnessTree }
  library: Experience[]
  libraryHash: string
  status: ExperimentStatus
  reason: string
  createdAt: string
  startedAt?: string
  /** Cumulative execution time; downtime between explicit resumes is excluded. */
  activeWallMs?: number
  validationLimits?: import('./validator.js').ValidationLimits
  endedAt?: string
  worker?: { id: string; pid: number; expiresAt: number; activeSince?: number }
  runtimeFingerprint?: string
  runnerCapabilities?: ExperimentRunner['capabilities']
  budget: ExperimentBudget
  reservations: Reservation[]
  candidates: Candidate[]
  comparison?: Comparison
  /** Frozen before dispatch; cached answers must never be interpreted under fresh labels. */
  selectionInputs?: Record<string, {
    labels: Record<string, string>
    prompt: string
    sources: Record<string, string>
    executions: import('./selection.js').CandidateEvidence[]
  }>
  reflectionReview?: { accepted: number; rejected: number }
  /** Each completed model stage persists its response before the next stage. */
  responses: Record<string, string>
  failedCalls?: { stage: string; reservationId: string; text: string; error: string }[]
  inFlight?: string
  attempts: number
}
export interface LifecycleState {
  schema: 2
  enabled: boolean
  autonomy: Autonomy
  tasks: Record<string, TaskRun>
  episodes: Record<string, EvolutionEpisode>
  experiences: Record<string, Experience>
  recommendations: Record<string, string>
}
export interface ModelCall {
  stage: string
  prompt: string
  maxTokens: number
  signal: AbortSignal
}
export interface ExperimentModel {
  /** Resolve a route-aware output allowance before reserving/dispatching. */
  outputLimit?(prompt: string, requested: number, signal: AbortSignal): Promise<number>
  complete(input: ModelCall): Promise<{ text: string; usage?: Usage; error?: string }>
}
export interface ExperimentRunner {
  /** Declarative restriction description, backed by enforced runner behavior. */
  readonly capabilities: { filesystem: 'isolated'; tools: 'allowlist'; network: 'model-only'; recursiveEvolution: false; toolDescriptions?: readonly string[]; loaderVersion?: string }
  run(input: {
    task: TaskRun; candidate: Candidate; snapshotId: string; directory: string;
    maxTokens: number; maxOutputTokens?: number; maxSteps: number; timeoutMs: number; signal: AbortSignal
  }): Promise<Rollout>
}
