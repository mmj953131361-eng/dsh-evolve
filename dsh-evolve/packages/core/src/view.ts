/** User-facing state projection. The browser renders this contract, not internal counters. */
import type { AgentSnapshot } from './snapshot.js'
import type { TaskRun } from './lifecycle-types.js'

export interface ViewText { zh: string; en: string }
export interface EvolutionView {
  state: 'idle' | 'running' | 'queued' | 'learning' | 'kept-base' | 'selected' | 'pending-adoption' | 'failed' | 'paused'
  title: ViewText
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

export function taskTitle(prompt: string): string {
  const firstRequest = prompt.split(/\n\s*User update:\s*\n/)[0] ?? ''
  const clean = firstRequest.replace(/\s+/g, ' ').trim()
  const chars = [...clean]
  return chars.length <= 40 ? clean : chars.slice(0, 39).join('') + '…'
}

/** Only translate known causes; an advertised output ceiling is not proof it was reached. */
export function failureReason(detail: string): ViewText {
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
  const view: EvolutionView = {
    state: 'idle', title: message('准备好学习', 'Ready to learn'),
    taskTitle: taskTitle(task?.prompt || snapshot.task), strategy: context.baseline ? 'baseline' : 'revision', strategyVersion,
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
  if (jobFailed || observationFailed) {
    const detail = jobFailed ? job.reason : automation?.detail ?? ''
    const noRetry = automation?.status === 'budget-exhausted' || job?.status === 'budget-exhausted' || /budget.*exhaust|observation.*budget|snapshot|frozen.*input|source.*hash|local bound|401|403|unauthori|authentication/i.test(detail)
    return { ...view, state: 'failed', title: message('本次学习未完成', 'Learning did not finish'),
      summary: message('当前任务可以继续，当前策略没有因这次失败而改变。', 'Your task can continue. This failure has not changed the current strategy.'),
      reason: failureReason(detail), detail,
      primaryAction: noRetry ? job ? { kind: 'view-comparison', id: job.id } : null
        : jobFailed ? { kind: 'retry-experiment', id: job.id } : { kind: 'retry-observation' } }
  }
  const activeTask = task && ['active', 'awaiting-input'].includes(task.status)
  if (activeTask) return { ...view, state: 'running',
    title: task.status === 'awaiting-input' ? message('任务等待你的回复', 'Task awaiting your reply')
      : automation?.status === 'checking-completion' ? message('正在核对任务是否完成', 'Checking task completion') : message('任务进行中', 'Task in progress'),
    summary: job?.status === 'running'
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
    summary: message('本次没有发现可靠优于原策略的候选，已保留原策略。', 'No candidate was reliably better in this comparison. The original strategy was retained.'),
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
