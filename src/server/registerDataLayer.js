/**
 * 把 Python 数据层注册进 Agent 的领域服务注入点（任务C 的桥接层入口）。
 *
 * 为什么需要这个文件：
 *   toolAdapter.js 的 7 个白名单工具并不直接调 HTTP，而是读
 *   getDomainServices() 里的函数。defaultDomainServices.js 提供的是
 *   一份内存模拟实现，同时留了 registerDomainServices() 这个口子等
 *   真实数据层接进来。本文件就是这个口子的接线工。
 *
 * 运行位置：Vite DevServer（Node），不是浏览器。
 *   vite.config.js 通过 configureServer 把 createApiMiddleware() 挂到
 *   dev server 上，/api/v1/agent/run 就是在进程内调 runAgent 的。
 *   所以这里可以用 process.env，也能直连 127.0.0.1:8787 的 Python 服务，
 *   而且 service_role key 始终留在 Python 侧，不会进浏览器。
 *
 * 兜底策略（与 dataLayerClient.js 的分工）：
 *   客户端把「连不上」返回成 null，把「明确拒绝」抛成带 status 的错误。
 *   这里据此二选一：
 *     null        → 落回内存实现，保证没起 Python 服务时前端也能演示
 *     抛 4xx 错误 → 原样上抛，让用户看到真实原因（如区域不存在）
 */

import { ApiContractError } from '../agent/safety.js'
import { getDomainServices, registerDomainServices } from '../agent/components/defaultDomainServices.js'
import {
  auditOperations as fetchAudit,
  compareRegions as fetchRegions,
  createTask as createTaskOnServer,
  estimateRegionROI as fetchRegionROI,
  getDashboardMetrics as fetchDashboard,
  isDataLayerEnabled,
  updateTaskStatus,
  verifyTask as verifyTaskOnServer,
} from './dataLayerClient.js'

// 严重度排序，用于从审计结果里挑出最该动手的那条
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 }

// Keep the original services: looking them up after registration would call
// this bridge again when Python is unavailable.
const fallbackServices = { ...getDomainServices() }

/**
 * 最近一次创建的任务。verifyTask 的入参只有 scenario（见 toolAdapter.js），
 * 没带 taskId，所以这里记住上一次建的单子，让「创建 → 复核」这条链闭合。
 * 单进程单用户演示够用；多用户并发时应改为按 sessionId 隔离。
 */
let lastTaskId = null

/** Python 侧的错误响应转成前端认识的 ApiContractError，保留原始 code。 */
function toContractError(error, fallbackCode = 'INTERNAL_ERROR') {
  if (error instanceof ApiContractError) return error
  if (typeof error.status === 'number') {
    return new ApiContractError(error.status, error.code || fallbackCode, error.message)
  }
  return error
}

/**
 * 调优先实现；返回 null 表示 Python 侧不可用，改用内存默认实现。
 * 注意返回的是「已经拿到结果」的 Promise，调用方不要再加括号调用。
 */
async function callWithFallback(primary, fallbackName, ...args) {
  const result = await primary()
  if (result !== null && result !== undefined) return result
  return fallbackServices[fallbackName](...args)
}

/** 找出当前最需要处置的发现：高风险优先，同级取第一条。 */
function pickTopFinding(findings) {
  if (!Array.isArray(findings) || findings.length === 0) return null
  return [...findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  )[0]
}

/**
 * 注册全部领域服务。幂等：重复调用只会覆盖同一批函数。
 * 返回实际的接线状态，便于启动日志如实告知当前数据源。
 */
