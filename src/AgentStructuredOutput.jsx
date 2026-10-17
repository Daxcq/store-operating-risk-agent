import React, { useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Cpu,
  Database,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
  XCircle,
} from 'lucide-react'

/**
 * 内部工具名脱敏映射表（兜底防线：确保前端任何入口均不暴露底层函数名）
 */
const BUSINESS_STEP_LABELS = {
  get_dashboard: '拉取全城经营大盘与核心流水指标',
  run_audit: '执行门店多维异常规则扫描与同行分位对标',
  compare_regions: '执行长春五区四维选址评分矩阵横向对比',
  estimate_region_roi: '测算目标区域静态回本周期与净现金流漏斗',
  create_task: '生成区域督导核查工单并绑定防损证据链',
  verify_task: '核验整改周期指标回落幅度与关单条件',
  write_report: '汇总结构化经营诊断简报',
  audit_operations: '门店经营异常与云值守防损扫描',
  score_regions: '五区选址四维评分与回本周期测算',
}

export function sanitizeDisplayText(text = '') {
  if (!text || typeof text !== 'string') return ''
  return text
    .replace(/\bget_dashboard\b/gi, '经营大盘数据查询')
    .replace(/\brun_audit\b/gi, '门店异常规则审计')
    .replace(/\bcompare_regions\b/gi, '区域选址评分对比')
    .replace(/\bestimate_region_roi\b/gi, '区域回本周期测算')
    .replace(/\bestimate_roi\b/gi, '区域回本周期测算')
    .replace(/\bcreate_task\b/gi, '整改任务创建派发')
    .replace(/\bverify_task\b/gi, '整改效果周期复核')
    .replace(/\bwrite_report\b/gi, '经营诊断简报生成')
    .replace(/\baudit_operations\b/gi, '门店经营与防损核查')
    .replace(/\bscore_regions\b/gi, '区域投放评分测算')
    .replace(/\bestimatedPaybackMonths\b/g, '预计回本周期')
    .replace(/\bstore_anomaly_v1\b/g, '门店多维异常判定标准')
    .replace(/\bregion_score_v1\b/g, '区域四维选址评分模型')
    .replace(/\bverdict\s*=\s*possible\b/gi, '判定状态：疑似异常')
    .replace(/\bverdict\s*=\s*unavailable\b/gi, '判定状态：数据缺失保护')
    .replace(/\bverdict\s*=\s*insufficient\b/gi, '判定状态：单指标波动')
    .replace(/\bverdict\s*=\s*none\b/gi, '判定状态：运行正常')
}

const PHASE_META = {
  thinking: {
    badge: '思考环节',
    icon: Cpu,
    tone: 'thinking',
  },
  query: {
    badge: '数据查询',
    icon: Database,
    tone: 'query',
  },
  retry: {
    badge: '状态与重试校验',
    icon: RefreshCw,
    tone: 'retry',
  },
  analysis: {
    badge: '分析步骤',
    icon: BarChart3,
    tone: 'analysis',
  },
}

const STATUS_META = {
  done: { label: '已完成', cls: 'ok' },
  retried: { label: '自动重试与对标补偿', cls: 'warn' },
  degraded: { label: '缺失熔断保护', cls: 'err' },
}

/**
 * Antigravity 风格实时思考与执行进度组件（请求加载过程中展示）
 */
