/**
 * 生产日报批量质控纯函数库
 * 负责：CSV 解析、逐行结构校验、四类业务质控（生产时数 / 日产油量 / 含水率 / 累计产量）
 * 不依赖 Vue，可被页面与模拟后端复用，保证前后端质控口径一致。
 */

export type QcLevel = 'error' | 'warning'

export type QcField =
  | 'productionHours'
  | 'oilProduction'
  | 'waterProduction'
  | 'waterCut'
  | 'cumulativeOil'

export interface QcCorrection {
  field: QcField
  from: number | null
  to: number | null
  at: string
}

export interface QcIssue {
  id: string
  field: QcField
  rule: string
  level: QcLevel
  message: string
  expected?: number
  actual?: number
  /** 初始质控发现后，经修正已消除 */
  resolved: boolean
  resolvedAt?: string
  /** 该异常发生后用户对相关字段的修改痕迹，提交后不丢失 */
  history: QcCorrection[]
}

export interface ProductionRow {
  key: string
  wellId: number
  wellCode: string
  wellName: string
  reportDate: string
  productionHours: number
  oilProduction: number
  waterProduction: number
  gasProduction: number | null
  waterCut: number
  cumulativeOil: number
  issues: QcIssue[]
  source: 'system' | 'import'
}

export interface ImportFailure {
  /** 文件中的原始行号（含表头，从 1 开始） */
  rowNumber: number
  wellCode: string
  reportDate: string
  rawText: string
  reason: string
}

export interface BatchQcResult {
  validRows: ProductionRow[]
  failures: ImportFailure[]
  /** 非空数据行总数 */
  totalLines: number
  /** 表头无法识别时整体不可解析 */
  headerError?: string
}

export interface WellOption {
  id: number
  wellCode: string
  wellName: string
}

export interface ImportContext {
  wells: WellOption[]
  /** 库中已存在的 key，用于重复导入判定 */
  existingKeys: Set<string>
  startDate?: string
  endDate?: string
}

export const keyOf = (wellId: number | string, reportDate: string) => `${wellId}|${reportDate}`

/* ----------------------------- CSV 解析 ----------------------------- */

/** 解析 CSV，支持双引号包裹与转义引号 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function toCsvLine(values: (string | number)[]): string {
  return values
    .map((v) => {
      const s = String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    })
    .join(',')
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map(toCsvLine).join('\n')
}

/* ----------------------------- 表头映射 ----------------------------- */

const HEADER_ALIASES: Record<string, string[]> = {
  wellCode: ['井号', '井名', '井别', 'wellcode', 'well', 'code'],
  reportDate: ['日期', '生产日期', '日报日期', 'date', 'reportdate'],
  productionHours: ['生产时数', '生产小时', '生产时间', '时数', 'hours', 'productionhours'],
  oilProduction: ['日产油量', '日产油', '产油量', '油量', 'oil', 'oilproduction'],
  waterProduction: ['日产水量', '日产水', '产水量', '水量', 'water', 'waterproduction'],
  gasProduction: ['产气量', '产气', '气量', 'gas', 'gasproduction'],
  waterCut: ['含水率', '含水', 'watercut', 'cut', '含水百分数'],
  cumulativeOil: ['累计产油', '累计油量', '累计产油量', '累计油', 'cumulativeoil', 'cumoil']
}

const REQUIRED_FIELDS = [
  'wellCode',
  'reportDate',
  'productionHours',
  'oilProduction',
  'waterProduction',
  'waterCut',
  'cumulativeOil'
] as const

const FIELD_LABELS: Record<string, string> = {
  wellCode: '井号',
  reportDate: '日期',
  productionHours: '生产时数',
  oilProduction: '日产油量',
  waterProduction: '日产水量',
  gasProduction: '产气量',
  waterCut: '含水率',
  cumulativeOil: '累计产油'
}

function normalizeHeader(h: string): string {
  return h.replace(/^﻿/, '').replace(/[（(].*?[)）]/g, '').replace(/\s/g, '').toLowerCase()
}

function mapHeader(header: string[]): Record<string, number> {
  const indexMap: Record<string, number> = {}
  const normalized = header.map(normalizeHeader)
  for (const field of Object.keys(HEADER_ALIASES)) {
    const idx = normalized.findIndex((h) => HEADER_ALIASES[field].map(normalizeHeader).includes(h))
    if (idx >= 0) indexMap[field] = idx
  }
  return indexMap
}

