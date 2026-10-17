/**
 * 第三层（组件层 - 白名单工具注册表与 LangChain 工具适配器）：toolAdapter.js
 *
 * 职责：
 * 1. 使用 @langchain/core/tools 的 DynamicStructuredTool + zod 定义 7 个白名单工具；
 * 2. 严格将 snake_case 工具名映射到成员 B 的 camelCase 领域函数；
 * 3. 拦截一切不在白名单内的工具调用请求。
 */

import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { TOOL_REGISTRY_META, WHITELISTED_TOOL_NAMES } from '../definition.js'
import { getDomainServices } from './defaultDomainServices.js'

const VALID_TOOL_SET = new Set(WHITELISTED_TOOL_NAMES)

/**
 * 构造官方 LangChain DynamicStructuredTool 工具表
 */
export function buildLangChainTools() {
  const services = getDomainServices()

  const getDashboardTool = new DynamicStructuredTool({
    name: 'get_dashboard',
    description: TOOL_REGISTRY_META.get_dashboard.description,
    schema: z.object({
      regionId: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
    func: async (args) => {
      return await services.getDashboardMetrics(args)
    },
  })

  const runAuditTool = new DynamicStructuredTool({
    name: 'run_audit',
    description: TOOL_REGISTRY_META.run_audit.description,
    schema: z.object({
      regionId: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      deviceId: z.string().optional(),
      severity: z.enum(['high', 'medium', 'low']).optional(),
      _simulateInsufficient: z.boolean().optional(),
    }),
    func: async (args) => {
      if (args._simulateInsufficient) {
        throw new Error('INSUFFICIENT_DATA: 可比对象少于 3 个或关键字段缺失')
      }
      const { _simulateInsufficient, ...cleanFilters } = args
      return await services.auditOperations(cleanFilters)
    },
  })

  const compareRegionsTool = new DynamicStructuredTool({
    name: 'compare_regions',
    description: TOOL_REGISTRY_META.compare_regions.description,
    schema: z.object({
      regionIds: z.array(z.string()).optional(),
      _simulateInsufficient: z.boolean().optional(),
    }),
    func: async (args) => {
      if (args._simulateInsufficient) {
        throw new Error('INSUFFICIENT_DATA: 可比对象少于 3 个或关键字段缺失')
      }
      return await services.compareRegions(args.regionIds)
    },
  })

  const estimateRegionRoiTool = new DynamicStructuredTool({
    name: 'estimate_region_roi',
    description: TOOL_REGISTRY_META.estimate_region_roi.description,
    schema: z.object({
      regionId: z.string(),
    }),
    func: async (args) => {
      return await services.estimateRegionROI(args.regionId)
    },
  })

  const createTaskTool = new DynamicStructuredTool({
    name: 'create_task',
    description: TOOL_REGISTRY_META.create_task.description,
    schema: z.object({
      ownerRole: z.string().optional(),
      dueHours: z.number().optional(),
      action: z.string().optional(),
    }),
    func: async (args) => {
      return await services.createTask(args)
    },
  })

  const verifyTaskTool = new DynamicStructuredTool({
    name: 'verify_task',
    description: TOOL_REGISTRY_META.verify_task.description,
    schema: z.object({
      scenario: z.enum(['improved-task', 'unresolved-task']).optional(),
    }),
    func: async (args) => {
      return await services.verifyTask(args)
    },
  })

  const writeReportTool = new DynamicStructuredTool({
    name: 'write_report',
    description: TOOL_REGISTRY_META.write_report.description,
    schema: z.object({
      summary: z.string().optional(),
    }),
    func: async (args) => {
      return await services.writeReport(args)
    },
  })

  return {
    get_dashboard: getDashboardTool,
    run_audit: runAuditTool,
    compare_regions: compareRegionsTool,
    estimate_region_roi: estimateRegionRoiTool,
    create_task: createTaskTool,
    verify_task: verifyTaskTool,
    write_report: writeReportTool,
  }
}

/**
 * 校验工具名是否在白名单内
 */
export function isWhitelistedTool(toolName) {
  return VALID_TOOL_SET.has(toolName)
}
