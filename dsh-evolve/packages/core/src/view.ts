/** User-facing state projection. The browser renders this contract, not internal counters. */
import type { AgentSnapshot } from './snapshot.js'
import type { TaskRun } from './lifecycle-types.js'

export interface ViewText { zh: string; en: string }
export interface EvolutionView {
  state: 'idle' | 'running' | 'queued' | 'learning' | 'kept-base' | 'selected' | 'pending-adoption' | 'failed' | 'timed-out' | 'output-limited' | 'format-failed' | 'cancelled' | 'paused'
  title: ViewText
  /** Persistent convergence of the session/workspace work, not the first prompt. */
  workstreamTitle?: string
  taskTitle: string
  strategy: 'baseline' | 'revision'
  strategyVersion: number | null
  summary: ViewText
  reason: ViewText | null
  /** Technical evidence belongs only in explicitly opened diagnostics. */
  detail: string | null
  primaryAction: null | { kind: 'review-adoption' | 'view-comparison' | 'view-changes' | 'retry-observation' | 'retry-experiment'; id?: string; contentHash?: string }
  pendingCount: number
  learningCount: number
  candidateCount: number
  updatedAt: string | null
  adoptionId?: string
  experimentId?: string
  canUndo: boolean
  activation?: 'next-request' | 'new-session' | 'restart' | 'manual'
}

const message = (zh: string, en: string): ViewText => ({ zh, en })
const newest = <T>(items: readonly T[], at: (item: T) => string | undefined): T | undefined =>
  [...items].sort((a, b) => (at(b) ?? '').localeCompare(at(a) ?? ''))[0]

export function truncateUnicode(text: string, max = 40): string {
  const chars = [...text]
  return chars.length <= max ? text : chars.slice(0, Math.max(0, max - 1)).join('') + '…'
}

export function compactText(text: string, max = 80): string {
  return truncateUnicode(text.replace(/\s+/g, ' ').trim(), max)
}

export function taskTitle(prompt: string): string {
  const firstRequest = prompt.split(/\n\s*User update:\s*\n/)[0] ?? ''
  return compactText(firstRequest.replace(/\s+/g, ' ').trim(), 40)
}

const CONTINUATION = /^(?:(?:继续|下一步|接着)(?:处理)?(?:下一|后续|当前)?(?:阶段|步|任务)?|然后|好的?|可以|完成|开始|next|continue(?: (?:to )?the next phase)?|go on|done|ok(?:ay)?)[。.!！?？\s]*$/i

/**
 * Derive a stable, user-facing workstream title from the latest meaningful
 * request. Pure continuations keep the previous request; code fences and
 * paths are removed so the title does not become an instruction dump.
 */
export function isContinuationText(text: string): boolean {
  return CONTINUATION.test(text.trim())
}

export function deriveWorkstreamTitle(prompt: string, fallback = 'Current work'): string {
  const segments = prompt.split(/\n\s*User update:\s*\n/).map(value => value.trim()).filter(Boolean)
  const meaningful = [...segments].reverse().find(value => !CONTINUATION.test(value.replace(/[。.!！?？\s]+$/g, ''))) ?? segments.at(-1) ?? prompt
  const firstLine = meaningful.split(/\r?\n/).find(line => line.trim().length > 0) ?? meaningful
  const clean = firstLine.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ').replace(/\s+/g, ' ').trim()
  return compactText(clean || fallback, 40)
}

