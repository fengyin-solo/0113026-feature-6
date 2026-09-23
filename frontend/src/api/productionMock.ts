/**
 * 生产日报批量质控的前端模拟服务。
 * 真实后端落地时，仅需将 @/api/production.ts 中的实现替换为 request 调用，
 * 入参与返回结构保持一致（parseProductionCsv/runQc 为纯函数，可平移到服务端）。
 */
import {
  parseProductionCsv,
  runQc,
  partitionRows,
  draftToRecord,
  rowStatus,
  type ProductionRecord,
  type QcResult,
  type QcRow,
  type QcContext,
  type CommitResult,
  type CommitSummary,
  type QcRowDraft
} from '@/utils/productionQc'

export interface WellGroup {
  id: string
  groupName: string
  wellIds: number[]
}

export interface WellInfo {
  id: number
  wellName: string
  groupId: string
}

export interface ProductionQuery {
  wellIds: number[]
  startDate: string
  endDate: string
}

const STORAGE_KEY = 'mock_production_records_v1'

export const WELL_GROUPS: WellGroup[] = [
  { id: 'g1', groupName: '一号井组', wellIds: [1, 2, 3] },
  { id: 'g2', groupName: '二号井组', wellIds: [4, 5, 6] }
]

export const WELLS: WellInfo[] = [
  { id: 1, wellName: 'A-01井', groupId: 'g1' },
  { id: 2, wellName: 'A-02井', groupId: 'g1' },
  { id: 3, wellName: 'A-03井', groupId: 'g1' },
  { id: 4, wellName: 'B-01井', groupId: 'g2' },
  { id: 5, wellName: 'B-02井', groupId: 'g2' },
  { id: 6, wellName: 'B-03井', groupId: 'g2' }
]

const WELL_MAP = new Map(WELLS.map((w) => [w.id, w.wellName]))

function delay<T>(data: T, ms = 300): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(data), ms))
}

/* ------------------------------ 存储 ------------------------------ */

function seedRecords(): ProductionRecord[] {
  const records: ProductionRecord[] = []
  const base = new Date('2026-09-22T00:00:00')
  const oilBase: Record<number, number> = { 1: 120, 2: 95, 3: 60, 4: 140, 5: 80, 6: 110 }
  WELLS.forEach((well, wi) => {
    let cum = 100000 + wi * 23000
    for (let d = 20; d >= 1; d--) {
      const date = new Date(base)
      date.setDate(base.getDate() - d)
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      // 偶发停机与波动，便于演示质控
      const stopped = d === 7 && well.id === 2
      const hours = stopped ? 0 : 20 + ((d + wi) % 5)
      const oil = stopped ? 0 : Math.round((oilBase[well.id] * (0.85 + ((d * 7 + wi) % 10) / 30)) * 10) / 10
      const water = Math.round(oil * (2.2 + (wi % 3) * 0.4) * 10) / 10
      const cut = Math.round((water / (oil + water)) * 1000) / 10
      cum += oil
      records.push({
        wellId: well.id,
        wellName: well.wellName,
        reportDate: dateStr,
        productionHours: hours,
        oilProduction: oil,
        waterProduction: water,
        gasProduction: 8000 + ((d * 137 + wi * 53) % 2000),
        waterCut: cut,
        cumulativeOil: Math.round(cum * 10) / 10,
        tubingPressure: stopped ? 0 : Math.round((6 + ((d + wi) % 30) / 10) * 10) / 10,
        casingPressure: Math.round((9 + ((d * 2 + wi) % 30) / 10) * 10) / 10,
        batchId: 'seed',
        status: 'valid',
        issues: []
      })
    }
  })
  return records
}

function loadRecords(): ProductionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as ProductionRecord[]
  } catch {
    // ignore corrupted storage
  }
  const seeded = seedRecords()
  saveRecords(seeded)
  return seeded
}

