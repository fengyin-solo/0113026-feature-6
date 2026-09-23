/**
 * 生产日报模拟后端
 * 前端演示工程暂无真实服务端，这里用内存库模拟接口响应；
 * 质控口径直接复用 utils/productionQc，保证“服务端复校”与前端一致。
 */
import {
  ProductionRow,
  WellOption,
  activeIssues,
  keyOf,
  runQc,
  validateCsvContent,
  BatchQcResult
} from '@/utils/productionQc'

const delay = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms))

export const WELL_OPTIONS: WellOption[] = [
  { id: 1, wellCode: 'A-01', wellName: 'A-01井' },
  { id: 2, wellCode: 'B-03', wellName: 'B-03井' },
  { id: 3, wellCode: 'C-02', wellName: 'C-02井' },
  { id: 4, wellCode: 'D-05', wellName: 'D-05井' }
]

const WELL_NAME: Record<number, string> = Object.fromEntries(
  WELL_OPTIONS.map((w) => [w.id, w.wellName])
)
const WELL_CODE: Record<number, string> = Object.fromEntries(
  WELL_OPTIONS.map((w) => [w.id, w.wellCode])
)

/* ----------------------------- 种子数据 ----------------------------- */

function buildSeedData(): Map<string, ProductionRow> {
  const store = new Map<string, ProductionRow>()
  const startDate = new Date('2024-01-10T00:00:00')
  const cumulative: Record<number, number> = { 1: 125600, 2: 98300, 3: 152400, 4: 76200 }

  const push = (wellId: number, date: Date, overrides: Partial<ProductionRow> = {}): void => {
    const reportDate = date.toISOString().slice(0, 10)
    const offset = Math.round((date.getTime() - startDate.getTime()) / 86400000)
    const base = [125, 98, 142, 76][wellId - 1]
    const oil = Math.max(20, base + 6 * Math.sin(offset / 2 + wellId))
    const hours = 24
    const cutBase = [73.5, 68.2, 81.4, 64.7][wellId - 1]
    const cut = Math.min(95, Math.max(20, cutBase + 1.2 * Math.sin(offset / 3 + wellId)))
    const water = (oil * cut) / (100 - cut)

    cumulative[wellId] += oil

    const row: ProductionRow = {
      key: keyOf(wellId, reportDate),
      wellId,
      wellCode: WELL_CODE[wellId],
      wellName: WELL_NAME[wellId],
      reportDate,
      productionHours: hours,
      oilProduction: Math.round(oil * 10) / 10,
      waterProduction: Math.round(water * 10) / 10,
      gasProduction: 8000 + wellId * 180 + offset * 12,
      waterCut: Math.round(cut * 10) / 10,
      cumulativeOil: Math.round(cumulative[wellId] * 10) / 10,
      issues: [],
      source: 'system',
      ...overrides
    }
    store.set(row.key, row)
  }

  for (let d = 0; d < 11; d++) {
    for (const well of WELL_OPTIONS) {
      push(well.id, new Date(startDate.getTime() + d * 86400000))
    }
  }

  // 注入典型异常，便于直观看到质控效果（均放在不引起连锁误报的位置）
  const at = (offset: number) => new Date(startDate.getTime() + offset * 86400000)
  const getRow = (wellId: number, date: Date) =>
    store.get(keyOf(wellId, date.toISOString().slice(0, 10)))!

  // 错误：生产时数超 24h
  {
    const row = getRow(2, at(5))
    store.set(row.key, { ...row, productionHours: 26 })
  }
  // 警告：末日产油量突变（同步修正当日累计，避免触发累计规则）
  {
    const prev = getRow(3, at(9))
    const last = getRow(3, at(10))
    store.set(last.key, { ...last, oilProduction: 260, cumulativeOil: prev.cumulativeOil + 260 })
  }
  // 警告：含水率与产液反算不一致
  {
    const row = getRow(1, at(8))
    store.set(row.key, { ...row, waterProduction: row.oilProduction * 4 })
  }
  // 错误：末日累计产量下降
  {
    const prev = getRow(4, at(9))
    const last = getRow(4, at(10))
    store.set(last.key, { ...last, cumulativeOil: prev.cumulativeOil - 30 })
  }

  const rows = [...store.values()]
  runQc(rows)
  rows.forEach((r) => store.set(r.key, r))

  return store
}

const dataStore = buildSeedData()

/* ----------------------------- 提交载体类型 ----------------------------- */

export interface SubmitRowPayload {
  key: string
  wellId: number
  reportDate: string
  productionHours: number
  oilProduction: number
  waterProduction: number
  gasProduction: number | null
  waterCut: number
  cumulativeOil: number
  /** 随提交带回的历史异常与修正痕迹，服务端原样保留并回填 */
  issues: ProductionRow['issues']
}

export interface SubmitResultRow extends ProductionRow {
  accepted: boolean
  rejectReason?: string
}

/* ----------------------------- 接口实现 ----------------------------- */

export async function fetchProductionRows(params: {
  wellIds: number[]
  startDate?: string
  endDate?: string
}): Promise<ProductionRow[]> {
  await delay()
  const rows = [...dataStore.values()]
    .filter((row) => params.wellIds.includes(row.wellId))
    .filter((row) => !params.startDate || row.reportDate >= params.startDate)
    .filter((row) => !params.endDate || row.reportDate <= params.endDate)
    .map((row) => JSON.parse(JSON.stringify(row)) as ProductionRow)
  runQc(rows)
  return rows
}

