/**
 * 生产日报批量质控逻辑（CSV 解析 + 逐条质控规则）。
 * 该模块为纯函数，质控规则与接口解耦，可被前端模拟接口或真实接口复用。
 */

export interface QcIssue {
  field: string
  level: 'error' | 'warn'
  message: string
}

export type EditableField =
  | 'wellId'
  | 'reportDate'
  | 'productionHours'
  | 'oilProduction'
  | 'waterProduction'
  | 'gasProduction'
  | 'waterCut'
  | 'cumulativeOil'
  | 'tubingPressure'
  | 'casingPressure'

export type QcRowStatus = 'valid' | 'abnormal' | 'failed'

export interface QcRowDraft {
  rowNo: number
  rawText: string
  parseError?: string
  wellId: string
  reportDate: string
  productionHours: string
  oilProduction: string
  waterProduction: string
  gasProduction: string
  waterCut: string
  cumulativeOil: string
  tubingPressure: string
  casingPressure: string
}

export interface QcRow extends QcRowDraft {
  wellName: string
  issues: QcIssue[]
}

export interface QcResult {
  batchId: string
  importedAt: string
  wellIds: number[]
  startDate: string
  endDate: string
  totalRows: number
  rows: QcRow[]
  failureRows: QcRow[]
  abnormalRows: QcRow[]
  validRows: QcRow[]
}

export interface CommitSummary {
  inserted: number
  updated: number
  skipped: number
  warningCommitted: number
}

export interface CommitResult {
  batchId: string
  rows: QcRow[]
  summary: CommitSummary
}

export interface ProductionRecord {
  wellId: number
  wellName: string
  reportDate: string
  productionHours: number | null
  oilProduction: number | null
  waterProduction: number | null
  gasProduction: number | null
  waterCut: number | null
  cumulativeOil: number | null
  tubingPressure: number | null
  casingPressure: number | null
  batchId: string
  status: QcRowStatus
  issues: QcIssue[]
}

export interface QcContext {
  /** 井档案：id -> 井名 */
  wellMap: Map<number, string>
  wellIds: number[]
  startDate: string
  endDate: string
  /** 已落库记录，用于重复导入判断及累计产量环比校验 */
  existing: ProductionRecord[]
}

export const FIELD_LABELS: Record<string, string> = {
  row: '数据行',
  wellId: '井编号',
  reportDate: '日期',
  productionHours: '生产时数',
  oilProduction: '日产油量',
  waterProduction: '日产水量',
  gasProduction: '日产气量',
  waterCut: '含水率',
  cumulativeOil: '累计产油',
  tubingPressure: '油压',
  casingPressure: '套压'
}

/** 合理区间：超出范围判定为硬错误 */
const RANGE: Record<string, [number, number]> = {
  productionHours: [0, 24],
  oilProduction: [0, 10000],
  waterProduction: [0, 20000],
  gasProduction: [0, 1000000],
  waterCut: [0, 100],
  cumulativeOil: [0, 100000000],
  tubingPressure: [0, 80],
  casingPressure: [0, 80]
}

/** 业务预警阈值（软异常，允许带提示回填） */
const HOURS_WARN_MAX = 8
const OIL_ZERO_HOURS_TOLERANCE = 0.1
const WATER_CUT_TOLERANCE = 3
const CUM_DIFF_RATIO = 0.2

export function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/* ------------------------------ CSV 解析 ------------------------------ */

const HEADER_ALIASES: Record<string, EditableField> = {
  井编号: 'wellId',
  井id: 'wellId',
  井号: 'wellId',
  井名: 'wellId',
  wellid: 'wellId',
  well: 'wellId',
  日期: 'reportDate',
  生产日期: 'reportDate',
  date: 'reportDate',
  reportdate: 'reportDate',
  生产时数: 'productionHours',
  生产时数h: 'productionHours',
  生产小时: 'productionHours',
  hours: 'productionHours',
  产油量: 'oilProduction',
  日产油量: 'oilProduction',
  日产油: 'oilProduction',
  oil: 'oilProduction',
  产水量: 'waterProduction',
  日产水量: 'waterProduction',
  water: 'waterProduction',
  产气量: 'gasProduction',
  日产气量: 'gasProduction',
  gas: 'gasProduction',
  含水率: 'waterCut',
  watercut: 'waterCut',
  累计产油: 'cumulativeOil',
  累计产量: 'cumulativeOil',
  累计产油量: 'cumulativeOil',
  cumulativeoil: 'cumulativeOil',
  油压: 'tubingPressure',
  tubingpressure: 'tubingPressure',
  套压: 'casingPressure',
  casingpressure: 'casingPressure'
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      cells.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur)
  return cells.map((c) => c.trim())
}