function saveRecords(records: ProductionRecord[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch {
    // storage 不可用时退化为内存态
  }
}

/* ------------------------------ 接口 ------------------------------ */

export function fetchWells() {
  return delay(WELLS)
}

export function fetchWellGroups() {
  return delay(WELL_GROUPS)
}

export function queryProduction(params: ProductionQuery): Promise<ProductionRecord[]> {
  const records = loadRecords()
    .filter(
      (r) =>
        params.wellIds.includes(r.wellId) &&
        r.reportDate >= params.startDate &&
        r.reportDate <= params.endDate
    )
    .sort((a, b) => (a.reportDate === b.reportDate ? a.wellId - b.wellId : a.reportDate < b.reportDate ? -1 : 1))
  return delay(records)
}

export interface BatchQcParams extends ProductionQuery {
  fileName: string
  content: string
}

/**
 * 批量质控：解析 -> 逐条规则校验 -> 按 通过/异常/失败 分组返回。
 * 空文件、结构错误时 totalRows=0，rows 为空并携带 failureReason。
 */
export function batchQc(params: BatchQcParams): Promise<{ result: QcResult | null; failureReason?: string }> {
  const parsed = parseProductionCsv(params.content)
  if (parsed.headerError) {
    return delay({ result: null, failureReason: parsed.headerError })
  }

  const ctx: QcContext = {
    wellMap: WELL_MAP,
    wellIds: params.wellIds,
    startDate: params.startDate,
    endDate: params.endDate,
    existing: loadRecords()
  }
  const rows = runQc(parsed.drafts, ctx)
  const { failureRows, abnormalRows, validRows } = partitionRows(rows)
  const result: QcResult = {
    batchId: `B${Date.now()}`,
    importedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    wellIds: params.wellIds,
    startDate: params.startDate,
    endDate: params.endDate,
    totalRows: rows.length,
    rows,
    failureRows,
    abnormalRows,
    validRows
  }
  return delay(result.totalRows === 0 ? { result: null, failureReason: '文件为空或没有可识别的数据行' } : { result })
}

export interface BatchCommitParams {
  batchId: string
  wellIds: number[]
  startDate: string
  endDate: string
  rows: QcRowDraft[]
}

/**
 * 提交回填：服务端再次质控（防止前端改值后跳过校验），
 * 仅写入无 error 的行；文件内重复、与库内重复均列为失败原样返回并列出原因。
 */
export function batchCommit(params: BatchCommitParams): Promise<CommitResult> {
  const all = loadRecords()
  const ctx: QcContext = {
    wellMap: WELL_MAP,
    wellIds: params.wellIds,
    startDate: params.startDate,
    endDate: params.endDate,
    existing: all
  }
  const rows = runQc(params.rows, ctx)
  const summary: CommitSummary = { inserted: 0, updated: 0, skipped: 0, warningCommitted: 0 }

  rows.forEach((row) => {
    if (rowStatus(row) === 'failed') {
      summary.skipped += 1
      return
    }
    const record = draftToRecord(row, params.batchId)
    const idx = all.findIndex((r) => r.wellId === record.wellId && r.reportDate === record.reportDate)
    if (idx >= 0) {
      all[idx] = record
      summary.updated += 1
    } else {
      all.push(record)
      summary.inserted += 1
    }
    if (record.status === 'abnormal') summary.warningCommitted += 1
  })

  saveRecords(all)
  return delay({ batchId: params.batchId, rows, summary })
}

/** 修正后重新执行质控（不落库），供回填界面临场校验 */
export function recheckProductionBatch(rows: QcRowDraft[], params: ProductionQuery): Promise<QcRow[]> {
  const ctx: QcContext = {
    wellMap: WELL_MAP,
    wellIds: params.wellIds,
    startDate: params.startDate,
    endDate: params.endDate,
    existing: loadRecords()
  }
  return delay(runQc(rows, ctx))
}

/** 最近一批质控结果的提交状态（用于回填后仍保留质控结论） */
export function fetchCommittedRows(batchId: string): Promise<ProductionRecord[]> {
  return delay(loadRecords().filter((r) => r.batchId === batchId))
}