export function registerDataLayerServices() {
  if (!isDataLayerEnabled()) return describeDataLayerStatus()
  const defaults = fallbackServices

  registerDomainServices({
    // --- 1. get_dashboard ------------------------------------------------
    getDashboardMetrics: async (filters = {}) => {
      try {
        return await callWithFallback(
          () => fetchDashboard(filters),
          'getDashboardMetrics',
          { ...filters },
        )
      } catch (error) {
        throw toContractError(error)
      }
    },

    // --- 2. run_audit ----------------------------------------------------
    auditOperations: async (filters = {}) => {
      try {
        return await callWithFallback(
          () => fetchAudit(filters),
          'auditOperations',
          filters,
        )
      } catch (error) {
        throw toContractError(error)
      }
    },

    // --- 3. compare_regions ----------------------------------------------
    // toolAdapter 直接把返回值当数组用（safety.js 的
    // collectAllowedNumbers 对 regionComparison 调 forEach），
    // 而客户端返回的是 { regions, count } 信封，这里必须拆开。
    compareRegions: async (regionIds) => {
      try {
        const result = await fetchRegions(regionIds)
        if (result && Array.isArray(result.regions)) return result.regions
        return defaults.compareRegions(regionIds)
      } catch (error) {
        throw toContractError(error)
      }
    },

    // --- 4. estimate_region_roi ------------------------------------------
    estimateRegionROI: async (regionId) => {
      try {
        const result = await fetchRegionROI(regionId)
        if (result) return result
        return defaults.estimateRegionROI(regionId)
      } catch (error) {
        throw toContractError(error)
      }
    },

    // --- 5. create_task --------------------------------------------------
    // toolAdapter 的 schema 只有 ownerRole / dueHours / action，没有
    // findingId。所以这里先取一次当前审计结果，挑出最严重的一条作为
    // 派单对象——也就是把「行动卡」锚定到真实证据上，而不是凭空造一条任务。
    createTask: async (actionCard = {}) => {
      const audit = await callWithFallback(() => fetchAudit({}), 'auditOperations', {})

      const finding = pickTopFinding(audit?.findings)
      if (!finding) {
        throw new ApiContractError(
          422,
          'INSUFFICIENT_DATA',
          '当前没有可派单的经营发现，无法创建任务。',
        )
      }

      const task = await createTaskOnServer({
        findingId: finding.id,
        actionCard: {
          ownerRole: actionCard.ownerRole,
          dueHours: actionCard.dueHours,
          action: actionCard.action,
          problem: finding.title,
        },
      })

      lastTaskId = task?.task_id || null

      // 返回形状对齐 defaultCreateTask，保证 orchestrator 侧无感切换
      return {
        taskId: task?.task_id || null,
        status: task?.status || 'open',
        ownerRole: task?.owner_role || actionCard.ownerRole || '区域经理',
        dueHours: task?.due_hours ?? actionCard.dueHours ?? 24,
        action: task?.action || actionCard.action || finding.recommendation,
        findingId: finding.id,
        severity: finding.severity,
      }
    },

    // --- 6. verify_task --------------------------------------------------
    // scenario 是契约里的两个固定剧本：improved（达标关闭）/
    // unresolved（未达标升级）。targetMet 因此由剧本直接决定，
    // 不需要也不应该再去猜。
    verifyTask: async ({ scenario = 'improved-task' } = {}) => {
      const targetMet = scenario !== 'unresolved-task'

      if (!lastTaskId) {
        // 没建过单子就复核：内存实现返回的是一份剧本样例，
        // 这里也照做，避免演示流程因为少了第 5 步而直接报错。
        return defaults.verifyTask({ scenario })
      }

      const task = await verifyTaskOnServer({ taskId: lastTaskId, targetMet })

      return {
        taskId: task?.task_id || lastTaskId,
        scenario,
        status: task?.status || (targetMet ? 'closed' : 'escalated'),
        verifyMetric: task?.verify_metric || 'refund_rate',
        verifyTarget: task?.verify_target || null,
        targetMet,
        expectedAction: task?.expected_action
          || (targetMet ? '保存复核证据并关闭任务' : '保留原证据并升级任务'),
      }
    },

    // --- 7. write_report -------------------------------------------------
    // 报告目前没有落库表（DATABASE_AND_WIKI_SPEC 未定义 reports），
    // 因此维持内存实现，不假装持久化。
    writeReport: defaults.writeReport,
  })

  return describeDataLayerStatus()
}

/** 启动时探一次 Python 服务，返回可打印的状态说明。 */
export async function describeDataLayerStatus() {
  if (!isDataLayerEnabled()) {
    return { source: 'memory', detail: 'DATA_LAYER_ENABLED=0，桥接已关闭' }
  }
  try {
    const { checkDataLayerHealth } = await import('./dataLayerClient.js')
    const health = await checkDataLayerHealth()
    if (health?.ok) {
      return {
        source: 'python',
        detail: `已连接 Python 数据层（dataVersion=${health.dataVersion || '未知'}）`,
      }
    }
    return { source: 'memory', detail: `Python 数据层不可用：${health?.reason || '未知原因'}` }
  } catch (error) {
    return { source: 'memory', detail: `健康检查失败：${error.message}` }
  }
}

export { updateTaskStatus }