function normalizeDate(raw: string): string | null {
  const s = raw.trim().replace(/[./]/g, '-').replace(/年|月/g, '-').replace(/日/g, '')
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export interface ParsedCsv {
  headers: string[]
  drafts: QcRowDraft[]
  /** 结构性错误：列数不匹配等，行无法编辑 */
  headerError?: string
}

const EMPTY_DRAFT_FIELDS: Omit<QcRowDraft, 'rowNo' | 'rawText'> = {
  wellId: '',
  reportDate: '',
  productionHours: '',
  oilProduction: '',
  waterProduction: '',
  gasProduction: '',
  waterCut: '',
  cumulativeOil: '',
  tubingPressure: '',
  casingPressure: ''
}

export function parseProductionCsv(text: string): ParsedCsv {
  const clean = text.replace(/^﻿/, '')
  const lines = clean
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  if (lines.length === 0) {
    return { headers: [], drafts: [], headerError: '文件为空或没有可识别的数据行' }
  }

  const headerCells = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, ''))
  const fieldIndex = new Map<EditableField, number>()
  headerCells.forEach((h, idx) => {
    const field = HEADER_ALIASES[h]
    if (field && !fieldIndex.has(field)) fieldIndex.set(field, idx)
  })

  if (!fieldIndex.has('wellId') || !fieldIndex.has('reportDate')) {
    return { headers: headerCells, drafts: [], headerError: '缺少必需列：井编号、日期' }
  }

  const colCount = headerCells.length
  const drafts: QcRowDraft[] = []

  for (let i = 1; i < lines.length; i++) {
    const rawText = lines[i]
    const cells = splitCsvLine(rawText)
    const base: QcRowDraft = {
      ...EMPTY_DRAFT_FIELDS,
      rowNo: i + 1,
      rawText
    }
    if (cells.length !== colCount) {
      base.parseError = `列数不匹配（期望 ${colCount} 列，实际 ${cells.length} 列）`
      drafts.push(base)
      continue
    }
    fieldIndex.forEach((idx, field) => {
      ;(base as unknown as Record<string, string>)[field] = cells[idx] ?? ''
    })
    base.reportDate = normalizeDate(base.reportDate) ?? base.reportDate
    drafts.push(base)
  }

  return { headers: headerCells, drafts }
}

/* ------------------------------ 质控规则 ------------------------------ */