/* ----------------------------- 基础解析 ----------------------------- */

const DATE_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/

export function parseReportDate(raw: string): string | null {
  const v = raw.trim()
  const m = DATE_RE.exec(v)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(year, month - 1, day)
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

function parseNumber(raw: string | undefined): { ok: boolean; value: number } {
  if (raw === undefined) return { ok: false, value: NaN }
  const v = raw.trim().replace(/,/g, '')
  if (v === '') return { ok: false, value: NaN }
  const n = Number(v)
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, value: NaN }
}

/* ----------------------------- 质控规则 ----------------------------- */

const HOURS_MAX = 24
const OIL_HARD_LIMIT = 300 // t/d，单井日产油绝对上限
const OIL_SPIKE_RATIO = 0.5 // 环比波动 50%
const CUT_TOLERANCE = 2 // 含水率反算偏差（百分点）
const CUM_TOLERANCE = 0.05 // 累计增量与日产油偏差 5%

interface IssueDraft {
  field: QcField
  rule: string
  level: QcLevel
  message: string
  expected?: number
  actual?: number
}

function evaluateRow(row: ProductionRow, prev?: ProductionRow): IssueDraft[] {
  const drafts: IssueDraft[] = []
  const r1 = (n: number) => Math.round(n * 10) / 10

  // 1. 生产时数
  if (row.productionHours < 0 || row.productionHours > HOURS_MAX) {
    drafts.push({
      field: 'productionHours',
      rule: 'hours_range',
      level: 'error',
      message: `生产时数 ${row.productionHours}h 超出 0~24h 合理范围`,
      actual: row.productionHours,
      expected: HOURS_MAX
    })
  } else if (row.productionHours === 0 && row.oilProduction > 0.5) {
    drafts.push({
      field: 'productionHours',
      rule: 'hours_zero_oil',
      level: 'warning',
      message: '生产时数为 0h，但日产油量大于 0，请确认时数或产量',
      actual: 0
    })
  } else if (row.productionHours >= HOURS_MAX && row.oilProduction <= 0.01) {
    drafts.push({
      field: 'productionHours',
      rule: 'hours_full_no_oil',
      level: 'warning',
      message: '满 24h 生产但日产油量为 0，请确认是否停机或漏报',
      actual: row.productionHours
    })
  }

  // 2. 日产油量（各规则独立命中，可分别修正、分别消除）
  if (row.oilProduction < 0) {
    drafts.push({
      field: 'oilProduction',
      rule: 'oil_negative',
      level: 'error',
      message: '日产油量不能为负数',
      actual: row.oilProduction
    })
  }
  if (row.oilProduction > OIL_HARD_LIMIT) {
    drafts.push({
      field: 'oilProduction',
      rule: 'oil_hard_limit',
      level: 'error',
      message: `日产油量 ${r1(row.oilProduction)}t 超过单井上限 ${OIL_HARD_LIMIT}t`,
      actual: r1(row.oilProduction),
      expected: OIL_HARD_LIMIT
    })
  }
  if (prev && prev.oilProduction > 1 && row.oilProduction >= 0) {
    const ratio = Math.abs(row.oilProduction - prev.oilProduction) / prev.oilProduction
    if (ratio > OIL_SPIKE_RATIO) {
      drafts.push({
        field: 'oilProduction',
        rule: 'oil_spike',
        level: 'warning',
        message: `日产油量环比波动 ${(ratio * 100).toFixed(0)}%（上日 ${r1(prev.oilProduction)}t → ${r1(row.oilProduction)}t）`,
        actual: r1(row.oilProduction),
        expected: r1(prev.oilProduction)
      })
    }
  }

  // 3. 含水率
  if (row.waterCut < 0 || row.waterCut > 100) {
    drafts.push({
      field: 'waterCut',
      rule: 'cut_range',
      level: 'error',
      message: `含水率 ${r1(row.waterCut)}% 超出 0~100% 范围`,
      actual: r1(row.waterCut)
    })
  } else {
    const total = row.oilProduction + row.waterProduction
    if (total > 0.1) {
      const calculated = (row.waterProduction / total) * 100
      if (Math.abs(calculated - row.waterCut) > CUT_TOLERANCE) {
        drafts.push({
          field: 'waterCut',
          rule: 'cut_consistency',
          level: 'warning',
          message: `含水率与产液量反算值 ${r1(calculated)}% 偏差超过 ${CUT_TOLERANCE} 个百分点`,
          actual: r1(row.waterCut),
          expected: r1(calculated)
        })
      }
    }
  }

  // 4. 累计产量
  if (row.cumulativeOil < 0) {
    drafts.push({
      field: 'cumulativeOil',
      rule: 'cum_negative',
      level: 'error',
      message: '累计产油量不能为负数',
      actual: row.cumulativeOil
    })
  }
  if (prev) {
    if (row.cumulativeOil < prev.cumulativeOil) {
      drafts.push({
        field: 'cumulativeOil',
        rule: 'cum_decrease',
        level: 'error',
        message: `累计产油量较上日下降（${r1(prev.cumulativeOil)}t → ${r1(row.cumulativeOil)}t）`,
        actual: r1(row.cumulativeOil),
        expected: r1(prev.cumulativeOil)
      })
    } else {
      const increment = row.cumulativeOil - prev.cumulativeOil
      const base = Math.max(row.oilProduction, 1)
      if (Math.abs(increment - row.oilProduction) / base > CUM_TOLERANCE) {
        drafts.push({
          field: 'cumulativeOil',
          rule: 'cum_increment',
          level: 'error',
          message: `累计增量 ${r1(increment)}t 与当日产油 ${r1(row.oilProduction)}t 偏差超过 ${CUM_TOLERANCE * 100}%`,
          actual: r1(increment),
          expected: r1(row.oilProduction)
        })
      }
    }
  }

  if (row.waterProduction < 0) {
    drafts.push({
      field: 'waterProduction',
      rule: 'water_negative',
      level: 'error',
      message: '日产水量不能为负数',
      actual: row.waterProduction
    })
  }

  return drafts
}

