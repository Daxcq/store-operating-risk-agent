/**
 * 第七层（工程层 - HTTP API 路由与契约网关）：api.js
 *
 * 职责：
 * 1. 严格实现 docs/API_CONTRACT.md 冻结的 4 个 HTTP 端点：
 *    - GET  /api/v1/dashboard
 *    - GET  /api/v1/audit
 *    - GET  /api/v1/regions
 *    - POST /api/v1/agent/run
 * 2. 统一转换查询参数（如 regionIds 逗号分隔去空格去重）与错误响应 { error: { code, message } }；
 * 3. 提供框架无关的 handleApiRequest 分发器与 Node/Vite Connect 中间件 createApiMiddleware。
 */

import { getDomainServices } from '../agent/components/defaultDomainServices.js'
import {
  ApiContractError,
  validateDashboardFilters,
  validateAuditFilters,
  parseRegionIdsParam,
  validateAgentRequest,
} from '../agent/safety.js'
import { runAgent } from '../agent/orchestrator.js'

/**
 * 契约规定的 5 个后端标准函数导出（对齐 docs/API_CONTRACT.md §4）
 */
export async function getDashboardMetrics(filters) {
  const cleaned = validateDashboardFilters(filters)
  return await getDomainServices().getDashboardMetrics(cleaned)
}

export async function auditOperations(filters) {
  const cleaned = validateAuditFilters(filters)
  return await getDomainServices().auditOperations(cleaned)
}

export async function compareRegions(regionIds) {
  const cleanedIds = parseRegionIdsParam(regionIds)
  return await getDomainServices().compareRegions(cleanedIds)
}

export async function estimateRegionROI(regionId) {
  if (typeof regionId !== 'string' || !regionId.trim()) {
    throw new ApiContractError(400, 'INVALID_QUERY', 'regionId 不能为空。')
  }
  return await getDomainServices().estimateRegionROI(regionId.trim())
}

export { runAgent }

/**
 * 框架无关的 HTTP API 请求核心处理器
 * @param {{ method: string, url: string, body?: any }} req
 * @returns {Promise<{ status: number, body: any }>}
 */
export async function handleApiRequest({ method = 'GET', url = '/', body = null }) {
  try {
    const parsedUrl = new URL(url, 'http://localhost')
    const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/'
    const searchParams = Object.fromEntries(parsedUrl.searchParams.entries())
    const upperMethod = method.toUpperCase()

    // 1. GET /api/v1/dashboard
    if (upperMethod === 'GET' && pathname === '/api/v1/dashboard') {
      const data = await getDashboardMetrics({
        regionId: searchParams.regionId,
        from: searchParams.from,
        to: searchParams.to,
      })
      return { status: 200, body: data }
    }

    // 2. GET /api/v1/audit
    if (upperMethod === 'GET' && pathname === '/api/v1/audit') {
      const data = await auditOperations({
        regionId: searchParams.regionId,
        from: searchParams.from,
        to: searchParams.to,
        deviceId: searchParams.deviceId,
        severity: searchParams.severity,
      })
      return { status: 200, body: data }
    }

    // 3. GET /api/v1/regions
    if (upperMethod === 'GET' && pathname === '/api/v1/regions') {
      const data = await compareRegions(searchParams.regionIds)
      return { status: 200, body: data }
    }

    // 4. POST /api/v1/agent/run
    if (upperMethod === 'POST' && pathname === '/api/v1/agent/run') {
      let parsedBody = body
      if (typeof body === 'string') {
        try {
          parsedBody = body.length > 0 ? JSON.parse(body) : {}
        } catch {
          throw new ApiContractError(400, 'INVALID_QUERY', '请求体不是合法的 JSON 格式。')
        }
      }
      validateAgentRequest(parsedBody)
      const data = await runAgent({
        query: parsedBody.query,
        sessionId: typeof parsedBody.sessionId === 'string' ? parsedBody.sessionId : null,
      })
      return { status: 200, body: data }
    }

    return {
      status: 404,
      body: {
        error: {
          code: 'NOT_FOUND',
          message: `未找到 API 路径：${upperMethod} ${pathname}`,
        },
      },
    }
  } catch (err) {
    if (err instanceof ApiContractError) {
      return {
        status: err.status,
        body: err.toJSON(),
      }
    }
    return {
      status: 500,
      body: {
        error: {
          code: 'INTERNAL_ERROR',
          message: err?.message || '服务内部错误',
        },
      },
    }
  }
}

/**
 * 供 Vite DevServer / PreviewServer 或 Node http.Server 挂载的中间件
 */
export function createApiMiddleware() {
  return async (req, res, next) => {
    if (!req.url || !req.url.startsWith('/api/v1')) {
      return next()
    }

    let rawBody = ''
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      rawBody = await new Promise((resolve, reject) => {
        let acc = ''
        req.on('data', (chunk) => {
          acc += chunk
        })
        req.on('end', () => resolve(acc))
        req.on('error', reject)
      })
    }

    const result = await handleApiRequest({
      method: req.method,
      url: req.url,
      body: rawBody,
    })

    res.statusCode = result.status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(result.body))
  }
}