function toNum(raw: string): number | null {
  const s = raw.trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

interface ParsedNumbers {
  hours: number | null
  oil: number | null
  water: number | null
  gas: number | null
  cut: number | null
  cum: number | null
  tp: number | null
  cp: number | null
  invalid: string[]
}

function parseNumbers(row: QcRowDraft): ParsedNumbers {
  const invalid: string[] = []
  const read = (raw: string, field: string): number | null => {
    if (raw.trim() === '') return null
    const n = Number(raw)
    if (!Number.isFinite(n)) {
      invalid.push(field)
      return null
    }
    return n
  }
  return {
    hours: read(row.productionHours, 'productionHours'),
    oil: read(row.oilProduction, 'oilProduction'),
    water: read(row.waterProduction, 'waterProduction'),
    gas: read(row.gasProduction, 'gasProduction'),
    cut: read(row.waterCut, 'waterCut'),
    cum: read(row.cumulativeOil, 'cumulativeOil'),
    tp: read(row.tubingPressure, 'tubingPressure'),
    cp: read(row.casingPressure, 'casingPressure'),
    invalid
  }
}

function buildIssue(field: string, level: 'error' | 'warn', message: string): QcIssue {
  return { field, level, message: `${FIELD_LABELS[field] ?? field}：${message}` }
}

/**
 * 对一批草稿执行质控。
 * - error：结构/必填/范围/重复，不允许提交
 * - warn：业务预警（异常但可带提示回填）
 */
export function runQc(drafts: QcRowDraft[], ctx: QcContext): QcRow[] {
  const rows: QcRow[] = drafts.map((d) => {
    const issues: QcIssue[] = []
    let wellName = ''

    if (d.parseError) {
      issues.push(buildIssue('row', 'error', d.parseError))
      return { ...d, wellName, issues }
    }

    // 井编号
    const wellIdNum = toNum(d.wellId)
    if (d.wellId.trim() === '') {
      issues.push(buildIssue('wellId', 'error', '井编号为空'))
    } else if (wellIdNum === null || Number.isNaN(wellIdNum) || !Number.isInteger(wellIdNum)) {
      // 允许通过井名匹配井档案
      const matched = [...ctx.wellMap.entries()].find(([, name]) => name === d.wellId.trim())
      if (matched) {
        wellName = matched[1]
        d.wellId = String(matched[0])
      } else {
        issues.push(buildIssue('wellId', 'error', `井「${d.wellId}」不存在`))
      }
    } else if (!ctx.wellMap.has(wellIdNum)) {
      issues.push(buildIssue('wellId', 'error', `井 ${wellIdNum} 不存在`))
    } else if (!ctx.wellIds.includes(wellIdNum)) {
      issues.push(buildIssue('wellId', 'error', '该井不属于所选井组'))
    } else {
      wellName = ctx.wellMap.get(wellIdNum)!
    }

    // 日期
    if (d.reportDate.trim() === '') {
      issues.push(buildIssue('reportDate', 'error', '日期为空或格式错误'))
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(d.reportDate)) {
      issues.push(buildIssue('reportDate', 'error', '日期格式错误，应为 YYYY-MM-DD'))
    } else if (d.reportDate < ctx.startDate || d.reportDate > ctx.endDate) {
      issues.push(buildIssue('reportDate', 'error', `日期 ${d.reportDate} 超出导入时间区间`))
    }

    const num = parseNumbers(d)
    num.invalid.forEach((f) => issues.push(buildIssue(f, 'error', '数值格式错误')))

    // 必填项
    if (num.hours === null && d.productionHours.trim() === '') {
      issues.push(buildIssue('productionHours', 'error', '生产时数缺失'))
    }
    if (num.oil === null && d.oilProduction.trim() === '') {
      issues.push(buildIssue('oilProduction', 'error', '日产油量缺失'))
    }

    // 范围校验
    const numMap: Record<string, number | null> = {
      productionHours: num.hours,
      oilProduction: num.oil,
      waterProduction: num.water,
      gasProduction: num.gas,
      waterCut: num.cut,
      cumulativeOil: num.cum,
      tubingPressure: num.tp,
      casingPressure: num.cp
    }
    ;(Object.keys(RANGE) as Array<keyof typeof RANGE>).forEach((field) => {
      const v = numMap[field]
      if (v !== null) {
        const [min, max] = RANGE[field]
        if (v < min || v > max) {
          issues.push(buildIssue(field, 'error', `数值 ${v} 超出合理范围 [${min}, ${max}]`))
        }
      }
    })

    // 含水率：可由油水量推算时自动补全并提示
    if (num.cut === null && num.oil !== null && num.water !== null && num.oil + num.water > 0) {
      num.cut = round1((num.water / (num.oil + num.water)) * 100)
      d.waterCut = String(num.cut)
      issues.push(buildIssue('waterCut', 'warn', `缺失，已按油水量推算为 ${num.cut}%，请核对`))
    } else if (num.cut === null && d.waterCut.trim() === '') {
      issues.push(buildIssue('waterCut', 'warn', '含水率缺失且无法推算'))
    }
    if (num.cut !== null && num.oil !== null && num.water !== null && num.oil + num.water > 0) {
      const calc = (num.water / (num.oil + num.water)) * 100
      if (Math.abs(calc - num.cut) > WATER_CUT_TOLERANCE) {
        issues.push(buildIssue('waterCut', 'warn', `与油水量推算值 ${round1(calc)}% 偏差超过 ${WATER_CUT_TOLERANCE}%`))
      }
    }

    // 生产时数与产量的逻辑关系
    if (num.hours !== null && num.oil !== null) {
      if (num.hours < HOURS_WARN_MAX) {
        issues.push(buildIssue('productionHours', 'warn', `仅生产 ${num.hours}h，请确认是否停机或缺报`))
      }
      if (num.hours === 0 && num.oil > OIL_ZERO_HOURS_TOLERANCE) {
        issues.push(buildIssue('oilProduction', 'error', '生产时数为 0 却存在产量，数据矛盾'))
      }
      if (num.hours > 0 && num.oil === 0) {
        issues.push(buildIssue('oilProduction', 'warn', '有生产时数但日产油量为 0'))
      }
    }
    if (num.water !== null && num.water < 0) {
      issues.push(buildIssue('waterProduction', 'error', '日产水量不能为负'))
    }

    // 累计产量
    if (num.cum === null) {
      if (d.cumulativeOil.trim() === '') {
        issues.push(buildIssue('cumulativeOil', 'warn', '累计产油缺失，建议回填'))
      }
    } else {
      if (num.oil !== null && num.cum + 0.01 < num.oil) {
        issues.push(buildIssue('cumulativeOil', 'error', '累计产油小于当日产油量'))
      }
      const wid = wellIdNum
      if (wid && !Number.isNaN(wid)) {
        const prev = ctx.existing
          .filter((r) => r.wellId === wid && r.reportDate < d.reportDate)
          .sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1))[0]
        if (prev && prev.cumulativeOil !== null) {
          if (num.cum + 0.01 < prev.cumulativeOil) {
            issues.push(
              buildIssue(
                'cumulativeOil',
                'error',
                `累计产量较 ${prev.reportDate}（${prev.cumulativeOil}t）倒退`
              )
            )
          } else if (num.oil !== null && num.oil > 0) {
            const expected = prev.cumulativeOil + num.oil
            if (Math.abs(num.cum - expected) / expected > CUM_DIFF_RATIO) {
              issues.push(
                buildIssue(
                  'cumulativeOil',
                  'warn',
                  `环比增量与日产油量偏差较大（前日累计 ${prev.cumulativeOil}t，理论值约 ${round1(expected)}t）`
                )
              )
            }
          }
        } else if (d.reportDate > ctx.startDate) {
          // 无历史日报时无法环比校验
          issues.push(buildIssue('cumulativeOil', 'warn', '缺少前序日报，累计产量无法环比校验'))
        }
      }
    }

    // 压力软预警
    if (num.tp !== null && (num.tp > 30 || (num.hours !== null && num.hours > 0 && num.tp === 0))) {
      issues.push(buildIssue('tubingPressure', 'warn', '油压异常，请核对计量数据'))
    }
    if (num.cp !== null && num.cp > 30) {
      issues.push(buildIssue('casingPressure', 'warn', '套压异常，请核对计量数据'))
    }

    return { ...d, wellName, issues }
  })

  // 重复校验：文件内重复（保留第一条）+ 与已落库记录重复
  const seen = new Map<string, number>()
  rows.forEach((row) => {
    if (row.parseError) return
    const wid = Number(row.wellId)
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(row.reportDate)
    if (!Number.isInteger(wid) || !dateOk) return
    const key = `${wid}@${row.reportDate}`
    if (seen.has(key)) {
      row.issues.push(buildIssue('row', 'error', `文件内重复：与第 ${seen.get(key)} 行为同一口井同一天`))
    } else {
      seen.set(key, row.rowNo)
      if (ctx.existing.some((r) => r.wellId === wid && r.reportDate === row.reportDate)) {
        row.issues.push(buildIssue('row', 'error', '重复导入：该井当天日报已存在'))
      }
    }
  })

  // 同文件内按井/日期排序后校验累计产量倒退（已带倒退错误的行不重复标记）
  const byWell = new Map<number, QcRow[]>()
  rows.forEach((row) => {
    if (row.parseError) return
    const wid = Number(row.wellId)
    if (Number.isInteger(wid)) {
      const list = byWell.get(wid) ?? []
      list.push(row)
      byWell.set(wid, list)
    }
  })
  byWell.forEach((list) => {
    list
      .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.reportDate))
      .sort((a, b) => (a.reportDate < b.reportDate ? -1 : 1))
      .reduce<number | null>((lastCum, row) => {
        const cum = toNum(row.cumulativeOil)
        if (cum !== null) {
          if (lastCum !== null && cum + 0.01 < lastCum && !row.issues.some((i) => i.field === 'cumulativeOil' && i.message.includes('倒退'))) {
            row.issues.push(buildIssue('cumulativeOil', 'error', '同批次内累计产量倒退'))
          }
          return cum
        }
        return lastCum
      }, null)
  })

  return rows
}