/** Only translate known causes; an advertised output ceiling is not proof it was reached. */
export function failureReason(detail: string): ViewText {
  if (/completion evidence failed exact citation validation/i.test(detail)) return message('完成核查的引用仍无法与实际交付物对应，任务尚未被判为完成。可以查看原因或重试核查。', 'Completion citations still do not match the actual deliverables. The task has not been accepted as complete; review the cause or retry verification.')
  if (/observation (?:repeatedly )?aborted upstream/i.test(detail)) return message('观察服务连续中断，自动重试后仍未恢复。已有需求和调用记录会保留，可以稍后重试。', 'The observation service kept interrupting requests after automatic retries. Existing requirements and call records are retained; you can retry later.')
  if (/Automatic task-observation call budget exhausted/i.test(detail)) return message('当前这版任务要求的观察次数已达上限。补充或修改要求后可继续观察，当前策略保持不变。', 'Observation reached the call limit for the current task requirements. Updated requirements can be observed; the current strategy is unchanged.')
  if (/Automatic task-observation token budget exhausted/i.test(detail)) return message('当前任务的观察 token 预算已用完，自动观察已暂停，当前策略保持不变。', 'This task used its observation token budget. Automatic observation is paused; the current strategy is unchanged.')
  if (/budget.*exhaust|exceed.*budget|预算.*耗尽/i.test(detail)) return message('本次学习已用完设定的预算，当前策略保持不变。', 'This learning attempt used its budget. The current strategy is unchanged.')
  if (/unknown external|interrupted external|in.flight|lost.*lease/i.test(detail)) return message('上次请求被中断，无法确认是否完成。重试可能产生额外消耗。', 'The previous request was interrupted and its outcome is unknown. Retrying may add cost.')
  if (/max[- ]?tokens|output limit reached|output.*limit.*exceed/i.test(detail)) return message('模型在输出完整结果前达到了单次输出限制。', 'The model reached its response limit before finishing.')
  if (/timeout|timed out/i.test(detail)) return message('后台请求超时，未完成这次学习。', 'A background request timed out before learning finished.')
  if (/unauthori|authentication|api.?key|401|403/i.test(detail)) return message('模型服务的授权未通过，需要检查模型配置。', 'Model authorization failed. Check the model configuration.')
  if (/429|rate.?limit/i.test(detail)) return message('模型服务暂时限流，可以稍后重试。', 'The model service is rate limited. Try again later.')
  if (/snapshot|frozen.*input|local bound|source.*hash/i.test(detail)) return message('无法取得完整、稳定的任务材料，暂时不能可靠重跑。', 'A complete, stable task snapshot is unavailable for a reliable rerun.')
  if (/budget|call.*limit/i.test(detail)) return message('本次自动观察已达到配置的限额。', 'Automatic observation reached its configured limit.')
  return message('后台检查未获得可用结果，当前策略保持不变。', 'The background check returned no usable result. The current strategy is unchanged.')
}