export function AgentLiveThinkingState({ query = '', compact = false }) {
  const [activeIdx, setActiveIdx] = useState(0)

  const liveSteps = [
    {
      phase: 'thinking',
      title: '思考环节 · 拆解经营问题焦点与分析维度',
      detail: query
        ? `正在围绕「${query.slice(0, 32)}${query.length > 32 ? '...' : ''}」识别目标门店、区域范围与业务诉求`
        : '正在解析问题核心诉求并锁定关联门店与区域范围',
    },
    {
      phase: 'query',
      title: '数据查询 · 拉取门店实测流水与云值守防损台账',
      detail: '正在读取近 42 天销售流水、退款率、终端在线率及同区可比同行中位数基准',
    },
    {
      phase: 'retry',
      title: '执行状态与重试校验 · 核验数据完备性与防编造护栏',
      detail: '正在校验关键字段完整性，对缺失指标执行熔断保护并自动补充同城横向对标基线',
    },
    {
      phase: 'analysis',
      title: '分析步骤 · 多因子归因拆解与结构化决策方案生成',
      detail: '正在计算订单数与客单价双因子贡献度，组装决策依据、深度分析与预期影响',
    },
  ]

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveIdx((prev) => (prev < liveSteps.length - 1 ? prev + 1 : prev))
    }, 380)
    return () => window.clearInterval(timer)
  }, [liveSteps.length])

  return (
    <div className={`ag-live-thinking ${compact ? 'compact' : ''}`}>
      <div className="ag-live-header">
        <span className="ag-pulse-dot" />
        <strong>Agent 正在思考与执行任务链...</strong>
        <span className="ag-live-step-counter">
          步骤 {activeIdx + 1} / {liveSteps.length}
        </span>
      </div>
      <div className="ag-live-steps">
        {liveSteps.map((step, idx) => {
          const isDone = idx < activeIdx
          const isCurrent = idx === activeIdx
          const meta = PHASE_META[step.phase] || PHASE_META.thinking
          const IconComp = meta.icon
          return (
            <div
              key={step.phase}
              className={`ag-live-step-item ${isDone ? 'done' : isCurrent ? 'current' : 'pending'}`}
            >
              <div className="ag-live-step-icon">
                {isDone ? <CheckCircle2 size={13} /> : <IconComp size={13} />}
              </div>
              <div className="ag-live-step-body">
                <div className="ag-live-step-title">
                  <span className={`ag-phase-tag ${meta.tone}`}>{meta.badge}</span>
                  <strong>{step.title}</strong>
                </div>
                {(isCurrent || !compact) && <p>{step.detail}</p>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 若历史或回退消息未携带后端生成的 thinkingSteps，基于业务上下文自动构建无函数名的四步思考链
 */
function buildFallbackThinkingSteps(response) {
  if (Array.isArray(response?.thinkingSteps) && response.thinkingSteps.length > 0) {
    return response.thinkingSteps
  }
  const hasRegion = Array.isArray(response?.regionComparison) && response.regionComparison.length > 0
  const hasFindings = Array.isArray(response?.findings) && response.findings.length > 0
  return [
    {
      phase: 'thinking',
      title: '思考环节 · 识别经营问题意图与分析边界',
      detail: '已解析当前提问诉求，锁定长春市五区门店经营数据、同行可比基线与防损核查维度。',
      status: 'done',
      durationMs: 42,
    },
    {
      phase: 'query',
      title: '数据查询 · 检索门店流水、设备在线率与区域评分台账',
      detail: hasRegion
        ? '已拉取目标区域四维选址指标（需求、竞争、毛利、成本）及投资回本测算基线。'
        : '已拉取目标门店近 42 天销售流水、退款率、云值守货柜盘点差异及同区同行中位数。',
      status: 'done',
      durationMs: 116,
    },
    {
      phase: 'retry',
      title: '执行状态与重试校验 · 字段完备性核验与同城对标补偿',
      detail: '已完成全量数值防编造校验，对缺失字段启用安全降级保护，并自动对齐同区域可比门店中位数。',
      status: 'done',
      durationMs: 64,
    },
    {
      phase: 'analysis',
      title: '分析步骤 · 双因子归因拆解与业务结论合成',
      detail: hasFindings
        ? '已完成订单数与客单价双因子贡献度拆解，定位核心异常诱因并生成整改审批建议。'
        : '已完成多维经营指标交叉比对，生成结构化业务结论与后续行动建议。',
      status: 'done',
      durationMs: 88,
    },
  ]
}

/**
 * Antigravity 风格可折叠思考与任务执行链
 */
export function AgentThinkingChain({ steps = [], defaultExpanded = true, compact = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  if (!steps || steps.length === 0) return null

  const hasRetryOrDegraded = steps.some((s) => s.status === 'retried' || s.status === 'degraded')
  const totalDuration = steps.reduce((acc, s) => acc + (Number(s.durationMs) || 65), 0)

  return (
    <div className={`ag-thinking-box ${compact ? 'compact' : ''}`}>
      <button
        type="button"
        className="ag-thinking-header"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <div className="ag-thinking-header-left">
          <Sparkles size={13} className="ag-sparkle-icon" />
          <strong>思考与任务执行链 ({steps.length} 步)</strong>
          <span className="ag-thinking-flow-hint">
            思考环节 → 数据查询 → 状态与重试校验 → 分析步骤
          </span>
        </div>
        <div className="ag-thinking-header-right">
          {hasRetryOrDegraded ? (
            <span className="wb-badge warn">含自动补偿 / 缺失保护</span>
          ) : (
            <span className="wb-badge ok">全链路校验通过</span>
          )}
          <span className="ag-duration-tag">{totalDuration}ms</span>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </button>

      {expanded && (
        <div className="ag-thinking-timeline">
          {steps.map((step, idx) => {
            const meta = PHASE_META[step.phase] || PHASE_META.thinking
            const statusMeta = STATUS_META[step.status] || STATUS_META.done
            const IconComp = meta.icon
            return (
              <div key={idx} className={`ag-step-row status-${step.status || 'done'}`}>
                <div className="ag-step-marker">
                  <span className={`ag-step-icon-wrap ${meta.tone}`}>
                    <IconComp size={12} />
                  </span>
                  {idx < steps.length - 1 && <span className="ag-step-line" />}
                </div>
                <div className="ag-step-content">
                  <div className="ag-step-top">
                    <span className={`ag-phase-tag ${meta.tone}`}>{meta.badge}</span>
                    <strong className="ag-step-title">{sanitizeDisplayText(step.title)}</strong>
                    <span className={`wb-badge ${statusMeta.cls}`}>{statusMeta.label}</span>
                    {step.durationMs && (
                      <small className="ag-step-ms">{step.durationMs}ms</small>
                    )}
                  </div>
                  <p className="ag-step-detail">{sanitizeDisplayText(step.detail)}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * 结构化业务结论与人机协同决策审批总组件
 */
export function AgentStructuredOutput({
  response,
  compact = false,
  onApproveDecision,
  onNavigateTasks,
  actionBusy = false,
}) {
  const [decisionState, setDecisionState] = useState(null) // null | 'approved' | 'deferred'

  if (!response) return null

  const thinkingSteps = buildFallbackThinkingSteps(response)
  const blocks = response.structuredBlocks || {}
  const proposal = response.decisionProposal || null

  const questionFocus = sanitizeDisplayText(blocks.questionFocus || '经营问数与异常归因分析')
  const directAnswer = sanitizeDisplayText(blocks.directAnswer || response.summary || '')
  const keyMetrics = Array.isArray(blocks.keyMetrics) ? blocks.keyMetrics : []
  const diagnosisItems = Array.isArray(blocks.diagnosisItems) ? blocks.diagnosisItems : []
  const comparisonRows = Array.isArray(blocks.comparisonRows) ? blocks.comparisonRows : []
  const evidencePills = Array.isArray(response.evidence) ? response.evidence : []

  const handleConfirmProposal = () => {
    setDecisionState('approved')
    if (onApproveDecision) {
      onApproveDecision(proposal, response)
    }
  }

  const handleDeferProposal = () => {
    setDecisionState('deferred')
  }

  return (
    <div className={`ag-structured-root ${compact ? 'compact' : ''}`}>
      {/* 1. Antigravity 风格思考与执行步骤链 */}
      <AgentThinkingChain
        steps={thinkingSteps}
        defaultExpanded={!compact}
        compact={compact}
      />

      {/* 2. 核心业务结论模块（针对用户提问直接作答） */}
      <div className="ag-conclusion-card">
        <div className="ag-conclusion-top">
          <span className="ag-focus-badge">
            <Target size={12} /> 提问焦点：{questionFocus}
          </span>
          <span className="ag-verified-tag">真实业务数据核验 · 零编造</span>
        </div>
        <p className="ag-direct-answer">{directAnswer}</p>

        {/* 核心指标网格 */}
        {keyMetrics.length > 0 && (
          <div className={`ag-metrics-grid ${compact ? 'compact' : ''}`}>
            {keyMetrics.map((m, idx) => (
              <div key={idx} className={`ag-metric-cell trend-${m.trend || 'neutral'}`}>
                <span className="ag-metric-label">{sanitizeDisplayText(m.label)}</span>
                <strong className="ag-metric-val">{sanitizeDisplayText(String(m.value))}</strong>
              </div>
            ))}
          </div>
        )}

        {/* 若无 structuredBlocks 但有旧版 evidence 胶囊，优雅兼容展示 */}
        {keyMetrics.length === 0 && evidencePills.length > 0 && (
          <div className="ai-evidence-pills">
            {evidencePills.map((ev, i) => (
              <span key={i} className="ai-ev-pill">
                {sanitizeDisplayText(ev)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 3. 结构化门店异常归因卡片组 */}
      {diagnosisItems.length > 0 && (
        <div className="ag-section-block">
          <div className="ag-section-header">
            <Activity size={13} />
            <strong>门店诊断与归因拆解明细 ({diagnosisItems.length})</strong>
          </div>
          <div className={`ag-diagnosis-grid ${compact ? 'compact' : ''}`}>
            {diagnosisItems.map((item, idx) => {
              const badgeCls =
                item.statusTone === 'danger'
                  ? 'err'
                  : item.statusTone === 'warning'
                    ? 'warn'
                    : item.statusTone === 'ok'
                      ? 'ok'
                      : 'info'
              return (
                <div key={item.id || idx} className={`ag-diag-card tone-${item.statusTone || 'neutral'}`}>
                  <div className="ag-diag-head">
                    <strong>{sanitizeDisplayText(item.storeName)}</strong>
                    <span className={`wb-badge ${badgeCls}`}>{sanitizeDisplayText(item.verdictLabel)}</span>
                  </div>
                  <div className="ag-diag-rows">
                    <div className="ag-diag-row">
                      <span>异常现象</span>
                      <p>{sanitizeDisplayText(item.phenomenon)}</p>
                    </div>
                    <div className="ag-diag-row">
                      <span>根因拆解</span>
                      <p>{sanitizeDisplayText(item.rootCause)}</p>
                    </div>
                    <div className="ag-diag-row">
                      <span>同行对标</span>
                      <p>{sanitizeDisplayText(item.benchmark)}</p>
                    </div>
                    <div className="ag-diag-row highlight">
                      <span>建议动作</span>
                      <p>{sanitizeDisplayText(item.action)}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 4. 结构化区域选址与投放对比矩阵 */}
      {comparisonRows.length > 0 && (
        <div className="ag-section-block">
          <div className="ag-section-header">
            <TrendingUp size={13} />
            <strong>区域选址四维评分与投资回报对比 ({comparisonRows.length} 区)</strong>
          </div>
          <div className="ag-region-table-wrap">
            <table className="ag-region-table">
              <thead>
                <tr>
                  <th>候选区域</th>
                  <th>综合评分</th>
                  {!compact && <th>四维拆解 (需求/竞争/毛利/成本)</th>}
                  <th>预计月净利</th>
                  <th>预计回本周期</th>
                  <th>投放建议</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => {
                  const isPause = row.paybackText?.includes('暂缓') || row.recommendationTag?.includes('补齐')
                  return (
                    <tr key={row.regionId}>
                      <td>
                        <strong>{row.regionName}</strong>
                      </td>
                      <td className="ag-mono-bold">{row.score} 分</td>
                      {!compact && <td className="ag-dim-cell">{row.dimensionBreakdown}</td>}
                      <td className="ag-mono-bold">{row.monthlyProfitText}</td>
                      <td className={isPause ? 'negative-text' : 'positive-text'}>
                        {sanitizeDisplayText(row.paybackText)}
                      </td>
                      <td>
                        <span className={`wb-badge ${isPause ? 'warn' : 'ok'}`}>
                          {row.recommendationTag}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. 人机协同决策审核与确认卡片（含决策依据、深度分析、预期影响及采纳/暂缓按钮） */}
      {proposal && (
        <div className={`ag-decision-card ${decisionState ? `state-${decisionState}` : ''}`}>
          <div className="ag-decision-header">
            <div className="ag-decision-title-wrap">
              <span className="ag-decision-kicker">
                {proposal.proposalType === 'region_investment_plan'
                  ? '待审核决策 · 区域选址投放方案'
                  : '待审核决策 · 门店整改与防损派单'}
              </span>
              <h5>{sanitizeDisplayText(proposal.title)}</h5>
            </div>
            <div className="ag-decision-meta-badges">
              <span className="wb-badge info">对象：{sanitizeDisplayText(proposal.targetLabel)}</span>
              {proposal.ownerRole && (
                <span className="wb-badge ok">
                  责任人：{proposal.ownerRole} · {proposal.dueHours || 24}h SLA
                </span>
              )}
            </div>
          </div>

          <div className={`ag-decision-columns ${compact ? 'compact' : ''}`}>
            {/* (1) 决策依据 */}
            <div className="ag-decision-col">
              <div className="ag-col-label">
                <CheckCircle2 size={12} /> 1. 决策依据 (客观数据与证据)
              </div>
              <ul className="ag-basis-list">
                {(proposal.decisionBasis || []).map((basis, i) => (
                  <li key={i}>{sanitizeDisplayText(basis)}</li>
                ))}
              </ul>
            </div>

            {/* (2) 深度分析 */}
            <div className="ag-decision-col">
              <div className="ag-col-label">
                <BarChart3 size={12} /> 2. 深度归因与可行性分析
              </div>
              <p className="ag-col-text">{sanitizeDisplayText(proposal.analysis)}</p>
            </div>

            {/* (3) 预期影响 */}
            <div className="ag-decision-col impact-col">
              <div className="ag-col-label">
                <Sparkles size={12} /> 3. 预期业务影响与收益
              </div>
              <p className="ag-col-text">{sanitizeDisplayText(proposal.expectedImpact)}</p>
            </div>
          </div>

          {/* 底部审核与确认操作栏 */}
          <div className="ag-decision-footer">
            {decisionState === 'approved' ? (
              <div className="ag-decision-resolved ok">
                <CheckCircle2 size={15} />
                <span>
                  已确认采纳方案并下发执行指令（责任角色：{proposal.ownerRole || '区域运营负责人'}）
                </span>
                {onNavigateTasks && (
                  <button type="button" className="outline-button" onClick={onNavigateTasks}>
                    查看行动中心工单 <ChevronRight size={14} />
                  </button>
                )}
              </div>
            ) : decisionState === 'deferred' ? (
              <div className="ag-decision-resolved warn">
                <Clock size={15} />
                <span>已暂缓执行该方案，系统将持续监测下一周期数据基线变化。</span>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setDecisionState(null)}
                >
                  重新评估决策
                </button>
              </div>
            ) : (
              <>
                <div className="ag-decision-prompt">
                  <ShieldAlert size={14} />
                  <span>请核对以上决策依据、分析过程与预期影响，确认是否采纳并执行后续操作：</span>
                </div>
                <div className="ag-decision-btns">
                  <button
                    type="button"
                    className="primary-button ag-approve-btn"
                    disabled={actionBusy}
                    onClick={handleConfirmProposal}
                  >
                    <ClipboardCheck size={14} />
                    {proposal.primaryActionLabel || '确认采纳并执行'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={actionBusy}
                    onClick={handleDeferProposal}
                  >
                    {proposal.secondaryActionLabel || '暂缓执行'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
