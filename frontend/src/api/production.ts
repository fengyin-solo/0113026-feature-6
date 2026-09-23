import {
  fetchWells,
  fetchWellGroups,
  queryProduction,
  batchQc,
  batchCommit,
  recheckProductionBatch as recheckMock,
  fetchCommittedRows,
  type ProductionQuery,
  type BatchQcParams,
  type BatchCommitParams
} from './productionMock'
import type { ProductionRecord, QcResult, CommitResult, QcRowDraft } from '@/utils/productionQc'

export interface ApiResult<T> {
  code: number
  message: string
  data: T
}

export interface BatchQcResponse {
  result: QcResult | null
  failureReason?: string
}

/**
 * 以下接口当前由前端模拟服务实现。对接真实后端时，将函数体替换为
 * request({ url, method, data }) 即可，入参/返回结构无需调整。
 */
export function getWellList() {
  return fetchWells()
}

export function getWellGroups() {
  return fetchWellGroups()
}

export function getProductionList(params: ProductionQuery): Promise<ProductionRecord[]> {
  return queryProduction(params)
}

export function checkProductionBatch(params: BatchQcParams): Promise<BatchQcResponse> {
  return batchQc(params)
}

export function commitProductionBatch(params: BatchCommitParams): Promise<CommitResult> {
  return batchCommit(params)
}

export function getCommittedBatch(batchId: string): Promise<ProductionRecord[]> {
  return fetchCommittedRows(batchId)
}

export function recheckProductionBatch(rows: QcRowDraft[], params: ProductionQuery) {
  return recheckMock(rows, params)
}

// 兼容旧调用方
export function getProductionDaily(_wellId: number, _params: Record<string, unknown>) {
  return Promise.resolve({ code: 200, message: 'success', data: null } as ApiResult<null>)
}
export function getProductionTrend(_wellId: number, _params: Record<string, unknown>) {
  return Promise.resolve({ code: 200, message: 'success', data: null } as ApiResult<null>)
}
export function getProductionSummary(_params: Record<string, unknown>) {
  return Promise.resolve({ code: 200, message: 'success', data: null } as ApiResult<null>)
}
export function submitProductionData(_data: Record<string, unknown>) {
  return Promise.resolve({ code: 200, message: 'success', data: null } as ApiResult<null>)
}