export async function previewImport(params: {
  fileName: string
  content: string
  wellIds: number[]
  startDate?: string
  endDate?: string
}): Promise<BatchQcResult> {
  await delay(400)
  const wells = WELL_OPTIONS.filter((w) => params.wellIds.includes(w.id))
  const existingKeys = new Set([...dataStore.keys()])
  const result = validateCsvContent(params.content, {
    wells,
    existingKeys,
    startDate: params.startDate,
    endDate: params.endDate
  })
  // 深拷贝，避免调用方修改影响后续提交
  return JSON.parse(JSON.stringify(result)) as BatchQcResult
}

export async function submitCorrections(
  payload: SubmitRowPayload[]
): Promise<{ accepted: SubmitResultRow[]; rejected: SubmitResultRow[] }> {
  await delay(500)

  // 以库中已有数据为上下文复校（覆盖回填后累计环比等跨行规则）
  const candidate: ProductionRow[] = payload.map((p) => ({
    key: p.key,
    wellId: p.wellId,
    wellCode: WELL_CODE[p.wellId],
    wellName: WELL_NAME[p.wellId],
    reportDate: p.reportDate,
    productionHours: p.productionHours,
    oilProduction: p.oilProduction,
    waterProduction: p.waterProduction,
    gasProduction: p.gasProduction,
    waterCut: p.waterCut,
    cumulativeOil: p.cumulativeOil,
    issues: p.issues,
    source: 'import' as const
  }))

  const context: ProductionRow[] = [...dataStore.values(), ...candidate].map((r) => ({
    ...(JSON.parse(JSON.stringify(r)) as ProductionRow),
    issues: []
  }))
  runQc(context)
  const resultByKey = new Map(context.map((r) => [r.key, r]))

  const accepted: SubmitResultRow[] = []
  const rejected: SubmitResultRow[] = []

  for (const row of candidate) {
    const rechecked = resultByKey.get(row.key) ?? row
    const carriedById = new Map(row.issues.map((i) => [i.id, i]))

    // 复校仍命中的异常：以服务端复校结果为准，合并客户端带回的修改痕迹
    const mergedActive = rechecked.issues.map((i) => {
      const carried = carriedById.get(i.id)
      return carried && carried.history.length > 0 ? { ...i, history: carried.history } : i
    })

    // 客户端携带、但服务端复校已不再现的异常：一律保留为“已修正”，
    // 即使客户端状态未及时刷新，质控结果与修改痕迹也不丢失
    const activeIds = new Set(mergedActive.map((i) => i.id))
    const carriedResolved = row.issues
      .filter((i) => !activeIds.has(i.id))
      .map((i) => ({ ...i, resolved: true, resolvedAt: i.resolvedAt ?? new Date().toISOString() }))

    rechecked.issues = [...mergedActive, ...carriedResolved]

    const errors = activeIssues(rechecked).filter((i) => i.level === 'error')
    if (errors.length > 0) {
      rejected.push({ ...rechecked, accepted: false, rejectReason: errors.map((e) => e.message).join('；') })
    } else {
      dataStore.set(rechecked.key, JSON.parse(JSON.stringify(rechecked)) as ProductionRow)
      accepted.push({ ...rechecked, accepted: true })
    }
  }

  return { accepted, rejected }
}

export async function deleteProductionRow(key: string): Promise<void> {
  await delay(200)
  dataStore.delete(key)
}

/** 生成导入模板（末行累计取库内最新值，避免一导入就产生累计环比异常） */
export async function fetchImportTemplate(withSamples = false): Promise<string> {
  await delay(100)
  const header = ['井号', '日期', '生产时数(h)', '日产油量(t)', '日产水量(t)', '产气量(m³)', '含水率(%)', '累计产油(t)']
  if (!withSamples) {
    const last = new Map<number, ProductionRow>()
    for (const row of dataStore.values()) {
      const cur = last.get(row.wellId)
      if (!cur || row.reportDate > cur.reportDate) last.set(row.wellId, row)
    }
    const blank = WELL_OPTIONS.map((w) => {
      const latest = last.get(w.id)
      const nextDate = '2024-01-21'
      const oil = [125, 98, 142, 76][w.id - 1]
      const cut = [73.5, 68.2, 81.4, 64.7][w.id - 1]
      const water = Math.round(((oil * cut) / (100 - cut)) * 10) / 10
      return [w.wellCode, nextDate, 24, oil, water, 8200, cut, Math.round((latest!.cumulativeOil + oil) * 10) / 10]
    })
    return [header, ...blank].map((line) => line.join(',')).join('\n')
  }

  // 演示样本：混合空行、坏行、重复行与各类业务异常
  const rows: (string | number)[][] = [
    header,
    ['A-01', '2024-01-21', 24, 126.2, 350.1, 8260, 73.5, 126351.8],
    ['B-03', '2024-01-21', 26, 99.5, 213.4, 7450, 68.2, 99377.5], // 生产时数超范围
    ['', '', '', '', '', '', '', ''], // 空行，自动跳过
    ['C-02', '2024-01-21', 24, 260.0, 620.5, 9100, 70.4, 153802.0], // 产油量突变
    ['A-01', '2024-01-15', 24, 126.8, 358.4, 8550, 73.8, 126226.2], // 与库中重复
    ['X-99', '2024-01-21', 24, 80, 120, 6000, 60, 100000], // 井号不存在
    ['D-05', '2024-01-21', 24, 75.2, 410.0, 6900, 64.7, 77026.8], // 含水率反算不一致
    ['D-05', 'bad-date', 24, 75, 200, 6900, 64, 77102], // 日期格式错误
    ['B-03', '2024-01-22', 24, 97.8, 210.1, 7460, 68.2, 98000.0], // 累计产量下降
    ['C-02', '2024-01-21', 24, 260.0, 620.5, 9100, 70.4, 153802.0] // 文件内重复，仅保留首条
  ]
  return rows.map((line) => line.map((v) => String(v)).join(',')).join('\n')
}
