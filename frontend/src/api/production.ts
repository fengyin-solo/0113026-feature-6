import request from '@/utils/request'
import {
  WELL_OPTIONS,
  fetchImportTemplate,
  fetchProductionRows,
  previewImport,
  submitCorrections,
  deleteProductionRow,
  SubmitRowPayload,
  SubmitResultRow
} from '@/mock/productionServer'
import { BatchQcResult, ProductionRow, WellOption } from '@/utils/productionQc'

export interface ProductionQuery {
  wellIds: number[]
  startDate?: string
  endDate?: string
}

/**
 * 真实后端就绪后，将下列 mock 调用替换为 request 请求即可，
 * 入参/出参结构已按接口约定固化，页面无需改动：
 *   list    -> GET  /production/batch
 *   preview -> POST /production/batch/import/preview
 *   submit  -> POST /production/batch/submit
 */
const USE_MOCK = true

export function getProductionList(params: ProductionQuery): Promise<{ code: number; data: ProductionRow[] }> {
  if (USE_MOCK) {
    return fetchProductionRows(params).then((data) => ({ code: 200, data }))
  }
  return request({ url: '/production/batch', method: 'get', params })
}

export function previewProductionImport(params: {
  fileName: string
  content: string
} & ProductionQuery): Promise<{ code: number; data: BatchQcResult }> {
  if (USE_MOCK) {
    return previewImport(params).then((data) => ({ code: 200, data }))
  }
  return request({ url: '/production/batch/import/preview', method: 'post', data: params })
}

export function submitProductionCorrections(
  rows: SubmitRowPayload[]
): Promise<{ code: number; data: { accepted: SubmitResultRow[]; rejected: SubmitResultRow[] } }> {
  if (USE_MOCK) {
    return submitCorrections(rows).then((data) => ({ code: 200, data }))
  }
  return request({ url: '/production/batch/submit', method: 'post', data: rows })
}

export function removeProductionRow(key: string): Promise<{ code: number }> {
  if (USE_MOCK) {
    return deleteProductionRow(key).then(() => ({ code: 200 }))
  }
  return request({ url: `/production/batch/${encodeURIComponent(key)}`, method: 'delete' })
}

export function getWellGroupOptions(): Promise<{ code: number; data: WellOption[] }> {
  return Promise.resolve({ code: 200, data: WELL_OPTIONS })
}

export async function downloadImportTemplate(withSamples = false): Promise<{ fileName: string; content: string }> {
  const content = await fetchImportTemplate(withSamples)
  return {
    fileName: withSamples ? '生产日报导入样本（含异常）.csv' : '生产日报导入模板.csv',
    content
  }
}
