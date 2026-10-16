/**
 * Shared API and domain contracts for the Retail Intelligence Agent.
 *
 * This file is intentionally dependency-free so the frontend and backend can
 * import it from the same package when the backend is added.
 */

export type AuditSeverity = 'high' | 'medium' | 'low'

export type RiskStatus = 'normal' | 'watch' | 'possible' | 'unavailable'

export interface AuditFinding {
  id: string
  deviceId: string
  severity: AuditSeverity
  title: string
  evidence: string[]
  recommendation: string
}

export interface AuditResult {
  summary: string
  findings: AuditFinding[]
}

export interface RegionResult {
  regionId: string
  name: string
  score: number
  estimatedMonthlyProfit: number
  estimatedPaybackMonths: number | null
  reasons: string[]
  assumptions: string[]
}

export interface AgentRequest {
  query: string
}

export type ToolCallStatus = 'success' | 'error'

export type AgentToolName =
  | 'get_dashboard'
  | 'run_audit'
  | 'compare_regions'
  | 'estimate_region_roi'
  | 'create_task'
  | 'verify_task'
  | 'write_report'

export interface AgentToolCall {
  toolName: AgentToolName
  status: ToolCallStatus
}

export interface AgentResponse {
  summary: string
  findings: AuditFinding[]
  regionComparison: RegionResult[]
  recommendations: string[]
  toolCalls: AgentToolCall[]
  assumptions: string[]
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
  }
}

export interface DashboardFilters {
  regionId?: string
  from?: string
  to?: string
}

export interface AuditFilters extends DashboardFilters {
  deviceId?: string
  severity?: AuditSeverity
}

export interface DashboardMetrics {
  salesAmount: number
  estimatedProfit: number
  deviceCount: number
  onlineRate: number
  openFindingCount: number
}

export type RegionIds = string[]

export type GetDashboardMetrics = (
  filters?: DashboardFilters,
) => Promise<DashboardMetrics>

export type AuditOperations = (
  filters?: AuditFilters,
) => Promise<AuditResult>

export type CompareRegions = (
  regionIds?: RegionIds,
) => Promise<RegionResult[]>

export type EstimateRegionROI = (
  regionId: string,
) => Promise<RegionResult>

export type RunAgent = (
  request: AgentRequest,
) => Promise<AgentResponse>

