import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const fixtureDir = join(process.cwd(), 'contracts', 'fixtures')
const agentFixtures = ['normal.json', 'single-finding.json', 'multiple-findings.json', 'insufficient-data.json']
const taskFixtures = ['improved-task.json', 'unresolved-task.json']
const severities = new Set(['high', 'medium', 'low'])
const toolNames = new Set([
  'get_dashboard',
  'run_audit',
  'compare_regions',
  'estimate_region_roi',
  'create_task',
  'verify_task',
  'write_report',
])

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertString(value, path) {
  assert(typeof value === 'string' && value.length > 0, `${path} must be a non-empty string`)
}

function validateFinding(finding, path) {
  assertString(finding.id, `${path}.id`)
  assertString(finding.deviceId, `${path}.deviceId`)
  assert(severities.has(finding.severity), `${path}.severity is invalid`)
  assertString(finding.title, `${path}.title`)
  assert(Array.isArray(finding.evidence), `${path}.evidence must be an array`)
  finding.evidence.forEach((item, index) => assertString(item, `${path}.evidence[${index}]`))
  assertString(finding.recommendation, `${path}.recommendation`)
}

function validateAgentFixture(value, file) {
  assertString(value.summary, `${file}.summary`)
  assert(Array.isArray(value.findings), `${file}.findings must be an array`)
  value.findings.forEach((finding, index) => validateFinding(finding, `${file}.findings[${index}]`))
  assert(Array.isArray(value.regionComparison), `${file}.regionComparison must be an array`)
  value.regionComparison.forEach((region, index) => {
    const path = `${file}.regionComparison[${index}]`
    assertString(region.regionId, `${path}.regionId`)
    assertString(region.name, `${path}.name`)
    assert(Number.isFinite(region.score) && region.score >= 0 && region.score <= 100, `${path}.score must be 0..100`)
    assert(Number.isFinite(region.estimatedMonthlyProfit), `${path}.estimatedMonthlyProfit must be a number`)
    assert(region.estimatedPaybackMonths === null || (Number.isFinite(region.estimatedPaybackMonths) && region.estimatedPaybackMonths >= 0), `${path}.estimatedPaybackMonths is invalid`)
    assert(Array.isArray(region.reasons), `${path}.reasons must be an array`)
    assert(Array.isArray(region.assumptions), `${path}.assumptions must be an array`)
  })
  assert(Array.isArray(value.recommendations), `${file}.recommendations must be an array`)
  assert(Array.isArray(value.assumptions), `${file}.assumptions must be an array`)
  assert(Array.isArray(value.toolCalls), `${file}.toolCalls must be an array`)
  value.toolCalls.forEach((call, index) => {
    assert(toolNames.has(call.toolName), `${file}.toolCalls[${index}].toolName is invalid`)
    assert(call.status === 'success' || call.status === 'error', `${file}.toolCalls[${index}].status is invalid`)
  })
}

function validateTaskFixture(value, file) {
  assert(value.scenario === 'improved-task' || value.scenario === 'unresolved-task', `${file}.scenario is invalid`)
  assert(value.status === 'closed' || value.status === 'escalated', `${file}.status is invalid`)
  assertString(value.verifyMetric, `${file}.verifyMetric`)
  assert(typeof value.targetMet === 'boolean', `${file}.targetMet must be boolean`)
  assertString(value.expectedAction, `${file}.expectedAction`)
}

async function loadFixture(file) {
  const value = JSON.parse(await readFile(join(fixtureDir, file), 'utf8'))
  if (agentFixtures.includes(file)) validateAgentFixture(value, file)
  else validateTaskFixture(value, file)
}

await Promise.all([...agentFixtures, ...taskFixtures].map(loadFixture))
console.log(`Validated ${agentFixtures.length + taskFixtures.length} contract fixtures.`)