export function rowStatus(row: QcRow): QcRowStatus {
  if (row.issues.some((i) => i.level === 'error')) return 'failed'
  if (row.issues.some((i) => i.level === 'warn')) return 'abnormal'
  return 'valid'
}

export function partitionRows(rows: QcRow[]) {
  const failureRows: QcRow[] = []
  const abnormalRows: QcRow[] = []
  const validRows: QcRow[] = []
  rows.forEach((r) => {
    const status = rowStatus(r)
    if (status === 'failed') failureRows.push(r)
    else if (status === 'abnormal') abnormalRows.push(r)
    else validRows.push(r)
  })
  return { failureRows, abnormalRows, validRows }
}

/** 将质控通过（含已核对的预警）的草稿转为生产记录 */
export function draftToRecord(row: QcRow, batchId: string): ProductionRecord {
  const n = (raw: string): number | null => {
    const v = Number(raw)
    return raw.trim() === '' || !Number.isFinite(v) ? null : v
  }
  const status = rowStatus(row)
  return {
    wellId: Number(row.wellId),
    wellName: row.wellName,
    reportDate: row.reportDate,
    productionHours: n(row.productionHours),
    oilProduction: n(row.oilProduction),
    waterProduction: n(row.waterProduction),
    gasProduction: n(row.gasProduction),
    waterCut: n(row.waterCut),
    cumulativeOil: n(row.cumulativeOil),
    tubingPressure: n(row.tubingPressure),
    casingPressure: n(row.casingPressure),
    batchId,
    status,
    issues: row.issues.filter((i) => i.level === 'warn')
  }
}