export function buildEvolutionView(snapshot: Omit<AgentSnapshot, 'view'>,
  context: { baseline: boolean; task?: TaskRun; agentStatus?: string; completedLearningCount?: number }): EvolutionView {
  const task = context.task
  const automation = !task || snapshot.automation?.taskId === task.id ? snapshot.automation : undefined
  const plans = snapshot.adoptions ?? []
  const pending = [...plans].filter(plan => plan.status === 'pending').sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  // A previous task's successful or failed experiment must not become this task's current status.
  const jobs = task ? snapshot.experiments.filter(job => job.taskId === task.id) : []
  const job = newest(jobs, item => item.endedAt ?? item.createdAt)
  const currentPlan = newest(plans.filter(plan => plan.scope === 'session' && plan.status === 'applied'
    && plan.appliedRevisionId === snapshot.revision), item => item.updatedAt)
  const ownApplied = plans.filter(plan => plan.scope === 'session' && (plan.status === 'applied' || plan.status === 'undone'))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const strategyVersion = !context.baseline && currentPlan ? ownApplied.findIndex(plan => plan.id === currentPlan.id) + 1 : null
  const recentPlan = newest(plans.filter(plan => ['applied', 'undone'].includes(plan.status)), item => item.updatedAt)
  const times = [task?.startedAt, task?.finishedAt, job?.endedAt, job?.createdAt, recentPlan?.updatedAt, pending[0]?.updatedAt]
    .filter((value): value is string => !!value).sort()
  const currentTitle = task?.title ?? taskTitle(task?.prompt || snapshot.task)
  const view: EvolutionView = {
    state: 'idle', title: message('准备好学习', 'Ready to learn'),
    workstreamTitle: snapshot.workstreamTitle ?? currentTitle,
    taskTitle: currentTitle, strategy: context.baseline ? 'baseline' : 'revision', strategyVersion,
    summary: message('正常布置任务即可。任务完成后会自动学习，只有需要确认改动时才通知你。', 'Give your task as usual. Evo learns after completion and asks when a change needs approval.'),
    reason: null, detail: null, primaryAction: null, pendingCount: pending.length,
    learningCount: context.completedLearningCount ?? snapshot.experiments.filter(item => ['selected', 'kept-base'].includes(item.status)).length,
    candidateCount: job?.candidates.filter(candidate => candidate.kind !== 'baseline').length ?? 0,
    updatedAt: times.at(-1) ?? null, canUndo: !!currentPlan?.canUndo,
    ...(currentPlan ? { adoptionId: currentPlan.id, activation: currentPlan.activation } : {}),
    ...(job ? { experimentId: job.id } : {}),
  }
  if (!snapshot.enabled) return { ...view, state: 'paused', title: message('已暂停学习', 'Learning paused'),
    summary: message('已停止学习并暂不加载 Evo 会话覆盖，策略版本仍保留。可从右上角菜单恢复；已取消的实验不会自动重启。', 'Learning is stopped and Evo session overrides are inactive. Saved versions are retained. Resume from the menu; cancelled experiments do not restart automatically.') }
  if (pending[0]) {
    const plan = pending[0]
    return { ...view, state: 'pending-adoption', title: message(`有 ${pending.length} 项改动待确认`, `${pending.length} change${pending.length > 1 ? 's' : ''} awaiting review`),
      summary: message('这些改动尚未应用。查看影响范围和变化后再决定；暂不处理会保留当前策略。', 'These changes have not been applied. Review their scope and diff; postponing keeps the current strategy.'),
      primaryAction: { kind: 'review-adoption', id: plan.id, contentHash: plan.contentHash }, adoptionId: plan.id,
      activation: plan.activation, canUndo: false }
  }
  const observationFailed = context.agentStatus !== 'running' && ['paused', 'failed', 'budget-exhausted', 'pending-validation'].includes(automation?.status ?? '')
  const jobFailed = job && ['failed', 'budget-exhausted', 'pending-validation'].includes(job.status)
  const activeTask = task && ['active', 'awaiting-input'].includes(task.status)
  if (task?.status === 'cancelled') return { ...view, state: 'cancelled',
    title: message('已随任务取消观察', 'Observation stopped with the task'),
    summary: message('本任务的后台观察已停止，不会继续重试或进入学习队列。调用用量尚未确认时会保留预留费用，这不表示仍在运行。', 'Background observation for this task has stopped and will not retry or queue learning. Unknown usage remains reserved; it does not mean a call is still running.'),
    primaryAction: null, canUndo: false }
  if (automation?.status === 'format-failed' && activeTask && !jobFailed) return { ...view, state: 'format-failed',
    title: message('模型响应格式修复未成功', 'Model response format recovery failed'),
    summary: message('一次自动格式重试后仍未得到有效 JSON。已核验的需求和证据会保留；下一条消息或重试可继续，尚未确认任务完成。', 'One automatic format retry did not produce valid JSON. Verified requirements and evidence are retained. Your next message or a retry can resume; completion is not confirmed.'),
    detail: automation.detail ?? null, primaryAction: { kind: 'retry-observation' } }
  if (automation?.status === 'output-limited' && activeTask && !jobFailed) return { ...view, state: 'output-limited',
    title: message('完成核查需要继续', 'Completion check needs to continue'),
    summary: message('模型输出达到上限，尚未确认任务完成。已核验的分片和需求会保留；下一条消息或重试可接续未完成的核查。', 'The model reached its output limit; task completion is not confirmed. Verified batches and requirements are saved. Your next message or a retry can resume unfinished checks.'),
    detail: automation.detail ?? null, primaryAction: { kind: 'retry-observation' } }
  if (automation?.status === 'timed-out' && activeTask && !jobFailed) return { ...view, state: 'timed-out',
    title: message('观察暂时超时', 'Observation timed out'),
    summary: message('已完成的需求、完成核查分片与引用会保留。下一条用户消息或手动重试可接续剩余观察，当前策略保持不变。', 'Completed requirement batches and citations are retained. Your next message or a manual retry can resume the remaining observation. The current strategy is unchanged.'),
    detail: automation.detail ?? null, primaryAction: { kind: 'retry-observation' } }
  if (jobFailed || observationFailed) {
    const detail = jobFailed ? job.reason : automation?.detail ?? ''
    const noRetry = automation?.status === 'budget-exhausted' || job?.status === 'budget-exhausted' || /budget.*exhaust|observation.*budget|snapshot|frozen.*input|source.*hash|local bound|401|403|unauthori|authentication/i.test(detail)
    return { ...view, state: 'failed', title: message('本次学习未完成', 'Learning did not finish'),
      summary: message('当前任务可以继续，当前策略没有因这次失败而改变。', 'Your task can continue. This failure has not changed the current strategy.'),
      reason: failureReason(detail), detail,
      primaryAction: noRetry ? job ? { kind: 'view-comparison', id: job.id } : null
        : jobFailed ? { kind: 'retry-experiment', id: job.id } : { kind: 'retry-observation' } }
  }
  if (activeTask) return { ...view, state: 'running',
    title: automation?.status === 'repairing-format' ? message('正在修复模型响应格式', 'Recovering model response format')
      : automation?.status === 'repairing-evidence' ? message('正在校正完成证据', 'Checking completion citations')
      : automation?.status === 'retrying' ? message('观察中断，正在自动重试', 'Observation interrupted; retrying automatically')
      : automation?.status === 'input-updated' ? message('要求已更新，正在重新观察', 'Requirements updated; resuming observation')
      : task.status === 'awaiting-input' ? message('任务等待你的回复', 'Task awaiting your reply')
      : automation?.status === 'checking-completion' ? message('正在核对任务是否完成', 'Checking task completion') : message('任务进行中', 'Task in progress'),
    summary: automation?.status === 'repairing-format' ? message('正在根据同一份材料重新生成有效 JSON；不会更改验收要求，也不会接受不完整的结果。', 'Regenerating valid JSON from the same evidence. Acceptance criteria remain unchanged; incomplete responses are not accepted.')
      : automation?.status === 'repairing-evidence' ? message('正在重新核对交付物引用；只有证据检查通过，才会开始后台学习。', 'Deliverable citations are being checked again. Background learning starts only after the evidence is accepted.')
      : automation?.status === 'retrying' ? message('已有需求证据会保留，正在重试后台观察；你可以继续工作。', 'Existing requirement evidence is retained while background observation retries. You can continue working.')
      : automation?.status === 'input-updated' ? message('旧输入的观察已停止，将按最新要求继续；无需手动重试。', 'Observation of the old input stopped and will resume for the latest requirements. No manual retry is needed.')
      : job?.status === 'running'
      ? message('任务继续进行，后台正在比较策略；目前无需操作。', 'Your task continues while strategies are compared in the background. No action is needed.')
      : message('任务完成后会自动学习，目前不需要操作进化面板。', 'Learning starts automatically after completion. No action is needed in this panel.') }
  if (job?.status === 'running') return { ...view, state: 'learning', title: message('正在比较改进策略', 'Comparing strategies'),
    summary: message('正在独立重跑和比较候选。还没有结论，你可以继续工作。', 'Candidates are being rerun and compared independently. There is no result yet; you can keep working.') }
  if (job?.status === 'queued') return { ...view, state: 'queued', title: message('等待开始学习', 'Waiting to learn'),
    summary: message('任务已进入后台学习队列，尚未开始执行。', 'The task is queued for background learning. Execution has not started.') }
  if (recentPlan?.status === 'undone' && (!task || recentPlan.updatedAt >= task.startedAt) && (!job || recentPlan.updatedAt >= (job.endedAt ?? job.createdAt))) return { ...view, state: 'kept-base',
    title: message('已回退策略', 'Strategy rolled back'),
    summary: recentPlan.scope === 'project'
      ? message('项目文件已恢复，新会话会读取恢复后的内容；已加载的会话和历史不会被重写。', 'Project files were restored. New sessions load the restored content; loaded sessions and history are unchanged.')
      : recentPlan.scope === 'profile'
        ? message('配置文件已恢复，需通过配置重载或重启加载；尚未确认所有 Agent 已恢复。', 'Configuration files were restored. Load through configuration reload or restart; restoration in every Agent is not confirmed.')
        : message('已撤销这次改动，后续请求使用恢复后的策略；已载入对话历史的内容会保留。', 'The change was undone. Subsequent requests use the restored strategy; content already in conversation history remains.'),
    canUndo: false }
  if (recentPlan?.status === 'applied' && recentPlan.scope !== 'session' && (!task || recentPlan.updatedAt >= task.startedAt)
    && (!job || recentPlan.updatedAt >= (job.endedAt ?? job.createdAt))) {
    return { ...view, state: 'selected', title: recentPlan.scope === 'project' ? message('项目改进已保存', 'Project change saved') : message('Profile 改进已保存', 'Profile change saved'),
      summary: recentPlan.scope === 'project' ? message('新会话会读取这次项目改动；当前会话是否已加载还需核对。', 'New sessions load the project change. Loading in this session still needs verification.')
        : message('配置重载或重启后加载；保存文件不代表所有 Agent 已生效。', 'Load through configuration reload or restart. Saved files do not confirm activation in every Agent.'),
      primaryAction: { kind: 'view-changes', id: recentPlan.id, contentHash: recentPlan.contentHash }, adoptionId: recentPlan.id,
      activation: recentPlan.activation, canUndo: !!recentPlan.canUndo }
  }
  if (job?.status === 'kept-base') return { ...view, state: 'kept-base',
    title: context.baseline ? message('已保留基线', 'Baseline retained') : message('已保留当前策略', 'Current strategy retained'),
    summary: job.comparison?.heldOutEffect === 'vetoed'
      ? message('候选在训练输入上被选中，但在没有对话历史的新输入上表现不如原策略，已保留原策略。', 'A candidate was chosen on the training input, but on a fresh input without the conversation it did worse than the original, so the original was retained.')
      : job.heldOut?.status === 'verified'
        ? message('候选在新输入上没有表现出可靠的优势，已保留原策略。', 'No candidate showed a reliable advantage on a fresh input. The original strategy was retained.')
        : message('本次没有发现可靠优于原策略的候选，已保留原策略。', 'No candidate was reliably better in this comparison. The original strategy was retained.'),
    primaryAction: { kind: 'view-comparison', id: job.id } }
  if (job?.status === 'selected') {
    if (currentPlan && currentPlan.sourceEpisodeIds?.includes(job.id)) return { ...view, state: 'selected',
      title: context.baseline ? message('已采用基线策略', 'Baseline strategy adopted')
        : message(`已采用新策略 v${strategyVersion}`, `New strategy v${strategyVersion} adopted`),
      summary: message('当前任务的后续模型请求会使用新策略；已经发出的请求和交付物不会被重写。', 'Subsequent model requests for this task use the new strategy. Sent requests and deliverables are unchanged.'),
      primaryAction: { kind: 'view-changes', id: currentPlan.id, contentHash: currentPlan.contentHash } }
    return { ...view, state: 'selected', title: message('已选出候选，尚未应用', 'Candidate selected, not yet applied'),
      summary: message('后台比较已选出候选，尚未确认它在当前会话中生效。', 'The comparison selected a candidate. Adoption in this session is not confirmed.'),
      primaryAction: { kind: 'view-comparison', id: job.id }, canUndo: false }
  }
  if (job && ['cancelled', 'stale'].includes(job.status)) return { ...view, state: 'kept-base',
    title: message('本次学习已停止', 'Learning stopped'),
    summary: message('本次学习没有应用新的策略；可在学习记录中查看原因。', 'This attempt did not apply a new strategy. See learning history for the reason.'),
    primaryAction: { kind: 'view-comparison', id: job.id } }
  if (task?.status === 'completed') return { ...view, state: 'idle', title: message('任务已完成', 'Task completed'),
    summary: message('还没有开始学习；建立可重跑的任务证据后会自动比较策略。', 'Learning has not started. Strategies can be compared once repeatable task evidence is available.') }
  return view
}
