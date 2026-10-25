/**
 * Evolve Web panel, browser half.
 *
 * Plain DOM (no React, no shared modules) so the bundle is self-contained.
 * The Host half serves /evolve/state, /evolve/diff, and /evolve/action.
 */
window.__ModuleLoader__.load({
  id: '__PLUGIN_ID__',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports


    const LOCALES = {
      en: {
        overview: 'Overview',
        records: 'Learning history',
        changeTab: 'Changes',
        experienceTab: 'Experience',
        details: 'View details',
        compact: 'Back to status',
        more: 'More options',
        language: 'Language',
        automaticLanguage: 'System language',
        currentTask: 'Current task',
        chooseSession: 'Choose a session',
        currentStrategy: 'Current approach',
        baseline: 'Baseline',
        revisionStrategy: 'New approach v',
        customStrategy: 'Custom strategy',
        versionHistory: 'Strategy version history',
        notExecuted: 'Not executed',
        componentInvalid: 'Component checks did not pass',
        checksPass: 'passed',
        checksFail: 'did not pass',
        checksUnknown: 'unknown',
        notLearned: 'No learning runs yet',
        learningRuns: 'Learning runs',
        candidateCount: 'Candidates generated',
        resourceUse: 'Resource use',
        processingTokens: 'Processing tokens', settledTokens: 'Settled tokens', unknownTokens: 'Unconfirmed reservation', tokenBreakdown: 'Tokens by stage',
        viewComparison: 'View comparison',
        viewChanges: 'View changes',
        reviewConfirm: 'Review and confirm',
        defer: 'Not now',
        statusUnavailable: 'Status unavailable',
        incompatibleHost: 'Evo is disabled because its host APIs are incompatible. DSH can continue.',
        waitingHost: 'Evo is waiting for host services.',
        upgradeHost: 'Update the Evo host to show its current status.',
        noCurrentSession: 'Choose a conversation to view its Evo status.',
        diagnostics: 'Diagnostics',
        technicalReason: 'Technical details',
        noRecords: 'Learning records will appear here.',
        noChangesNew: 'There are no harness changes yet.',
        noExperience: 'No reusable experience has been recorded yet.',
        pendingChanges: 'Needs your review',
        appliedChanges: 'Applied changes',
        otherChanges: 'Earlier changes',
        notApplied: 'Not applied',
        newLearning: 'Try another improvement',
        reflectTask: 'Review this task',
        pauseLearning: 'Pause learning',
        pauseImpact: 'This cancels workspace experiments and temporarily unloads Evo session overrides. Saved versions remain available when you resume.',
        confirmPause: 'Pause and unload overrides',
        resumeLearning: 'Resume learning',
        scopeLabel: 'Applies to',
        counterEvidence: 'Counter-evidence',
        noCounterEvidence: 'No counter-evidence recorded',
        lesson: 'What was learned',
        hypothesis: 'Needs validation',
        taskValidated: 'Supported on this task',
        transferSupported: 'Supported across tasks',
        revoked: 'Withdrawn',
        candidateBaseline: 'Baseline',
        candidateInvariant: 'General strategy',
        candidateDomain: 'Task-specific strategy',
        candidateCompose: 'Combined strategy',
        candidateReuse: 'Reused strategy',
        candidate: 'Candidate',
        winner: 'Selected',
        eligible: 'Eligible for comparison',
        ineligible: 'Not eligible for comparison',
        eligibilityUnknown: 'Eligibility not available',
        completed: 'Completed',
        failed: 'Did not finish',
        running: 'Running',
        queued: 'Queued',
        cancelled: 'Stopped',
        keptBase: 'Kept the baseline',
        selected: 'Selection completed',
        pendingValidation: 'Awaiting validation',
        budgetExhausted: 'Budget reached',
        created: 'Recorded',
        comparison: 'Execution comparison',
        activationShort: 'Activation',
        limitStopped: 'Stopped at a run limit',
        checks: 'Checks',
        added: 'Added',
        removed: 'Removed',
        changed: 'Changed',
        pendingStatus: 'Awaiting review',
        appliedStatus: 'Applied',
        rejectedStatus: 'Kept current setup',
        staleStatus: 'Expired',
        jobs: 'Experiments', run: 'Run', cancel: 'Cancel', resume: 'Resume', revoke: 'Revoke', experienceState: 'Evidence level', button: 'Evolve', title: 'DSH Evolve', refresh: 'Refresh',
        noAgent: 'No live agent. Open a session, then refresh.',
        enabled: 'enabled', revision: 'revision', recommended: 'recommended strategy', level: 'level', task: 'task', step: 'step',
        evolutions: 'evolutions', tokens: 'tokens',
        off: 'Turn off', on: 'Turn on', propose: 'Propose', rollback: 'Rollback', reflect: 'Reflect',
        timeline: 'Timeline', diff: 'Diff', pending: 'Pending', library: 'Library',
        noRevisions: 'No revisions yet.', pickRevision: 'Pick a revision from Timeline.',
        noDiff: 'No tree differences.', current: 'current', vs: 'vs',
        verified: 'verified', rejected: 'rejected',
        approve: 'Approve', reject: 'Reject', promote: 'Promote',
        noCandidates: 'No candidates.', noLibrary: 'No Library entries.',
        confidence: 'confidence', uses: 'uses', rollBack: 'Roll back',
        adoptions: 'Improvements', review: 'Review suggestion', reviewTitle: 'A reusable improvement', noAdoptions: 'No changes need your attention.',
        scope: 'Scope', session: 'Session', reason: 'Why change', evidence: 'Execution evidence', activation: 'Takes effect', nextRequest: 'Prompt and catalog update on the next model request',
        undo: 'How to undo', later: 'Later', acceptChange: 'Apply', rejectChange: 'Keep current setup', before: 'Before', after: 'After',
        pendingNotice: 'Your current setup stays in place until you apply this suggestion.', closedNotice: 'This suggestion has changed or is no longer waiting for review.',
        learning: 'Learning', kept: 'Keeping current setup', improved: 'Improved', paused: 'Paused', attention: 'Needs attention', suggestions: 'Suggestion ready',
        learningTitle: 'Learning from your work', learningBody: 'Evo checks promising ideas in the background. You can keep working.',
        keptTitle: 'Your current approach stays in place', keptBody: 'The comparison did not establish a better option.',
        improvedTitle: 'An improvement is in use', improvedBody: 'Session improvements are applied quietly. You can undo them here.',
        saved: 'Saved', sharedAppliedTitle: 'The improvement has been saved', sharedAppliedBody: 'Follow the activation details to load it. Saving files does not confirm runtime loading; you can undo this change.',
        pausedTitle: 'Learning is paused', pausedBody: 'Your current work can continue. Turn learning on when you are ready.',
        watchingBody: 'Evo will look for improvements as you work. Nothing needs your attention.',
        suggestionTitle: 'A reusable improvement is ready', suggestionBody: 'Review where it applies before making a wider change.',
        suggestedFor: 'Suggested for', expected: 'Expected benefit', expectedUnknown: 'Potential benefit still needs validation in this scope.',
        project: 'This project', profile: 'This profile', directory: 'Directory', files: 'Files that change', fileUnit: 'file(s)', otherSessions: 'Other sessions', projects: 'Projects',
        changeInstruction: 'Instructions', changeSkill: 'Skill', changeMemory: 'Memory', changeProjectInstruction: 'Project instructions', changeProfileConfig: 'Profile config',
        impactSession: 'Only the current session; undo restores the previous prompt and catalog.',
        impactProject: 'New sessions in this project load the managed instructions and skills; already loaded sessions are not guaranteed to refresh.',
        impactProfile: 'Agent scopes that inherit this profile are affected, including projects not open here. Saved files do not prove activation.',
        activationNextRequestDetail: 'Prompt and skill catalog update on the next request; skill bodies load on demand. Existing conversation history is not rewritten.',
        activationNewSessionDetail: 'New sessions in this project load the change; the current session is not guaranteed to refresh.',
        activationRestartDetail: 'Requires a profile reload or restart. File persistence does not confirm every Agent has loaded it.',
        activationManualDetail: 'Requires a separate activation step; saved files are not enough.',
        rollbackDetail: 'Undo restores only these managed files. User edits made after the change are preserved; history is not rewritten.',
        scopeUnknown: 'The full impact is not available. Review the target before applying.', noOtherSessions: 'No other currently known sessions.', noOtherProjects: 'No other currently known projects.',
        profileNote: 'This changes a shared profile. Keep the current setup unless you want the change to apply across its projects.',
        confirmScope: 'I understand and confirm the affected scope', viewDiff: 'View diff', verification: 'Why this suggestion was made',
        autoNotice: 'A session improvement is now in use', undoChange: 'Undo', undone: 'Undone', undoDone: 'The previous approach has been restored.', undoBody: 'You undid the improvement. Evo will keep learning from your work.',
        learnNow: 'Learn this phase',
        dismissNotice: 'Dismiss notification', close: 'Close', advanced: 'Run details', status: 'Status',
        failureTitle: 'A background check could not finish', failureBody: 'Your foreground work can continue. Review the details or retry when ready.',
        retry: 'Retry', offlineTitle: 'Evo cannot refresh its status', offlineBody: 'The connection may have changed. No action is needed to continue your work.',
        changes: 'Recent improvements', noChanges: 'No changes have been applied yet.', source: 'Review details',
        newSession: 'When a new session starts', restart: 'After restarting the runtime', manualActivation: 'After a separate activation step',
      },
      zh: {
        overview: '概览',
        records: '学习记录',
        changeTab: '变化',
        experienceTab: '经验',
        details: '查看详情',
        compact: '返回状态',
        more: '更多选项',
        language: '语言',
        automaticLanguage: '跟随系统',
        currentTask: '当前任务',
        chooseSession: '选择会话',
        currentStrategy: '当前策略',
        baseline: '基线',
        revisionStrategy: '新策略 v',
        customStrategy: '自定义策略',
        versionHistory: '策略版本记录',
        notExecuted: '未执行',
        componentInvalid: '未通过组件检查',
        checksPass: '通过',
        checksFail: '未通过',
        checksUnknown: '未知',
        notLearned: '尚未学习',
        learningRuns: '学习次数',
        candidateCount: '生成候选',
        resourceUse: '学习消耗',
        processingTokens: '处理 token', settledTokens: '已结算 token', unknownTokens: '未确认预留', tokenBreakdown: '各阶段 token',
        viewComparison: '查看比较',
        viewChanges: '查看变化',
        reviewConfirm: '查看并确认',
        defer: '暂不处理',
        statusUnavailable: '状态不可用',
        incompatibleHost: 'Evo 与当前宿主 API 不兼容，已停用。DSH 可以继续使用。',
        waitingHost: 'Evo 正在等待宿主服务。',
        upgradeHost: '请更新 Evo 宿主以显示当前状态。',
        noCurrentSession: '选择一个会话，查看它的 Evo 状态。',
        diagnostics: '诊断信息',
        technicalReason: '技术原因',
        noRecords: '开始学习后，记录会显示在这里。',
        noChangesNew: '目前还没有 harness 变化。',
        noExperience: '目前还没有可复用的经验。',
        pendingChanges: '待处理',
        appliedChanges: '已采用的变化',
        otherChanges: '历史变化',
        notApplied: '尚未应用',
        newLearning: '重新发起学习',
        reflectTask: '复盘当前任务',
        pauseLearning: '暂停学习',
        pauseImpact: '这会取消工作区的后台实验，并暂时停用 Evo 会话覆盖。已有版本会保留，重新开启时恢复。',
        confirmPause: '暂停并停用会话优化',
        resumeLearning: '继续学习',
        scopeLabel: '适用范围',
        counterEvidence: '反例',
        noCounterEvidence: '暂无已记录的反例',
        lesson: '经验内容',
        hypothesis: '待验证假设',
        taskValidated: '本任务已验证',
        transferSupported: '跨任务有支持',
        revoked: '已撤回',
        candidateBaseline: '基线',
        candidateInvariant: '通用策略',
        candidateDomain: '领域策略',
        candidateCompose: '合成策略',
        candidateReuse: '复用策略',
        candidate: '候选',
        winner: '被选中',
        eligible: '可参与比较',
        ineligible: '不参与比较',
        eligibilityUnknown: '尚无参选结论',
        completed: '已完成',
        failed: '未完成',
        running: '执行中',
        queued: '排队中',
        cancelled: '已停止',
        keptBase: '保留基线',
        selected: '已完成选择',
        pendingValidation: '待验证',
        budgetExhausted: '达到预算上限',
        created: '记录时间',
        comparison: '执行比较',
        activationShort: '生效方式',
        limitStopped: '在执行额度处停止',
        checks: '检查',
        added: '新增',
        removed: '删除',
        changed: '修改',
        pendingStatus: '待确认',
        appliedStatus: '已采用',
        rejectedStatus: '保持现状',
        staleStatus: '已过期',
        jobs: '改进实验', run: '执行', cancel: '取消', resume: '恢复', revoke: '撤回', experienceState: '证据等级', button: '进化', title: 'DSH 进化', refresh: '刷新',
        noAgent: '没有活动 Agent。打开一个会话后刷新。',
        enabled: '启用', revision: '版本', recommended: '推荐策略', level: '层级', task: '任务', step: '步',
        evolutions: '进化次数', tokens: 'token',
        off: '关闭', on: '开启', propose: '提议进化', rollback: '回滚', reflect: '反思',
        timeline: '时间线', diff: '差异', pending: '待审批', library: '经验库',
        noRevisions: '暂无 Revision。', pickRevision: '从时间线选择一条 Revision。',
        noDiff: '没有文件差异。', current: '当前', vs: '对比',
        verified: '已验证', rejected: '已拒绝',
        approve: '批准', reject: '拒绝', promote: '晋升',
        noCandidates: '暂无候选。', noLibrary: '经验库为空。',
        confidence: '置信度', uses: '使用次数', rollBack: '回滚到此处',
        adoptions: '优化记录', review: '查看建议', reviewTitle: '发现一个可复用改进', noAdoptions: '暂时没有需要你确认的优化。',
        scope: '作用范围', session: '会话', reason: '优化原因', evidence: '执行证据', activation: '生效时机', nextRequest: '下一请求更新提示和目录',
        undo: '撤回方式', later: '稍后', acceptChange: '应用', rejectChange: '保持现状', before: '修改前', after: '修改后',
        pendingNotice: '应用前会保持当前设置。关闭此窗口不会应用优化。', closedNotice: '建议已经变化，或已不再等待确认。',
        learning: '学习中', kept: '保留当前', improved: '已优化', paused: '已暂停', attention: '需要留意', suggestions: '有优化建议',
        learningTitle: '正在从你的工作中学习', learningBody: 'Evo 会在后台验证有潜力的方法，你可以继续工作。',
        keptTitle: '这次保留当前方式', keptBody: '对比还不足以证明新方法更好。',
        improvedTitle: '一个改进已经生效', improvedBody: '会话内的优化会安静地应用，你随时可以撤销。',
        saved: '已保存', sharedAppliedTitle: '优化已经保存', sharedAppliedBody: '请按生效方式加载；文件已保存不代表运行时已加载，你仍可撤销这次改动。',
        pausedTitle: '已暂停学习', pausedBody: '当前工作可以继续，需要时再开启。',
        watchingBody: 'Evo 会在你工作时寻找改进，目前无需你处理。',
        suggestionTitle: '发现一个可复用改进', suggestionBody: '扩大应用范围前，请先看一下它会影响哪里。',
        suggestedFor: '建议应用到', expected: '预计效果', expectedUnknown: '在这个范围内的收益仍需验证。',
        project: '当前项目', profile: '当前 Profile', directory: '项目目录', files: '修改的文件', fileUnit: '个文件', otherSessions: '其他会话', projects: '涉及的项目',
        changeInstruction: '行为指引', changeSkill: '技能', changeMemory: '记忆', changeProjectInstruction: '项目指令', changeProfileConfig: 'Profile 配置',
        impactSession: '只影响当前会话；撤销后恢复之前的提示和目录。',
        impactProject: '本项目的新会话会加载受管指令和技能；已经加载的会话不保证刷新。',
        impactProfile: '影响继承该 Profile 的 Agent，包括当前没有打开的项目。文件写入成功不代表已经加载。',
        activationNextRequestDetail: '下一请求更新提示和技能目录；技能正文按需加载。已有对话历史不会被重写。',
        activationNewSessionDetail: '本项目的新会话会加载这次改动；当前会话不保证刷新。',
        activationRestartDetail: '需要重载 Profile 或重启。仅写入文件不能确认所有 Agent 已加载。',
        activationManualDetail: '需要单独的启用步骤，仅保存文件不够。',
        rollbackDetail: '撤销只恢复这些受管文件；改动后的用户编辑会保留，已有历史不会被重写。',
        scopeUnknown: '影响范围尚不完整，请先核对应用目标。', noOtherSessions: '没有其他已知的活动会话。', noOtherProjects: '没有其他已知的项目。',
        profileNote: '这会修改共享的 Profile。默认保持现状，确认后才会影响使用它的项目。',
        confirmScope: '我已了解并确认以上影响范围', viewDiff: '查看 diff', verification: '为什么建议这样改',
        autoNotice: '已应用一个会话内改进', undoChange: '撤销', undone: '已撤销', undoDone: '已恢复之前的方式。', undoBody: '你撤销了这次改进，Evo 会继续从后续工作中学习。',
        learnNow: '学习这个阶段',
        dismissNotice: '收起提示', close: '关闭', advanced: '查看运行详情', status: '状态',
        failureTitle: '一次后台验证未能完成', failureBody: '你可以继续当前工作，也可以查看原因或稍后重试。',
        retry: '重试', offlineTitle: '暂时无法刷新 Evo 状态', offlineBody: '连接可能发生了变化，不影响你继续工作。',
        changes: '最近的优化', noChanges: '目前还没有应用过改进。', source: '查看详情',
        newSession: '新会话启动时', restart: '重启运行实例后', manualActivation: '完成单独的启用步骤后',
      },
    }
    function pickLocale(language) {
      const languages = Array.isArray(language) ? language : language ? [language] : typeof navigator === 'undefined' ? ['en']
        : navigator.languages?.length ? navigator.languages : [navigator.language || 'en']
      for (const value of languages) {
        if (/^zh(?:-|$)/i.test(value)) return 'zh'
        if (/^en(?:-|$)/i.test(value)) return 'en'
      }
      return 'en'
    }

    const STYLE = `
      #dsh-evolve-button,#dsh-evolve-panel,#dsh-evolve-review,#dsh-evolve-toast{--ev-bg:#fff;--ev-subtle:#f6f7f8;--ev-text:#20252c;--ev-muted:#737c88;--ev-line:#e4e7eb;--ev-accent:#365dd8;--ev-soft:#eef2ff;--ev-warning:#9a671d;box-sizing:border-box;color:var(--ev-text);font:13px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif}
      #dsh-evolve-button{position:fixed;right:20px;top:72px;z-index:2147483000;display:flex;align-items:center;gap:8px;border:1px solid var(--ev-line);background:var(--ev-bg);border-radius:999px;padding:8px 13px;cursor:pointer;box-shadow:0 3px 14px #17202b0c;font-size:12px}
      #dsh-evolve-panel{position:fixed;right:20px;top:118px;width:min(380px,calc(100vw - 32px));max-height:calc(100vh - 140px);z-index:2147483000;display:flex;flex-direction:column;background:var(--ev-bg);border:1px solid var(--ev-line);border-radius:18px;box-shadow:0 18px 60px #11182720;overflow:hidden}
      #dsh-evolve-panel header{display:flex;align-items:center;gap:8px;padding:15px 18px;border-bottom:1px solid var(--ev-line)}
      #dsh-evolve-panel header strong{font-size:14px;flex:1;font-weight:600}
      .dsh-ev-btn{background:var(--ev-bg);color:var(--ev-text);border:1px solid var(--ev-line);border-radius:8px;padding:7px 11px;font:inherit;font-size:12px;cursor:pointer;line-height:1.35}
      .dsh-ev-btn:hover{background:var(--ev-subtle)}
      .dsh-ev-btn:focus-visible,.dsh-ev-tab:focus-visible{outline:2px solid var(--ev-accent);outline-offset:2px}
      .dsh-ev-btn.primary{background:var(--ev-accent);border-color:var(--ev-accent);color:white}
      .dsh-ev-btn.quiet{border-color:transparent;background:transparent;color:var(--ev-muted)}
      .dsh-ev-btn.danger{color:#bb3f48}
      .dsh-ev-btn:disabled{opacity:.45;cursor:default}
      #dsh-evolve-panel[data-detail="true"]{width:min(620px,calc(100vw - 32px))}
      #dsh-evolve-panel header{position:relative}
      .dsh-ev-status-card h3{font-size:17px;line-height:1.45;margin:4px 0 12px;font-weight:600;overflow-wrap:anywhere}
      .dsh-ev-status-card p{margin:9px 0;font-size:13px;line-height:1.7}
      .dsh-ev-strategy{font-size:12px;color:var(--ev-muted);display:flex;align-items:center;justify-content:space-between;gap:12px;margin:18px 0}
      .dsh-ev-strategy strong{color:var(--ev-text);font-weight:500}
      .dsh-ev-status-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:17px}
      .dsh-ev-status-actions .detail-link{margin-left:auto}
      .dsh-ev-menu{position:absolute;top:50px;right:14px;z-index:2;width:220px;background:var(--ev-bg);border:1px solid var(--ev-line);border-radius:12px;padding:6px;box-shadow:0 12px 40px #11182720}
      .dsh-ev-menu button{display:block;text-align:left;width:100%;border:0;padding:9px 10px}
      .dsh-ev-menu label{display:flex;align-items:center;justify-content:space-between;padding:9px 10px;gap:9px;border-top:1px solid var(--ev-line);font-size:12px}
      .dsh-ev-menu select{max-width:125px;padding:4px;background:var(--ev-bg);color:var(--ev-text);border:1px solid var(--ev-line);border-radius:6px}
      .dsh-ev-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;padding:0 12px;margin:0;border-bottom:1px solid var(--ev-line)}
      .dsh-ev-tab{border:0;border-bottom:2px solid transparent;border-radius:0;background:none;padding:12px 3px;font-size:12px;white-space:nowrap;color:var(--ev-muted)}
      .dsh-ev-tab.active{color:var(--ev-accent);border-bottom-color:var(--ev-accent);background:none}
      .dsh-ev-detail-heading{font-size:15px;margin:1px 0 14px;font-weight:600}
      .dsh-ev-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:15px 0;border-top:1px solid var(--ev-line);margin-top:20px}
      .dsh-ev-metrics span{display:block;font-size:11px;color:var(--ev-muted)}
      .dsh-ev-metrics strong{display:block;font-weight:550;margin-top:5px;font-size:15px}
      .dsh-ev-record{padding:14px 0;background:none;border:0;border-radius:0;border-bottom:1px solid var(--ev-line)}
      .dsh-ev-record:first-child{padding-top:0}
      .dsh-ev-record h4{font-size:13px;font-weight:550;margin:4px 0 8px;overflow-wrap:anywhere}
      .dsh-ev-record p{margin:7px 0;font-size:12px;line-height:1.65;overflow-wrap:anywhere}
      .dsh-ev-record-meta{display:flex;justify-content:space-between;gap:10px;font-size:11px;color:var(--ev-muted);flex-wrap:wrap}
      .dsh-ev-record details{margin-top:10px;font-size:12px}
      .dsh-ev-record summary{cursor:pointer;overflow-wrap:anywhere}
      .dsh-ev-diagnostic{font-size:11px;color:var(--ev-muted);margin-top:15px}
      .dsh-ev-diagnostic summary{cursor:pointer}
      .dsh-ev-pill{display:inline-block;border-radius:5px;padding:2px 6px;background:var(--ev-subtle);font-size:11px;color:var(--ev-muted)}
      .dsh-ev-candidate{padding:10px 0;border-top:1px solid var(--ev-line)}
      .dsh-ev-select{width:100%;margin:10px 0;background:var(--ev-bg);color:var(--ev-text);padding:8px;border:1px solid var(--ev-line);border-radius:8px;font:inherit}
      .dsh-ev-body{padding:18px;overflow:auto;overscroll-behavior:contain}
      .dsh-ev-hero{padding:2px 0 17px}
      .dsh-ev-eyebrow{display:flex;align-items:center;gap:7px;color:var(--ev-muted);font-size:11px;margin:0 0 8px}
      .dsh-ev-dot{width:7px;height:7px;border-radius:50%;background:#88929e;display:inline-block;flex:none}
      .dsh-ev-dot.learning{background:var(--ev-accent)}
      .dsh-ev-dot.improved{background:#368e69}
      .dsh-ev-dot.attention,.dsh-ev-dot.suggestions{background:#b7852f}
      .dsh-ev-hero h3{font-size:17px;line-height:1.4;letter-spacing:-.25px;margin:0 0 7px;font-weight:600}
      .dsh-ev-muted{color:var(--ev-muted);font-size:12px;line-height:1.65}
      .dsh-ev-hero p,.dsh-ev-card p{margin:5px 0}
      .dsh-ev-card{border:1px solid var(--ev-line);border-radius:12px;padding:14px;margin-bottom:12px;background:var(--ev-bg)}
      .dsh-ev-card.suggestion{background:var(--ev-soft)}
      .dsh-ev-card.warning{border-left:3px solid #b7852f}
      .dsh-ev-card strong{display:block;font-size:13px;font-weight:600;margin-bottom:6px}
      .dsh-ev-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}
      .dsh-ev-section-title{font-size:11px;color:var(--ev-muted);margin:18px 0 9px;font-weight:500}
      .dsh-ev-advanced{margin-top:18px;padding-top:14px;border-top:1px solid var(--ev-line)}
      .dsh-ev-advanced>summary{color:var(--ev-muted);cursor:pointer;font-size:12px}
      .dsh-ev-advanced>div{padding-top:14px}
      .dsh-ev-meta{display:flex;flex-wrap:wrap;gap:6px 12px;margin-bottom:12px;color:var(--ev-muted);font-size:11px}
      .dsh-ev-row{border-bottom:1px solid var(--ev-line);padding:10px 0;margin-bottom:4px}
      .dsh-ev-row .title{display:flex;gap:8px;align-items:center;justify-content:space-between}
      .dsh-ev-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;overflow-wrap:anywhere}
      .dsh-ev-pre{white-space:pre-wrap;word-break:break-word;background:var(--ev-subtle);border:1px solid var(--ev-line);border-radius:8px;padding:10px;margin:5px 0 10px;color:var(--ev-text);max-height:260px;overflow:auto;font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}
      .dsh-ev-error{color:#bc414b;font-size:12px;margin:8px 0}
      .dsh-ev-empty{color:var(--ev-muted);padding:8px 0;font-size:12px}
      #dsh-evolve-review{width:min(650px,calc(100vw - 32px));max-height:86vh;padding:24px;background:var(--ev-bg);border:1px solid var(--ev-line);border-radius:18px;box-shadow:0 24px 100px #11182730;overflow:auto;overscroll-behavior:contain}
      #dsh-evolve-review::backdrop{background:#10172355;backdrop-filter:blur(2px)}
      #dsh-evolve-review h2{margin:0 0 7px;font-size:21px;letter-spacing:-.4px;line-height:1.35;font-weight:600}
      #dsh-evolve-review details{margin:12px 0}
      #dsh-evolve-review summary{cursor:pointer;overflow-wrap:anywhere;font-size:12px}
      #dsh-evolve-review .dsh-ev-actions{position:sticky;bottom:-24px;background:var(--ev-bg);padding:17px 0 3px;border-top:1px solid var(--ev-line);margin-top:20px}
      .dsh-ev-facts{display:grid;grid-template-columns:100px minmax(0,1fr);gap:10px 16px;margin:19px 0;font-size:12px}
      .dsh-ev-facts dt{color:var(--ev-muted)}
      .dsh-ev-facts dd{margin:0;overflow-wrap:anywhere}
      .dsh-ev-check{display:flex;gap:10px;align-items:flex-start;background:var(--ev-subtle);border:1px solid var(--ev-line);border-radius:10px;padding:13px;margin-top:16px;font-size:12px}
      .dsh-ev-check input{margin:3px 0 0;accent-color:var(--ev-accent)}
      #dsh-evolve-toast{position:fixed;right:20px;bottom:65px;width:min(350px,calc(100vw - 32px));z-index:2147483001;background:var(--ev-bg);border:1px solid var(--ev-line);border-radius:12px;padding:14px 16px;box-shadow:0 10px 30px #11182715}
      #dsh-evolve-toast strong{font-weight:550;font-size:13px}
      #dsh-evolve-toast .dsh-ev-actions{margin-top:8px}
      @media(prefers-color-scheme:dark){#dsh-evolve-button,#dsh-evolve-panel,#dsh-evolve-review,#dsh-evolve-toast{--ev-bg:#202226;--ev-subtle:#272a2f;--ev-text:#e8eaed;--ev-muted:#a0a6af;--ev-line:#363a41;--ev-accent:#6489f0;--ev-soft:#262e43}}
      @media(max-width:520px){#dsh-evolve-review{padding:18px}.dsh-ev-facts{grid-template-columns:80px minmax(0,1fr)}#dsh-evolve-panel{right:16px}#dsh-evolve-review .dsh-ev-actions{bottom:-18px}}
    `

    function el(tag, attrs, children) {
      const node = document.createElement(tag)
      for (const [key, value] of Object.entries(attrs || {})) {
        if (key === 'text') node.textContent = value
        else if (key === 'class') node.className = value
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
        else node.setAttribute(key, value)
      }
      for (const child of children || []) {
        if (child != null) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
      }
      return node
    }

    function short(id) {
      return typeof id === 'string' && id.length > 10 ? id.slice(0, 10) : String(id ?? '-')
    }

    function apply(ctx) {
      if (typeof document === 'undefined' || document.body === null) return
      const style = el('style', { id: 'dsh-evolve-style', text: STYLE })
      document.head.appendChild(style)
      let languageMode = 'auto'
      try { const stored = localStorage.getItem('dsh-evolve-language'); if (['auto', 'zh', 'en'].includes(stored)) languageMode = stored } catch {}
      let language = languageMode === 'auto' ? pickLocale() : languageMode
      let L = LOCALES[language]
      let nativeLanguages = []
      let localeService
      let localeUnsubscribe
      try { localeService = ctx.get?.('locale') || ctx.locale } catch {}
      function updateLanguage() {
        let active
        try { active = localeService?.getLocale?.().active || localeService?.getSnapshot?.().active } catch {}
        const system = nativeLanguages.length ? nativeLanguages : active ? [active]
          : typeof navigator !== 'undefined' && navigator.languages?.length ? navigator.languages
          : typeof navigator !== 'undefined' && navigator.language ? [navigator.language] : [document.documentElement?.lang || 'en']
        language = languageMode === 'auto' ? pickLocale(system) : languageMode
        L = LOCALES[language]
        if (!disposed) { render(); if (review) renderReview() }
      }
      const button = el('button', { id: 'dsh-evolve-button', text: `◇ ${L.button}` })
      document.body.appendChild(button)

      let agents = []
      let selected = null
      let tab = 'overview'
      let detailsOpen = false
      let menuOpen = false
      let pauseConfirmation = false
      let diagnosticsOpen = false
      let manualSelection = false
      let nativeSessionId = null
      let sessionUnsubscribe
      let fallbackUnsubscribe
      let uiSessionPresent = false
      let fallbackSessions
      let sessionEpoch = 0
      let deferredAdoption = null
      let diff = null
      let error = ''
      let open = false
      let busy = false
      let refreshing = false
      let review = null
      let reviewLoading = false
      let reviewBusy = false
      let reviewError = ''
      let disposed = false
      let toastTarget = null
      let toastTimer
      let scopeConfirmed = false
      const seen = new Set()
      try { for (const key of JSON.parse(sessionStorage.getItem('dsh-evolve-reviewed') || '[]')) if (typeof key === 'string') seen.add(key) } catch {}
      const reviewKey = (agentId, plan) => `${plan.scope}:${plan.targetId || plan.targetSessionId || agentId}:${plan.id}:${plan.contentHash}`
      function rememberReview(key) {
        seen.add(key)
        try { sessionStorage.setItem('dsh-evolve-reviewed', JSON.stringify([...seen].slice(-200))) } catch {}
      }

      const panel = el('section', { id: 'dsh-evolve-panel' })
      panel.style.display = 'none'
      document.body.appendChild(panel)
      const dialog = el('dialog', { id: 'dsh-evolve-review', 'aria-labelledby': 'dsh-evolve-review-title' })
      document.body.appendChild(dialog)
      const toast = el('aside', { id: 'dsh-evolve-toast', role: 'status', 'aria-live': 'polite' })
      toast.style.display = 'none'
      document.body.appendChild(toast)
      dialog.addEventListener('cancel', event => { event.preventDefault(); closeReview() })
      dialog.addEventListener('close', () => { if (!dialog.open) { review = null; reviewError = '' } })

      async function request(path, init) {
        const response = await fetch(path, { credentials: 'same-origin', ...init })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error || body.detail || body.reason || `${response.status} ${response.statusText}`)
        return body
      }

      async function refresh() {
        if (refreshing || disposed) return
        refreshing = true
        const previous = JSON.stringify({ agents, selected, error })
        error = ''
        try {
          // Older independently installed UI packages have no compatibility route.
          const compatibilityResponse = await fetch('/evolve/compatibility')
          if (compatibilityResponse.ok) {
            const compatibility = await compatibilityResponse.json()
            if (compatibility.status === 'disabled') throw new Error(`${L.incompatibleHost} ${compatibility.reason || ''}`)
            if (compatibility.status === 'waiting') throw new Error(`${L.waitingHost} ${Object.entries(compatibility.components || {}).filter(([, state]) => state !== 'active').map(([name]) => name).join(', ')}`)
          }
          const body = await request('/evolve/state')
          if (disposed) return
          agents = Array.isArray(body.agents) ? body.agents : []
          if (nativeSessionId && !manualSelection) selected = agents.find(agent => agent.sessionId === nativeSessionId || agent.id === nativeSessionId)?.id ?? null
          else if (!manualSelection || !agents.some(agent => agent.id === selected)) selected = null
          if (review && !reviewBusy && review.plan.status === 'pending') {
            const latest = agents.find(agent => agent.id === review.agentId)?.adoptions?.find(plan => plan.id === review.plan.id)
            if (!latest || latest.status !== 'pending' || latest.contentHash !== review.plan.contentHash) {
              review.plan.status = latest?.contentHash === review.plan.contentHash ? latest.status : 'stale'
              reviewError = L.closedNotice
              renderReview()
            }
          }
          for (const agent of agents) {
            if (agent.id !== selected) continue
            const applied = [...agent.adoptions || []].reverse().find(plan => plan.scope === 'session' && plan.status === 'applied'
              && plan.adoptionMode !== 'review' && !seen.has(`notice:${reviewKey(agent.id, plan)}`)
              && Date.now() - Date.parse(plan.updatedAt || plan.createdAt) < 120000)
            if (applied) {
              rememberReview(`notice:${reviewKey(agent.id, applied)}`)
              showNotice(agent.id, applied)
              break
            }
          }
        } catch (cause) {
          error = cause instanceof Error ? cause.message : String(cause)
          agents = []
        } finally { refreshing = false }
        // Preserve focus, expanded details, and a click in progress when a poll has no new data.
        if (previous !== JSON.stringify({ agents, selected, error })) render()
        if (!review && !reviewLoading && !reviewBusy && !error && !disposed) {
          for (const agent of agents) {
            if (agent.id !== selected) continue
            const pending = (agent.adoptions || []).find(plan => plan.status === 'pending' && plan.scope !== 'session' && !seen.has(reviewKey(agent.id, plan)))
            if (pending) { void showReview(agent.id, pending.id); break }
          }
        }
      }

      function scopeName(plan) {
        if (plan.scope === 'profile') return plan.profileName ? `${L.profile} · ${plan.profileName}` : L.profile
        return plan.scope === 'project' ? L.project : L.session
      }
      function impactText(plan) { return plan.scope === 'project' ? L.impactProject : plan.scope === 'profile' ? L.impactProfile : L.impactSession }
      function activationDetailText(plan) {
        return plan.activation === 'new-session' ? L.activationNewSessionDetail
          : plan.activation === 'restart' ? L.activationRestartDetail
            : plan.activation === 'manual' ? L.activationManualDetail : L.activationNextRequestDetail
      }
      function changeKindName(kind) {
        return ({ instruction: L.changeInstruction, skill: L.changeSkill, memory: L.changeMemory,
          'project-instruction': L.changeProjectInstruction, 'profile-config': L.changeProfileConfig })[kind] || ''
      }

      function localized(value) { return typeof value === 'string' ? value : value?.[language] || value?.en || '' }
      function viewOf(agent) { return agent?.view || null }
      function statusTone(state) {
        return ['failed', 'timed-out', 'output-limited', 'format-failed'].includes(state) ? 'attention' : state === 'pending-adoption' ? 'suggestions'
          : state === 'selected' ? 'improved' : state === 'kept-base' ? 'kept' : state === 'paused' ? 'paused' : 'learning'
      }
      function strategyText(view) { return view.strategy === 'revision' ? view.strategyVersion == null ? L.customStrategy : `${L.revisionStrategy}${view.strategyVersion}` : L.baseline }
      function dateText(value) { return value ? new Date(value).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '' }
      function number(value) { return Number.isFinite(value) ? new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en-US', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value) : '—' }
      function statusText(status) { return ({ 'kept-base': L.keptBase, selected: L.selected, completed: L.completed, running: L.running, queued: L.queued, failed: L.failed, cancelled: L.cancelled, 'pending-validation': L.pendingValidation, 'budget-exhausted': L.budgetExhausted, pending: L.pendingStatus, applied: L.appliedStatus, rejected: L.rejectedStatus, stale: L.staleStatus, undone: L.undone })[status] || L.pendingValidation }

      function closeNotice() {
        clearTimeout(toastTimer)
        toastTarget = null
        toast.style.display = 'none'
      }

      function showNotice(agentId, plan) {
        clearTimeout(toastTimer)
        toastTarget = { agentId, plan }
        toast.replaceChildren(el('strong', { text: L.autoNotice }))
        toast.appendChild(el('div', { class: 'dsh-ev-actions' }, [
          plan.canUndo ? el('button', { class: 'dsh-ev-btn', text: L.undoChange, onclick: () => { void undoChange(agentId, plan) } }) : null,
          el('button', { class: 'dsh-ev-btn quiet', text: L.source, onclick: () => { closeNotice(); void showReview(agentId, plan.id) } }),
          el('button', { class: 'dsh-ev-btn quiet', text: L.close, 'aria-label': L.dismissNotice, onclick: closeNotice }),
        ]))
        toast.style.display = open ? 'none' : 'block'
        toastTimer = setTimeout(closeNotice, 12000)
      }

      async function undoChange(agentId, plan) {
        if (busy) return
        busy = true
        const buttons = [...toast.querySelectorAll('button'), ...panel.querySelectorAll('button')]
        buttons.forEach(item => { item.disabled = true })
        try {
          await request('/evolve/action', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dsh-evolve-action': '1' },
            body: JSON.stringify({ action: 'adoption-undo', agentId, id: plan.id, contentHash: plan.contentHash }) })
          closeNotice()
          closeReview()
          await refresh()
        } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); open = true; panel.style.display = 'flex'; render() }
        finally { busy = false; buttons.forEach(item => { item.disabled = false }); if (!disposed) render() }
      }

      function closeReview() {
        if (reviewBusy) return
        review = null
        reviewError = ''
        if (dialog.open) dialog.close()
      }

      async function showReview(agentId, id) {
        if (reviewLoading || reviewBusy || disposed) return
        reviewLoading = true
        const requestEpoch = sessionEpoch
        reviewError = ''
        try {
          const body = await request(`/evolve/adoption?agentId=${encodeURIComponent(agentId)}&id=${encodeURIComponent(id)}`)
          if (disposed || requestEpoch !== sessionEpoch || selected !== agentId) return
          review = { agentId, plan: body.plan, files: body.files }
          scopeConfirmed = false
          rememberReview(reviewKey(agentId, body.plan))
          renderReview()
          if (!dialog.open) dialog.showModal()
          // Never put focus on Apply, especially for broad profile changes.
          dialog.querySelector('[data-default-action]')?.focus()
        } catch (cause) {
          if (requestEpoch === sessionEpoch && selected === agentId) { error = cause instanceof Error ? cause.message : String(cause); render() }
        } finally { reviewLoading = false }
      }

      async function decideAdoption(action) {
        if (!review || reviewBusy || review.plan.status !== 'pending') return
        if (action === 'adoption-approve' && review.plan.scope === 'profile' && (!scopeConfirmed || !review.plan.targetId)) return
        const target = review
        reviewBusy = true
        reviewError = ''
        renderReview()
        try {
          await request('/evolve/action', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dsh-evolve-action': '1' },
            body: JSON.stringify({ action, agentId: target.agentId, id: target.plan.id, contentHash: target.plan.contentHash,
              ...(target.plan.scope === 'profile' && scopeConfirmed && action === 'adoption-approve' ? { confirmedTargetId: target.plan.targetId } : {}) }),
          })
          reviewBusy = false
          closeReview()
          await refresh()
        } catch (cause) {
          reviewError = cause instanceof Error ? cause.message : String(cause)
        } finally {
          reviewBusy = false
          if (!disposed) renderReview()
        }
      }

      function renderReview() {
        dialog.replaceChildren()
        if (!review) return
        const plan = review.plan
        const pending = plan.status === 'pending'
        const profile = plan.scope === 'profile'
        dialog.appendChild(el('div', { class: 'dsh-ev-eyebrow', text: `Evo · ${scopeName(plan)}` }))
        dialog.appendChild(el('h2', { id: 'dsh-evolve-review-title', text: pending ? L.reviewTitle : plan.status === 'undone' ? L.undone : L.changes }))
        dialog.appendChild(el('p', { class: 'dsh-ev-muted', text: pending ? L.pendingNotice : plan.status === 'applied' ? plan.scope === 'session' ? L.improvedBody : L.sharedAppliedBody : L.closedNotice }))
        if (profile && pending) dialog.appendChild(el('div', { class: 'dsh-ev-card warning' }, [el('p', { text: L.profileNote })]))
        const facts = el('dl', { class: 'dsh-ev-facts' })
        const fact = (label, value) => { facts.appendChild(el('dt', { text: label })); facts.appendChild(el('dd', { text: value })) }
        fact(L.suggestedFor, scopeName(plan))
        if (plan.targetDirectory) fact(L.directory, plan.targetDirectory)
        if (plan.profileName) fact('Profile', plan.profileName)
        fact(L.expected, plan.headline || plan.expectedEffect || L.expectedUnknown)
        fact(L.activation, plan.activation === 'next-request' ? L.nextRequest : plan.activation === 'new-session' ? L.newSession : plan.activation === 'restart' ? L.restart : L.manualActivation)
        fact('', activationDetailText(plan))
        if (plan.scope !== 'session') {
          fact(L.files, (review.files || []).map(file => file.path).join('\n') || L.noDiff)
          fact(L.otherSessions, plan.affectedSessions ? plan.affectedSessions.join(', ') || L.noOtherSessions : L.scopeUnknown)
          if (profile) fact(L.projects, plan.affectedProjects ? plan.affectedProjects.join(', ') || L.noOtherProjects : L.scopeUnknown)
        }
        fact(L.scope, impactText(plan))
        dialog.appendChild(facts)
        dialog.appendChild(el('details', {}, [el('summary', { text: L.verification }),
          ...(plan.expectedEffect && plan.expectedEffect !== plan.headline ? [el('p', { class: 'dsh-ev-muted', text: plan.expectedEffect })] : []),
          el('p', { class: 'dsh-ev-muted', text: plan.reason }),
          ...(plan.verification || []).map(item => el('p', { class: 'dsh-ev-muted', text: item })),
          el('p', { class: 'dsh-ev-muted', text: `${L.undo}: ${L.rollbackDetail}` }),
        ]))
        const changes = el('details', { 'data-review-diff': '' }, [el('summary', { text: `${L.viewDiff} · ${(review.files || []).length} ${L.files}` })])
        for (const file of review.files || []) changes.appendChild(el('details', {}, [
          el('summary', { text: `${file.path} · ${L[file.status] || ''}` }),
          el('strong', { text: L.before }), el('pre', { class: 'dsh-ev-pre', text: file.before }),
          el('strong', { text: L.after }), el('pre', { class: 'dsh-ev-pre', text: file.after }),
        ]))
        dialog.appendChild(changes)
        dialog.appendChild(el('details', { class: 'dsh-ev-muted' }, [el('summary', { text: L.diagnostics }),
          el('pre', { class: 'dsh-ev-pre', text: JSON.stringify({ id: plan.id, contentHash: plan.contentHash, target: plan.targetId || plan.targetSessionId, status: plan.status, evidence: plan.revision?.evidence }, null, 2) }),
        ]))
        if (reviewError) dialog.appendChild(el('details', { class: 'dsh-ev-error', role: 'alert' }, [el('summary', { text: L.closedNotice }), el('pre', { class: 'dsh-ev-pre', text: reviewError })]))
        if (!pending) {
          const close = el('button', { class: 'dsh-ev-btn', text: L.close, 'data-default-action': '', onclick: closeReview })
          dialog.appendChild(el('div', { class: 'dsh-ev-actions' }, [close,
            plan.status === 'applied' && plan.canUndo ? el('button', { class: 'dsh-ev-btn', text: L.undoChange, onclick: () => { void undoChange(review.agentId, plan) } }) : null,
          ]))
          return
        }
        const later = el('button', { class: 'dsh-ev-btn quiet', text: L.later, onclick: closeReview })
        const keep = el('button', { class: 'dsh-ev-btn', text: L.rejectChange, 'data-default-action': '', onclick: () => { void decideAdoption('adoption-reject') } })
        const accept = el('button', { class: 'dsh-ev-btn primary', text: L.acceptChange, onclick: () => { void decideAdoption('adoption-approve') } })
        if (profile) {
          const check = el('input', { type: 'checkbox', 'aria-label': L.confirmScope })
          check.checked = scopeConfirmed
          check.disabled = reviewBusy || !plan.targetId
          check.addEventListener('change', () => { scopeConfirmed = check.checked; accept.disabled = reviewBusy || !scopeConfirmed || !plan.targetId })
          dialog.appendChild(el('label', { class: 'dsh-ev-check' }, [check, el('span', { text: `${L.confirmScope}: ${scopeName(plan)}` })]))
        }
        keep.disabled = later.disabled = reviewBusy
        accept.disabled = reviewBusy || profile && (!scopeConfirmed || !plan.targetId)
        dialog.appendChild(el('div', { class: 'dsh-ev-actions' }, [keep, later, accept]))
      }

      async function act(action, extra) {
        if (busy) return
        busy = true
        error = ''
        try {
          const result = await request('/evolve/action', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(action === 'checkpoint' ? { 'x-dsh-evolve-action': '1' } : {}) },
            body: JSON.stringify({ action, agentId: selected, ...(extra || {}) }),
          })
          if (action === 'checkpoint' && result?.ok === false) { error = result.reason || L.statusUnavailable; render(); return }
          await refresh()
        } catch (cause) {
          error = cause instanceof Error ? cause.message : String(cause)
          render()
        } finally {
          busy = false
          if (!disposed) render()
        }
      }

      async function retryJob(agentId, id) {
        if (busy) return
        busy = true
        try {
          const send = action => request('/evolve/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, agentId, id }) })
          await send('resume')
          await refresh()
        } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); render() }
        finally { busy = false; if (!disposed) render() }
      }

      async function retryObservation(agentId) {
        if (busy) return
        busy = true
        const buttons = panel.querySelectorAll('button')
        buttons.forEach(item => { item.disabled = true })
        try {
          await request('/evolve/action', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dsh-evolve-action': '1' },
            body: JSON.stringify({ action: 'automatic-retry', agentId }) })
          await refresh()
        } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); render() }
        finally { busy = false; buttons.forEach(item => { item.disabled = false }); if (!disposed) render() }
      }

      async function showDiff(id) {
        diff = null
        error = ''
        try {
          diff = await request(`/evolve/diff?agentId=${encodeURIComponent(selected)}&id=${encodeURIComponent(id)}`)
          tab = 'changes'
          detailsOpen = true
        } catch (cause) {
          error = cause instanceof Error ? cause.message : String(cause)
        }
        render()
      }

      function currentAgent() {
        return agents.find(agent => agent.id === selected)
      }

      function actionButton(label, action, primary = false) {
        const item = el('button', { class: `dsh-ev-btn${primary ? ' primary' : ' quiet'}`, text: label, onclick: action })
        item.disabled = busy
        return item
      }
      function showDetails(nextTab = 'overview') { detailsOpen = true; tab = nextTab; menuOpen = false; render() }
      function diagnostic(value, label = L.diagnostics, expanded = false) {
        const node = el('details', { class: 'dsh-ev-diagnostic' }, [el('summary', { text: label }), el('pre', { class: 'dsh-ev-pre', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) })])
        node.open = expanded
        return node
      }
      function activationText(value) {
        return value === 'next-request' ? L.nextRequest : value === 'new-session' ? L.newSession : value === 'restart' ? L.restart : L.manualActivation
      }
      function primaryAction(agent, view) {
        const action = view.primaryAction
        if (!action) return null
        if (action.kind === 'review-adoption') return actionButton(L.reviewConfirm, () => { void showReview(agent.id, action.id || view.adoptionId) }, true)
        if (action.kind === 'view-comparison') return actionButton(L.viewComparison, () => showDetails('records'), true)
        if (action.kind === 'view-changes') return actionButton(L.viewChanges, () => showDetails('changes'), true)
        if (action.kind === 'retry-observation') return actionButton(L.retry, () => { void retryObservation(agent.id) }, true)
        if (action.kind === 'retry-experiment') return actionButton(L.retry, () => { void retryJob(agent.id, action.id || view.experimentId) }, true)
        return null
      }
      function currentUndo(agent, view) {
        return view.canUndo && (agent.adoptions || []).find(plan => plan.id === view.adoptionId && plan.status === 'applied' && plan.canUndo)
      }
      function renderStatus(agent, view, body, detailed = false) {
        const card = el('div', { class: 'dsh-ev-status-card', 'data-status-card': '' })
        card.appendChild(el('div', { class: 'dsh-ev-eyebrow' }, [el('span', { class: `dsh-ev-dot ${statusTone(view.state)}`, 'aria-hidden': 'true' }), el('span', { text: localized(view.title) })]))
        card.appendChild(el('h3', { text: view.workstreamTitle || view.taskTitle || L.currentTask }))
        card.appendChild(el('p', { class: 'dsh-ev-muted', text: localized(view.reason) || localized(view.summary) }))
        card.appendChild(el('div', { class: 'dsh-ev-strategy' }, [el('span', { text: L.currentStrategy }), el('strong', { text: strategyText(view) })]))
        const actions = el('div', { class: 'dsh-ev-status-actions' })
        if (view.state !== 'running' && view.state !== 'learning' && view.state !== 'queued') {
          const main = primaryAction(agent, view)
          if (main && deferredAdoption !== view.adoptionId) actions.appendChild(main)
          const undo = currentUndo(agent, view)
          if (undo) actions.appendChild(actionButton(L.undoChange, () => { void undoChange(agent.id, undo) }))
          if (view.state === 'pending-adoption' && deferredAdoption !== view.adoptionId) actions.appendChild(actionButton(L.defer, () => { deferredAdoption = view.adoptionId; render() }))
        }
        if (view.state === 'running') actions.appendChild(actionButton(L.learnNow, () => { void act('checkpoint') }, true))
        if (!detailed) actions.appendChild(el('button', { class: 'dsh-ev-btn quiet detail-link', text: L.details, onclick: () => showDetails() }))
        if (actions.children.length) card.appendChild(actions)
        body.appendChild(card)
      }
      function renderOverview(agent, view, body) {
        renderStatus(agent, view, body, true)
        const metrics = el('div', { class: 'dsh-ev-metrics' })
        for (const [label, value] of [[L.learningRuns, view.learningCount ? number(view.learningCount) : L.notLearned], [L.candidateCount, number(view.candidateCount)], [L.settledTokens, number(agent.budget?.settledTokens ?? agent.budget?.extraTokens)]]) {
          metrics.appendChild(el('div', {}, [el('span', { text: label }), el('strong', { text: value })]))
        }
        body.appendChild(metrics)
        if (agent.budget?.unknownTokens) body.appendChild(el('p', { class: 'dsh-ev-muted', text: `${L.unknownTokens} · ${number(agent.budget.unknownTokens)}` }))
        if (view.updatedAt) body.appendChild(el('p', { class: 'dsh-ev-muted', text: `${L.created} · ${dateText(view.updatedAt)}` }))
        if (view.activation) body.appendChild(el('p', { class: 'dsh-ev-muted', text: `${L.activationShort} · ${activationText(view.activation)}` }))
        if (view.detail) body.appendChild(diagnostic(view.detail, L.technicalReason))
        if (diagnosticsOpen) {
          if (agent.budget?.stageTokens?.length) body.appendChild(diagnostic(agent.budget.stageTokens, L.tokenBreakdown))
          body.appendChild(diagnostic(agent, L.diagnostics, true))
        }
      }
      function renderRecords(agent, body) {
        const jobs = agent.experiments || []
        if (!jobs.length) body.appendChild(el('p', { class: 'dsh-ev-empty', text: L.noRecords }))
        for (const [index, job] of jobs.entries()) {
          const item = el('article', { class: 'dsh-ev-record' })
          item.appendChild(el('div', { class: 'dsh-ev-record-meta' }, [el('span', { text: statusText(job.status) }), el('time', { text: dateText(job.endedAt || job.createdAt) })]))
          item.appendChild(el('h4', { text: job.title || job.taskTitle || `${viewOf(agent)?.workstreamTitle || viewOf(agent)?.taskTitle || L.currentTask} · ${jobs.length - index}` }))
          if (job.status === 'kept-base') item.appendChild(el('p', { class: 'dsh-ev-muted', text: L.keptBody }))
          if (job.status === 'selected') item.appendChild(el('p', { class: 'dsh-ev-muted', text: L.selected }))
          const comparison = el('details', { 'data-comparison': '' }, [el('summary', { text: `${L.comparison} · ${(job.candidates || []).length} ${L.candidate}` })])
          const kinds = {}
          for (const candidate of job.candidates || []) {
            kinds[candidate.kind] = (kinds[candidate.kind] || 0) + 1
            const name = ({ baseline: L.candidateBaseline, invariant: L.candidateInvariant, domain: L.candidateDomain, compose: L.candidateCompose, reuse: L.candidateReuse })[candidate.kind] || L.candidate
            const entry = el('div', { class: 'dsh-ev-candidate' }, [el('strong', { text: `${name}${candidate.kind === 'baseline' ? '' : ` ${kinds[candidate.kind]}`}` })])
            entry.appendChild(el('p', { class: 'dsh-ev-muted', text: [candidate.validation === 'invalid' ? L.componentInvalid : candidate.rollout ? statusText(candidate.rollout.status) : L.notExecuted, candidate.selected ? L.winner : candidate.eligibility === 'eligible' ? L.eligible : candidate.eligibility === 'ineligible' ? L.ineligible : L.eligibilityUnknown].join(' · ') }))
            if (candidate.rollout?.limit) entry.appendChild(el('span', { class: 'dsh-ev-pill', text: L.limitStopped }))
            if (candidate.rollout?.checks?.length) {
              const counts = { pass: 0, fail: 0, unknown: 0 }
              for (const check of candidate.rollout.checks) counts[check.status === 'pass' || check.status === 'fail' ? check.status : 'unknown']++
              entry.appendChild(el('p', { class: 'dsh-ev-muted', text: `${L.checks} · ${L.checksPass} ${counts.pass} · ${L.checksFail} ${counts.fail} · ${L.checksUnknown} ${counts.unknown}` }))
            }
            entry.appendChild(diagnostic(candidate))
            comparison.appendChild(entry)
          }
          item.appendChild(comparison)
          if (Number.isFinite(job.processingTokens)) item.appendChild(el('p', { class: 'dsh-ev-muted', text: `${L.processingTokens} · ${number(job.processingTokens)}` }))
          item.appendChild(diagnostic(job))
          body.appendChild(item)
        }
        if ((agent.history || []).length) {
          body.appendChild(el('h4', { class: 'dsh-ev-section-title', text: L.versionHistory }))
          for (const [index, revision] of [...agent.history].reverse().entries()) {
            const item = el('article', { class: 'dsh-ev-record' }, [el('div', { class: 'dsh-ev-record-meta' }, [el('span', { text: `${L.revisionStrategy}${agent.history.length - index}` }), el('time', { text: dateText(revision.createdAt) })]), actionButton(L.viewChanges, () => { void showDiff(revision.id) })])
            item.appendChild(diagnostic(revision)); body.appendChild(item)
          }
        }
      }
      function renderChanges(agent, body) {
        const plans = [...agent.adoptions || []].reverse()
        for (const [label, group] of [[L.pendingChanges, plans.filter(p => p.status === 'pending')], [L.appliedChanges, plans.filter(p => p.status === 'applied')], [L.otherChanges, plans.filter(p => !['pending', 'applied'].includes(p.status))]]) {
          if (!group.length) continue
          body.appendChild(el('h4', { class: 'dsh-ev-section-title', text: label }))
          for (const plan of group) {
            const kinds = (plan.changeKinds || []).map(changeKindName).filter(Boolean)
            const meta = el('div', { class: 'dsh-ev-record-meta' }, [
              el('span', { text: scopeName(plan) }),
              ...kinds.slice(0, 3).map(kind => el('span', { class: 'dsh-ev-pill', text: kind })),
              ...(plan.fileCount ? [el('span', { text: `${plan.fileCount} ${L.fileUnit}` })] : []),
              el('span', { text: plan.status === 'pending' ? L.notApplied : statusText(plan.status) }),
            ])
            const item = el('article', { class: 'dsh-ev-record' }, [meta, el('h4', { text: plan.headline || (plan.expectedEffect || '').split('\n')[0] || L.reviewTitle }), el('p', { class: 'dsh-ev-muted', text: activationText(plan.activation) })])
            const actions = el('div', { class: 'dsh-ev-actions' }, [actionButton(plan.status === 'pending' ? L.reviewConfirm : L.viewDiff, () => { void showReview(agent.id, plan.id) })])
            if (plan.status === 'applied' && plan.canUndo) actions.appendChild(actionButton(L.undoChange, () => { void undoChange(agent.id, plan) }))
            item.appendChild(actions); body.appendChild(item)
          }
        }
        for (const candidate of agent.candidates || []) {
          const item = el('article', { class: 'dsh-ev-record' }, [el('span', { class: 'dsh-ev-pill', text: L.pendingChanges }), el('h4', { text: candidate.name || L.candidate })])
          const controls = el('details', {}, [el('summary', { text: L.review }), diagnostic(candidate), el('div', { class: 'dsh-ev-actions' }, [actionButton(L.approve, () => { void act('approve', { id: candidate.id }) }), actionButton(L.reject, () => { void act('reject', { id: candidate.id }) }), actionButton(L.promote, () => { void act('promote', { id: candidate.id }) })])])
          item.appendChild(controls); body.appendChild(item)
        }
        if (!plans.length && !(agent.candidates || []).length && !diff) body.appendChild(el('p', { class: 'dsh-ev-empty', text: L.noChangesNew }))
        if (diff) {
          const changes = el('details', { 'data-history-diff': '' }, [el('summary', { text: L.viewDiff })]); changes.open = true
          for (const file of diff.files || []) changes.appendChild(el('details', {}, [el('summary', { text: `${file.path} · ${L[file.status] || ''}` }), el('strong', { text: L.before }), el('pre', { class: 'dsh-ev-pre', text: file.before }), el('strong', { text: L.after }), el('pre', { class: 'dsh-ev-pre', text: file.after })]))
          body.appendChild(changes)
        }
      }
      function renderExperience(agent, body) {
        const entries = agent.experiences || []
        if (!entries.length) body.appendChild(el('p', { class: 'dsh-ev-empty', text: L.noExperience }))
        for (const entry of entries) {
          const level = ({ hypothesis: L.hypothesis, 'task-validated': L.taskValidated, 'transfer-supported': L.transferSupported, revoked: L.revoked })[entry.state] || L.hypothesis
          const item = el('article', { class: 'dsh-ev-record' }, [el('span', { class: 'dsh-ev-pill', text: level }), el('h4', { text: entry.applicability || L.scopeLabel }), el('p', { text: entry.lesson || '' })])
          const counters = entry.counterEvidence || []
          item.appendChild(el('details', {}, [el('summary', { text: `${L.counterEvidence} · ${counters.length}` }), ...(counters.length ? counters.map(value => el('p', { class: 'dsh-ev-muted', text: typeof value === 'string' ? value : value.reason || value.detail || L.counterEvidence })) : [el('p', { class: 'dsh-ev-muted', text: L.noCounterEvidence })])]))
          item.appendChild(el('details', { class: 'dsh-ev-diagnostic' }, [el('summary', { text: L.more }), actionButton(L.revoke, () => { void act('revoke', { id: entry.id }) }), diagnostic(entry)]))
          body.appendChild(item)
        }
      }
      function renderMenu(agent, header) {
        const menu = el('div', { class: 'dsh-ev-menu', role: 'group', 'aria-label': L.more })
        if (pauseConfirmation) {
          menu.appendChild(el('p', { class: 'dsh-ev-muted', style: 'padding:4px 10px', text: L.pauseImpact }))
          menu.appendChild(actionButton(L.cancel, () => { pauseConfirmation = false; render() }))
          menu.appendChild(actionButton(L.confirmPause, () => { pauseConfirmation = false; menuOpen = false; void act('off'); render() }))
          header.appendChild(menu)
          return
        }
        const command = (label, fn) => actionButton(label, () => { menuOpen = false; fn() })
        menu.appendChild(command(L.refresh, () => { void refresh(); render() }))
        if (agent?.view) {
          menu.appendChild(command(L.newLearning, () => { void act('propose'); render() }))
          menu.appendChild(command(L.reflectTask, () => { void act('reflect'); render() }))
          menu.appendChild(actionButton(agent.enabled ? L.pauseLearning : L.resumeLearning, () => { if (agent.enabled) pauseConfirmation = true; else { menuOpen = false; void act('on') }; render() }))
          menu.appendChild(command(L.diagnostics, () => { diagnosticsOpen = true; showDetails() }))
        }
        const select = el('select', { 'aria-label': L.language })
        for (const [value, label] of [['auto', L.automaticLanguage], ['zh', '中文'], ['en', 'English']]) { const option = el('option', { value, text: label }); option.selected = languageMode === value; select.appendChild(option) }
        select.addEventListener('change', () => { languageMode = select.value; try { localStorage.setItem('dsh-evolve-language', languageMode) } catch {}; updateLanguage(); menuOpen = false; render() })
        menu.appendChild(el('label', {}, [el('span', { text: L.language }), select]))
        header.appendChild(menu)
      }
      function render() {
        const agent = currentAgent(), view = viewOf(agent)
        const title = error ? L.offlineTitle : view ? localized(view.title) : L.statusUnavailable
        button.replaceChildren(el('span', { class: `dsh-ev-dot ${error ? 'attention' : statusTone(view?.state)}`, 'aria-hidden': 'true' }), el('span', { text: `Evo · ${title}` }))
        button.setAttribute('aria-expanded', String(open)); button.setAttribute('aria-controls', 'dsh-evolve-panel')
        panel.setAttribute('data-detail', String(detailsOpen)); panel.replaceChildren()
        const header = el('header', {}, [detailsOpen ? el('button', { class: 'dsh-ev-btn quiet', text: '‹', 'aria-label': L.compact, onclick: () => { detailsOpen = false; menuOpen = false; pauseConfirmation = false; render() } }) : null, el('strong', { text: 'Evo' }), el('button', { class: 'dsh-ev-btn quiet', text: '⋯', 'aria-label': L.more, 'aria-expanded': String(menuOpen), onclick: () => { menuOpen = !menuOpen; pauseConfirmation = false; render() } }), el('button', { class: 'dsh-ev-btn quiet', text: '×', 'aria-label': L.close, onclick: () => { open = false; menuOpen = false; pauseConfirmation = false; panel.style.display = 'none'; render() } })])
        panel.appendChild(header)
        if (menuOpen) renderMenu(agent, header)
        if (detailsOpen && view && !error) {
          const tabs = el('nav', { class: 'dsh-ev-tabs', role: 'tablist', 'aria-label': L.details })
          for (const [key, label] of [['overview', L.overview], ['records', L.records], ['changes', L.changeTab], ['experience', L.experienceTab]]) tabs.appendChild(el('button', { class: `dsh-ev-tab${tab === key ? ' active' : ''}`, role: 'tab', 'aria-selected': String(tab === key), text: label, onclick: () => { tab = key; render() } }))
          panel.appendChild(tabs)
        }
        const body = el('div', { class: 'dsh-ev-body', ...(detailsOpen ? { role: 'tabpanel' } : {}) }); panel.appendChild(body)
        if (!agent && agents.length) {
          body.appendChild(el('p', { class: 'dsh-ev-muted', text: L.noCurrentSession }))
          const select = el('select', { class: 'dsh-ev-select', 'aria-label': L.chooseSession })
          select.appendChild(el('option', { value: '', text: L.chooseSession }))
          for (const item of agents) select.appendChild(el('option', { value: item.id, text: item.view?.workstreamTitle || item.view?.taskTitle || L.session }))
          select.addEventListener('change', () => { setSessionSelection(select.value || null); manualSelection = !!selected; render() }); body.appendChild(select); return
        }
        if (error || !view) {
          body.appendChild(el('h3', { class: 'dsh-ev-detail-heading', text: title }))
          body.appendChild(el('p', { class: 'dsh-ev-muted', text: error ? L.offlineBody : agent ? L.upgradeHost : L.noAgent }))
          if (error) body.appendChild(diagnostic(error, L.technicalReason))
          return
        }
        if (!detailsOpen) renderStatus(agent, view, body)
        else if (tab === 'overview') renderOverview(agent, view, body)
        else if (tab === 'records') renderRecords(agent, body)
        else if (tab === 'changes') renderChanges(agent, body)
        else renderExperience(agent, body)
      }

      button.addEventListener('click', () => {
        open = !open
        panel.style.display = open ? 'flex' : 'none'
        if (open) closeNotice()
        if (!open) { menuOpen = false; pauseConfirmation = false }
        render()
        if (open) void refresh()
      })

      const interval = setInterval(() => { void refresh() }, 4000)
      const cleanup = () => {
        disposed = true
        clearInterval(interval)
        sessionUnsubscribe?.()
        fallbackUnsubscribe?.()
        localeUnsubscribe?.()
        clearTimeout(toastTimer)
        button.remove()
        panel.remove()
        style.remove()
        dialog.remove()
        toast.remove()
      }
      if (typeof ctx.effect === 'function') ctx.effect(() => () => cleanup())
      function setSessionSelection(agentId) {
        sessionEpoch++
        selected = agentId
        deferredAdoption = null; diff = null
        detailsOpen = false; menuOpen = false; pauseConfirmation = false
        closeNotice()
        // An already submitted decision remains bound to its exact reviewed plan.
        if (!reviewBusy) closeReview()
      }
      function syncSession(source) {
        if (disposed) return
        const snapshot = source.getSnapshot()
        const next = snapshot?.props?.sessionId || snapshot?.key || null
        if (next !== nativeSessionId) {
          nativeSessionId = next; manualSelection = false
          setSessionSelection(agents.find(agent => agent.sessionId === next || agent.id === next)?.id ?? null)
          render()
        }
      }
      function bindSession(service) {
        sessionUnsubscribe?.(); sessionUnsubscribe = undefined
        uiSessionPresent = !!service
        const source = service?.adapter?.current
        if (source?.getSnapshot) { syncSession(source); sessionUnsubscribe = source.subscribe(() => syncSession(source)) }
        else if (service) { nativeSessionId = null; manualSelection = false; setSessionSelection(null); render() }
        else syncFallbackSessions()
        return () => { sessionUnsubscribe?.(); sessionUnsubscribe = undefined; uiSessionPresent = false; syncFallbackSessions() }
      }
      function syncFallbackSessions() {
        if (disposed || uiSessionPresent) return
        const entries = fallbackSessions?.getSnapshot?.()?.byId
        const rows = entries?.values ? [...entries.values()] : Object.values(entries || {})
        const active = rows.filter(item => item.retainedBy?.mainView > 0)
        const id = active.length === 1 ? active[0].id : null
        syncSession({ getSnapshot: () => ({ props: { sessionId: id } }) })
      }
      function bindFallbackSessions(service) {
        fallbackUnsubscribe?.(); fallbackUnsubscribe = undefined
        fallbackSessions = service?.list
        syncFallbackSessions()
        fallbackUnsubscribe = fallbackSessions?.subscribe?.(syncFallbackSessions)
        return () => { fallbackUnsubscribe?.(); fallbackUnsubscribe = undefined; fallbackSessions = undefined; syncFallbackSessions() }
      }
      function bindLocale(service) {
        localeUnsubscribe?.(); localeUnsubscribe = undefined
        localeService = service
        localeUnsubscribe = service?.subscribe?.(() => { if (languageMode === 'auto' && !disposed) updateLanguage() })
        updateLanguage()
        return () => { localeUnsubscribe?.(); localeUnsubscribe = undefined; localeService = undefined }
      }
      // Optional Cordis injections also attach services that load after this UI plugin.
      if (typeof ctx.inject === 'function') {
        for (const [name, bind] of [['uiSession', bindSession], ['sessions', bindFallbackSessions], ['locale', bindLocale]]) {
          ctx.inject([name], scope => { scope.effect(() => bind(scope[name])) })
        }
      } else {
        try { bindSession(ctx.get?.('uiSession') || ctx.uiSession) } catch {}
        try { bindFallbackSessions(ctx.get?.('sessions') || ctx.sessions) } catch {}
        try { bindLocale(ctx.get?.('locale') || ctx.locale) } catch {}
      }
      updateLanguage()
      try {
        const pendingLocale = window.__DSH_LOCALE__?.read?.()
        if (pendingLocale) Promise.resolve(pendingLocale).then(value => {
          if (disposed) return
          nativeLanguages = Array.isArray(value?.languages) ? value.languages.filter(item => typeof item === 'string') : []
          if (languageMode === 'auto') updateLanguage()
        }).catch(() => {})
      } catch {}
      void refresh()
      return cleanup
    }

    exports.apply = apply
    exports.inject = []
    exports.locales = LOCALES
    exports.pickLocale = pickLocale
    return module.exports
  },
})