const issueIdOf = (field: QcField, rule: string) => `${field}:${rule}`

/**
 * 对一批日报执行质控（按井分组、按日期排序后逐日比对）。
 * 直接更新 row.issues：新发现的异常写入；此前存在、现已消除的异常保留并标记 resolved，
 * 修改痕迹 history 一并保留，确保质控结果不丢失。
 */
export function runQc(rows: ProductionRow[]): void {
  const groups = new Map<number, ProductionRow[]>()
  for (const row of rows) {
    const list = groups.get(row.wellId) ?? []
    list.push(row)
    groups.set(row.wellId, list)
  }

  for (const list of groups.values()) {
    list.sort((a, b) => a.reportDate.localeCompare(b.reportDate))
    let prev: ProductionRow | undefined
    for (const row of list) {
      const previous = new Map(row.issues.map((issue) => [issue.id, issue]))
      const nextIssues: QcIssue[] = []
      const activeIds = new Set<string>()

      for (const draft of evaluateRow(row, prev)) {
        const id = issueIdOf(draft.field, draft.rule)
        activeIds.add(id)
        const old = previous.get(id)
        nextIssues.push({
          id,
          field: draft.field,
          rule: draft.rule,
          level: draft.level,
          message: draft.message,
          expected: draft.expected,
          actual: draft.actual,
          resolved: false,
          history: old?.history ?? []
        })
      }

      // 此前发现、本次未再命中的异常：保留记录，标记已修正
      for (const old of previous.values()) {
        if (!activeIds.has(old.id)) {
          nextIssues.push({ ...old, resolved: true, resolvedAt: old.resolvedAt ?? new Date().toISOString() })
        }
      }

      row.issues = nextIssues
      prev = row
    }
  }
}

/* ----------------------------- 批量导入校验 ----------------------------- */

const cell = (line: string[], idx?: number) =>
  idx === undefined ? undefined : (line[idx] ?? '').trim()

/**
 * 解析并逐行校验导入文本。
 * 结构不合法（井号不存在、日期错误/超区间、必填缺失、文件内重复、与库中重复）计入 failures；
 * 业务数值异常不丢弃，进入 validRows 并带 issues，供用户逐条修正后一次提交。
 */
export function validateCsvContent(text: string, ctx: ImportContext): BatchQcResult {
  const empty: BatchQcResult = { validRows: [], failures: [], totalLines: 0 }
  const content = text.replace(/^﻿/, '')
  if (!content.trim()) return empty

  const matrix = parseCsv(content).filter((line) => line.some((c) => c.trim() !== ''))
  if (matrix.length === 0) return empty

  const headerIndex = mapHeader(matrix[0])
  const missing = REQUIRED_FIELDS.filter((f) => headerIndex[f] === undefined)
  if (missing.length > 0) {
    return { ...empty, headerError: `缺少必填列：${missing.map((f) => FIELD_LABELS[f]).join('、')}` }
  }

  const wellByCode = new Map<number | string, WellOption>()
  for (const well of ctx.wells) {
    wellByCode.set(well.wellCode.toLowerCase(), well)
    wellByCode.set(well.wellName.toLowerCase(), well)
  }

  const validRows: ProductionRow[] = []
  const failures: ImportFailure[] = []
  const seenKeys = new Set<string>()
  let totalLines = 0

  for (let i = 1; i < matrix.length; i++) {
    const line = matrix[i]
    if (line.every((c) => c.trim() === '')) continue
    totalLines++
    const rowNumber = i + 1
    const rawText = line.join(',').slice(0, 200)
    const wellRaw = cell(line, headerIndex.wellCode) ?? ''
    const dateRaw = cell(line, headerIndex.reportDate) ?? ''
    const fail = (reason: string): void => {
      failures.push({ rowNumber, wellCode: wellRaw, reportDate: dateRaw, rawText, reason })
    }

    const well = wellByCode.get(wellRaw.toLowerCase())
    if (!well) {
      fail(`井号「${wellRaw}」不在所选井组中`)
      continue
    }

    const reportDate = parseReportDate(dateRaw)
    if (!reportDate) {
      fail(`日期「${dateRaw}」格式错误，应为 YYYY-MM-DD`)
      continue
    }
    if (ctx.startDate && reportDate < ctx.startDate) {
      fail(`日期 ${reportDate} 早于导入区间起始日 ${ctx.startDate}`)
      continue
    }
    if (ctx.endDate && reportDate > ctx.endDate) {
      fail(`日期 ${reportDate} 晚于导入区间截止日 ${ctx.endDate}`)
      continue
    }

    const numericFields = ['productionHours', 'oilProduction', 'waterProduction', 'waterCut', 'cumulativeOil'] as const
    const numbers: Partial<Record<(typeof numericFields)[number], number>> = {}
    let numericError = ''
    for (const f of numericFields) {
      const parsed = parseNumber(cell(line, headerIndex[f]))
      if (!parsed.ok) {
        numericError = `${FIELD_LABELS[f]}缺失或不是有效数字`
        break
      }
      numbers[f] = parsed.value
    }
    if (numericError) {
      fail(numericError)
      continue
    }

    const gasParsed = parseNumber(cell(line, headerIndex.gasProduction))
    const gas = Number.isFinite(gasParsed.value) ? gasParsed.value : null

    const key = keyOf(well.id, reportDate)
    if (seenKeys.has(key)) {
      fail(`文件内重复：${well.wellName} ${reportDate} 的日报在本文件中出现多次，仅保留首条`)
      continue
    }
    if (ctx.existingKeys.has(key)) {
      fail(`重复导入：${well.wellName} ${reportDate} 的日报已存在，如需修正请在列表中操作`)
      continue
    }
    seenKeys.add(key)

    validRows.push({
      key,
      wellId: well.id,
      wellCode: well.wellCode,
      wellName: well.wellName,
      reportDate,
      productionHours: numbers.productionHours!,
      oilProduction: numbers.oilProduction!,
      waterProduction: numbers.waterProduction!,
      gasProduction: gas,
      waterCut: numbers.waterCut!,
      cumulativeOil: numbers.cumulativeOil!,
      issues: [],
      source: 'import'
    })
  }

  runQc(validRows)
  return { validRows, failures, totalLines }
}

/* ----------------------------- 状态辅助 ----------------------------- */

export const activeIssues = (row: ProductionRow): QcIssue[] => row.issues.filter((i) => !i.resolved)
export const hasError = (row: ProductionRow): boolean => activeIssues(row).some((i) => i.level === 'error')
export const hasWarning = (row: ProductionRow): boolean =>
  activeIssues(row).some((i) => i.level === 'warning') && !activeIssues(row).some((i) => i.level === 'error')
export const issueCount = (rows: ProductionRow[], level?: QcLevel): number =>
  rows.reduce(
    (sum, row) => sum + activeIssues(row).filter((i) => !level || i.level === level).length,
    0
  )
export const abnormalRowCount = (rows: ProductionRow[]): number =>
  rows.filter((row) => activeIssues(row).length > 0).length
