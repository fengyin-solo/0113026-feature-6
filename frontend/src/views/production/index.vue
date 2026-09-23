<template>
  <div class="production-container">
    <!-- 筛选：井组 + 时间区间，列表/指标卡/趋势图共用同一筛选条件 -->
    <el-card class="mb-20">
      <el-form :inline="true" class="filter-form">
        <el-form-item label="井组">
          <el-select v-model="selectedGroup" placeholder="全部井" style="width: 160px" @change="handleGroupChange">
            <el-option label="全部井" :value="''" />
            <el-option v-for="g in groups" :key="g.id" :label="g.groupName" :value="g.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="井号">
          <el-select
            v-model="selectedWells"
            multiple
            collapse-tags
            collapse-tags-tooltip
            placeholder="选择井（可多选）"
            style="min-width: 280px"
            @change="loadData"
          >
            <el-option v-for="w in availableWells" :key="w.id" :label="w.wellName" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="时间区间">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            @change="loadData"
          />
        </el-form-item>
        <el-form-item>
          <el-button @click="resetFilter">重置</el-button>
          <el-button type="primary" @click="openImportDialog">
            <el-icon class="el-icon--left"><Upload /></el-icon>批量质控回填
          </el-button>
          <el-button @click="downloadTemplate">
            <el-icon class="el-icon--left"><Download /></el-icon>下载模板
          </el-button>
          <el-button @click="exportCsv">
            <el-icon class="el-icon--left"><Document /></el-icon>导出报表
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 最近一次质控结论：返回列表后仍保留，且与列表为同一批数据 -->
    <el-alert
      v-if="lastQc"
      class="mb-20"
      :type="lastQc.failureRows.length ? 'warning' : 'success'"
      :closable="true"
      @close="dismissQcBanner"
    >
      <template #title>
        <div class="qc-banner">
          <span>
            批次 {{ lastQc.batchId }}（{{ lastQc.importedAt }}）：共 {{ lastQc.totalRows }} 行，
            有效 {{ lastQc.validRows.length }} 行、异常已回填 {{ lastQc.abnormalRows.length }} 行、
            失败 {{ lastQc.failureRows.length }} 行，写入 {{ lastQc.summary.inserted + lastQc.summary.updated }} 条
          </span>
          <el-button type="primary" link @click="reopenQcResult">查看质控结果</el-button>
        </div>
      </template>
    </el-alert>

    <!-- 指标卡：统计口径来自 viewData -->
    <el-row :gutter="16" class="mb-20">
      <el-col :span="4">
        <div class="stat-card primary">
          <div class="stat-icon"><el-icon><Odometer /></el-icon></div>
          <div class="stat-info">
            <div class="stat-value">{{ stats.wellCount }}</div>
            <div class="stat-label">覆盖井数（口）</div>
          </div>
        </div>
      </el-col>
      <el-col :span="4">
        <div class="stat-card success">
          <div class="stat-icon"><el-icon><MagicStick /></el-icon></div>
          <div class="stat-info">
            <div class="stat-value">{{ stats.totalOil.toFixed(1) }}</div>
            <div class="stat-label">区间总产油(t)</div>
          </div>
        </div>
      </el-col>
      <el-col :span="4">
        <div class="stat-card warning">
          <div class="stat-icon"><el-icon><Sunny /></el-icon></div>
          <div class="stat-info">
            <div class="stat-value">{{ stats.avgDailyOil.toFixed(1) }}</div>
            <div class="stat-label">井均日产油(t)</div>
          </div>
        </div>
      </el-col>
      <el-col :span="4">
        <div class="stat-card info">
          <div class="stat-icon"><el-icon><WaterCold /></el-icon></div>
          <div class="stat-info">
            <div class="stat-value">{{ stats.avgWaterCut.toFixed(1) }}%</div>
            <div class="stat-label">平均含水率</div>
          </div>
        </div>
      </el-col>
      <el-col :span="4">
        <div class="stat-card purple">
          <div class="stat-icon"><el-icon><Clock /></el-icon></div>
          <div class="stat-info">
            <div class="stat-value">{{ stats.totalHours.toFixed(0) }}</div>
            <div class="stat-label">累计生产时数(h)</div>
          </div>
        </div>
      </el-col>
      <el-col :span="4">
        <div class="stat-card danger">
          <div class="stat-icon"><el-icon><WarningFilled /></el-icon></div>
          <div class="stat-info">
            <div class="stat-value">{{ stats.abnormalCount }}</div>
            <div class="stat-label">异常数据（条）</div>
          </div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="mb-20">
      <el-col :span="16">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>产量趋势（{{ startDate }} 至 {{ endDate }}）</span>
              <el-radio-group v-model="chartType" size="small">
                <el-radio-button value="oil">产油量</el-radio-button>
                <el-radio-button value="water">产水量</el-radio-button>
                <el-radio-button value="waterCut">含水率</el-radio-button>
                <el-radio-button value="hours">生产时数</el-radio-button>
              </el-radio-group>
            </div>
          </template>
          <div ref="trendChart" class="chart-large"></div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card>
          <template #header>
            <span>累计产量（截至 {{ endDate }}）</span>
          </template>
          <div class="cumulative-stats">
            <div class="cumulative-item">
              <div class="cumulative-label">累计产油(t)</div>
              <div class="cumulative-value">{{ stats.cumOil.toFixed(1) }}</div>
            </div>
            <div class="cumulative-item">
              <div class="cumulative-label">区间产水(t)</div>
              <div class="cumulative-value">{{ stats.cumWater.toFixed(1) }}</div>
            </div>
            <div class="cumulative-item">
              <div class="cumulative-label">区间产气(万m³)</div>
              <div class="cumulative-value">{{ stats.cumGasWan.toFixed(2) }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card>
      <template #header>
        <div class="card-header">
          <span>生产数据列表（{{ viewData.length }} 条）</span>
          <el-radio-group v-model="tableFilter" size="small">
            <el-radio-button value="all">全部</el-radio-button>
            <el-radio-button value="abnormal">仅异常</el-radio-button>
          </el-radio-group>
        </div>
      </template>
      <el-table
        :data="tableData"
        border
        stripe
        style="width: 100%"
        v-loading="loading"
        :row-class-name="rowClassName"
      >
        <el-table-column prop="reportDate" label="日期" width="110" sortable />
        <el-table-column prop="wellName" label="井名" width="100" />
        <el-table-column label="生产时数(h)" width="120">
          <template #default="{ row }">{{ fmt(row.productionHours) }}</template>
        </el-table-column>
        <el-table-column label="日产油量(t)" width="120">
          <template #default="{ row }">{{ fmt(row.oilProduction) }}</template>
        </el-table-column>
        <el-table-column label="日产水量(t)" width="120">
          <template #default="{ row }">{{ fmt(row.waterProduction) }}</template>
        </el-table-column>
        <el-table-column label="含水率(%)" width="150">
          <template #default="{ row }">
            <el-progress
              :percentage="Number(row.waterCut ?? 0)"
              :stroke-width="12"
              :show-text="true"
            />
          </template>
        </el-table-column>
        <el-table-column label="累计产油(t)" width="130">
          <template #default="{ row }">{{ fmt(row.cumulativeOil) }}</template>
        </el-table-column>
        <el-table-column label="质控" width="100" fixed="right">
          <template #default="{ row }">
            <el-tag v-if="row.status === 'abnormal'" type="warning" size="small">
              <el-popover :width="280" trigger="hover" placement="left">
                <template #reference>
                  <span>异常 {{ row.issues.length }} 项</span>
                </template>
                <div v-for="(iss, i) in row.issues" :key="i" class="issue-line">
                  <el-tag type="warning" size="small">预警</el-tag>
                  <span>{{ iss.message }}</span>
                </div>
              </el-popover>
            </el-tag>
            <el-tag v-else-if="row.status === 'failed'" type="danger" size="small">失败</el-tag>
            <el-tag v-else type="success" size="small">正常</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 批量导入 / 质控 / 回填 弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="readOnlyQc ? '质控结果（最近批次）' : '批量数据质控与回填'"
      width="1100px"
      top="5vh"
      :close-on-click-modal="false"
      @closed="handleDialogClosed"
    >
      <el-steps v-if="!readOnlyQc" :active="stepActive" align-center class="mb-20">
        <el-step title="选择井组与时间区间" />
        <el-step title="导入并质控" />
        <el-step title="逐条修正并提交" />
      </el-steps>

      <!-- Step 1: 选择范围 + 上传文件 -->
      <div v-if="!qcResult">
        <el-form label-width="110px">
          <el-form-item label="井组">
            <el-select v-model="importGroup" placeholder="选择井组" style="width: 240px" @change="handleImportGroupChange">
              <el-option v-for="g in groups" :key="g.id" :label="g.groupName" :value="g.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="导入井号">
            <el-select
              v-model="importWells"
              multiple
              collapse-tags
              collapse-tags-tooltip
              placeholder="选择需要导入的井"
              style="min-width: 420px"
            >
              <el-option v-for="w in importAvailableWells" :key="w.id" :label="w.wellName" :value="w.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="日报时间区间">
            <el-date-picker
              v-model="importDateRange"
              type="daterange"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              value-format="YYYY-MM-DD"
            />
          </el-form-item>
          <el-form-item label="日报文件">
            <el-upload
              ref="uploadRef"
              drag
              :auto-upload="false"
              :limit="1"
              accept=".csv,text/csv"
              :on-change="handleFileChange"
              :on-remove="handleFileRemove"
              :on-exceed="handleExceed"
            >
              <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
              <div class="el-upload__text">拖拽 CSV 文件到此处，或 <em>点击选择</em></div>
              <template #tip>
                <div class="el-upload__tip">
                  需包含列：井编号,日期,生产时数,日产油量,日产水量,含水率,累计产油；可先
                  <el-link type="primary" :underline="false" @click.stop="downloadTemplate">下载导入模板</el-link>
                </div>
              </template>
            </el-upload>
          </el-form-item>
          <el-alert
            v-if="fileError"
            :title="fileError"
            type="error"
            :closable="false"
            show-icon
            class="mb-20"
          />
        </el-form>
        <div class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="qcLoading" @click="runBatchQc">开始质控</el-button>
        </div>
      </div>

      <!-- Step 2/3: 质控结果 -->
      <div v-else-if="qcResult">
        <el-alert
          v-if="qcResult.failureRows.length"
          class="mb-20"
          type="warning"
          show-icon
          :closable="false"
          title="部分行未通过校验，仅有效行与已修正的异常行会被写入，失败行保留失败原因不写入。"
        />
        <div class="qc-summary mb-20">
          <el-tag type="info" size="large">共 {{ qcResult.totalRows }} 行</el-tag>
          <el-tag type="success" size="large">有效 {{ qcResult.validRows.length }}</el-tag>
          <el-tag type="warning" size="large">异常 {{ qcResult.abnormalRows.length }}</el-tag>
          <el-tag type="danger" size="large">失败 {{ qcResult.failureRows.length }}</el-tag>
          <el-button v-if="!readOnlyQc" size="small" :loading="recheckLoading" @click="recheckAll">
            全部重新质控
          </el-button>
        </div>

        <el-tabs v-model="activeTab">
          <el-tab-pane name="abnormal">
            <template #label>
              <span>异常待确认<el-badge :value="qcResult.abnormalRows.length" :hidden="!qcResult.abnormalRows.length" class="tab-badge" /></span>
            </template>
            <qc-row-table
              :rows="qcResult.abnormalRows"
              :readonly="readOnlyQc"
              @update="handleCellUpdate"
            />
          </el-tab-pane>
          <el-tab-pane name="valid">
            <template #label>
              <span>有效数据<el-badge :value="qcResult.validRows.length" :hidden="!qcResult.validRows.length" type="success" class="tab-badge" /></span>
            </template>
            <qc-row-table :rows="qcResult.validRows" :readonly="true" />
          </el-tab-pane>
          <el-tab-pane name="failed">
            <template #label>
              <span>失败 / 重复<el-badge :value="qcResult.failureRows.length" :hidden="!qcResult.failureRows.length" type="danger" class="tab-badge" /></span>
            </template>
            <qc-row-table
              :rows="qcResult.failureRows"
              :readonly="readOnlyQc"
              @update="handleCellUpdate"
            />
          </el-tab-pane>
        </el-tabs>

        <div class="dialog-footer">
          <el-button v-if="!readOnlyQc" @click="resetImport">重新导入</el-button>
          <el-button @click="dialogVisible = false">{{ readOnlyQc ? '关闭' : '取消' }}</el-button>
          <el-button
            v-if="!readOnlyQc"
            type="primary"
            :loading="commitLoading"
            @click="commitBatch"
          >
            一次提交修正（写入 {{ qcResult.validRows.length + qcResult.abnormalRows.length }} 条
            <template v-if="qcResult.failureRows.length">，跳过 {{ qcResult.failureRows.length }} 条</template>）
          </el-button>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import * as echarts from 'echarts'
import { ElMessage } from 'element-plus'
import type { UploadFile, UploadInstance } from 'element-plus'
import QcRowTable from './QcRowTable.vue'
import {
  getWellList,
  getWellGroups,
  getProductionList,
  checkProductionBatch,
  commitProductionBatch,
  recheckProductionBatch
} from '@/api/production'
import type { WellGroup } from '@/api/productionMock'
import {
  partitionRows,
  type ProductionRecord,
  type QcResult,
  type QcRow,
  type QcRowDraft,
  type CommitSummary
} from '@/utils/productionQc'

/* ------------------------------ 基础数据 ------------------------------ */

interface WellOption {
  id: number
  wellName: string
  groupId: string
}

const QC_STORAGE_KEY = 'last_production_qc_v1'

const wells = ref<WellOption[]>([])
const groups = ref<WellGroup[]>([])
const loading = ref(false)

const selectedGroup = ref('')
const selectedWells = ref<number[]>([])
const dateRange = ref<[string, string]>(['', ''])
const tableFilter = ref<'all' | 'abnormal'>('all')
const chartType = ref<'oil' | 'water' | 'waterCut' | 'hours'>('oil')

const records = ref<ProductionRecord[]>([])

const startDate = computed(() => dateRange.value[0] ?? '')
const endDate = computed(() => dateRange.value[1] ?? '')

const availableWells = computed(() =>
  selectedGroup.value ? wells.value.filter((w) => w.groupId === selectedGroup.value) : wells.value
)

/** 列表、指标卡、趋势图的唯一数据源 */
const viewData = computed(() => records.value)

const tableData = computed(() =>
  tableFilter.value === 'abnormal' ? viewData.value.filter((r) => r.status === 'abnormal') : viewData.value
)

function rowClassName({ row }: { row: ProductionRecord }) {
  return row.status === 'abnormal' ? 'row-abnormal' : row.status === 'failed' ? 'row-failed' : ''
}

function fmt(v: number | null): string {
  return v === null || v === undefined ? '—' : String(v)
}

function defaultDateRange(): [string, string] {
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - 13)
  const f = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return [f(start), f(end)]
}

async function loadData() {
  if (!selectedWells.value.length || !startDate.value || !endDate.value) return
  loading.value = true
  try {
    records.value = await getProductionList({
      wellIds: selectedWells.value,
      startDate: startDate.value,
      endDate: endDate.value
    })
    await nextTick()
    renderChart()
  } finally {
    loading.value = false
  }
}

function handleGroupChange() {
  selectedWells.value = availableWells.value.map((w) => w.id)
  loadData()
}

function resetFilter() {
  selectedGroup.value = ''
  selectedWells.value = wells.value.map((w) => w.id)
  dateRange.value = defaultDateRange()
  loadData()
}

/* ------------------------------ 指标卡 / 累计 ------------------------------ */

function sumField(list: ProductionRecord[], field: 'oilProduction' | 'waterProduction' | 'gasProduction' | 'productionHours') {
  return list.reduce((acc, r) => acc + (r[field] ?? 0), 0)
}

const stats = computed(() => {
  const list = viewData.value
  const wellSet = new Set(list.map((r) => r.wellId))
  const totalOil = sumField(list, 'oilProduction')
  const totalWater = sumField(list, 'waterProduction')
  const totalHours = sumField(list, 'productionHours')
  const totalGas = sumField(list, 'gasProduction')
  const dayCount = new Set(list.map((r) => r.reportDate)).size || 1
  const wellCount = wellSet.size || 1
  const cutValues = list.filter((r) => r.waterCut !== null).map((r) => r.waterCut as number)
  const avgWaterCut = cutValues.length ? cutValues.reduce((a, b) => a + b, 0) / cutValues.length : 0

  // 每口井取区间内最后一条累计值求和
  const lastByWell = new Map<number, ProductionRecord>()
  ;[...list]
    .sort((a, b) => (a.reportDate < b.reportDate ? -1 : 1))
    .forEach((r) => lastByWell.set(r.wellId, r))
  const cumOil = [...lastByWell.values()].reduce((a, r) => a + (r.cumulativeOil ?? 0), 0)
  // 累计产水/气：取最新累计油对应比例的近似口径不可得，此处采用区间内累计值（页面按区间统计）
  const cumWater = totalWater
  const cumGasWan = totalGas / 10000

  return {
    wellCount: wellSet.size,
    totalOil,
    totalWater,
    totalHours,
    avgDailyOil: totalOil / dayCount / wellCount,
    avgWaterCut,
    abnormalCount: list.filter((r) => r.status === 'abnormal').length,
    cumOil,
    cumWater,
    cumGasWan
  }
})

/* ------------------------------ 趋势图：按日期聚合 viewData ------------------------------ */

const trendChart = ref<HTMLElement>()
let chartInstance: echarts.ECharts | null = null

const CHART_META: Record<typeof chartType.value, { field: keyof ProductionRecord; name: string; unit: string }> = {
  oil: { field: 'oilProduction', name: '产油量', unit: 't' },
  water: { field: 'waterProduction', name: '产水量', unit: 't' },
  waterCut: { field: 'waterCut', name: '含水率', unit: '%' },
  hours: { field: 'productionHours', name: '生产时数', unit: 'h' }
}

function eachDateBetween(s: string, e: string): string[] {
  const out: string[] = []
  const cur = new Date(s + 'T00:00:00')
  const end = new Date(e + 'T00:00:00')
  while (cur <= end) {
    out.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
    )
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

function renderChart() {
  if (!trendChart.value) return
  if (!chartInstance) chartInstance = echarts.init(trendChart.value)
  const meta = CHART_META[chartType.value]
  const dates = eachDateBetween(startDate.value, endDate.value)
  const wellIds = [...new Set(viewData.value.map((r) => r.wellId))]
  const bucket = new Map<string, ProductionRecord[]>()
  viewData.value.forEach((r) => {
    const arr = bucket.get(r.reportDate) ?? []
    arr.push(r)
    bucket.set(r.reportDate, arr)
  })

  let series: echarts.SeriesOption[]
  if (wellIds.length <= 6 && wellIds.length > 1) {
    series = wellIds.map((wid) => {
      const wellName = wells.value.find((w) => w.id === wid)?.wellName ?? String(wid)
      return {
        name: wellName,
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: dates.map((d) => {
          const rec = bucket.get(d)?.find((r) => r.wellId === wid)
          return rec ? (rec[meta.field] as number | null) : null
        })
      }
    })
  } else {
    series = [
      {
        name: `${meta.name}(${meta.unit})`,
        type: 'line',
        smooth: true,
        areaStyle: { color: 'rgba(59, 130, 246, 0.12)' },
        itemStyle: { color: '#3b82f6' },
        data: dates.map((d) => {
          const rows = bucket.get(d) ?? []
          const vals = rows.map((r) => r[meta.field]).filter((v): v is number => v !== null)
          if (!vals.length) return null
          if (meta.field === 'waterCut') {
            return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
          }
          return Math.round(vals.reduce((a, b) => a + b, 0) * 10) / 10
        })
      }
    ]
  }

  chartInstance.setOption(
    {
      tooltip: { trigger: 'axis' },
      legend: wellIds.length > 1 && wellIds.length <= 6 ? { top: 0 } : undefined,
      grid: { left: '3%', right: '4%', bottom: '3%', top: wellIds.length > 1 && wellIds.length <= 6 ? 36 : 12, containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: dates.map((d) => d.slice(5)) },
      yAxis: { type: 'value', name: meta.unit },
      series
    },
    { notMerge: true }
  )
}

function handleResize() {
  chartInstance?.resize()
}

watch(chartType, () => renderChart())

/* ------------------------------ 批量导入质控 ------------------------------ */

const dialogVisible = ref(false)
const qcLoading = ref(false)
const commitLoading = ref(false)
const recheckLoading = ref(false)
const readOnlyQc = ref(false)
const stepActive = ref(0)

const importGroup = ref('')
const importWells = ref<number[]>([])
const importDateRange = ref<[string, string]>(['', ''])
const importFile = ref<File | null>(null)
const uploadRef = ref<UploadInstance>()
const fileError = ref('')
const qcResult = ref<QcResult | null>(null)
const activeTab = ref<'abnormal' | 'valid' | 'failed'>('abnormal')

/** 已解析 + 用户修正的草稿，按文件行号保存；重新质控只从这里取数，避免覆盖用户输入 */
const draftsMap = ref<Map<number, QcRowDraft>>(new Map())

const importAvailableWells = computed(() =>
  importGroup.value ? wells.value.filter((w) => w.groupId === importGroup.value) : wells.value
)

const lastQc = ref<(QcResult & { summary: CommitSummary }) | null>(null)

function openImportDialog() {
  readOnlyQc.value = false
  qcResult.value = null
  fileError.value = ''
  importFile.value = null
  importGroup.value = selectedGroup.value || groups.value[0]?.id || ''
  handleImportGroupChange()
  importWells.value = [...selectedWells.value]
  importDateRange.value = [startDate.value, endDate.value]
  stepActive.value = 0
  dialogVisible.value = true
}

function handleImportGroupChange() {
  if (!importGroup.value) return
  const g = groups.value.find((x) => x.id === importGroup.value)
  if (g) importWells.value = [...g.wellIds]
}

function handleExceed() {
  ElMessage.warning('一次只能导入一个文件，请先移除已选文件')
}

function handleFileChange(file: UploadFile) {
  const raw = file.raw
  if (!raw) return
  if (!raw.name.toLowerCase().endsWith('.csv')) {
    fileError.value = '仅支持 CSV 文件'
    importFile.value = null
    return
  }
  fileError.value = ''
  importFile.value = raw
}

function handleFileRemove() {
  importFile.value = null
  fileError.value = ''
}

async function readFileContent(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = reject
    reader.readAsText(file, 'utf-8')
  })
}

async function runBatchQc() {
  fileError.value = ''
  if (!importWells.value.length) {
    fileError.value = '请选择至少一口井'
    return
  }
  if (!importDateRange.value[0] || !importDateRange.value[1]) {
    fileError.value = '请选择日报时间区间'
    return
  }
  if (!importFile.value) {
    fileError.value = '请选择要导入的 CSV 文件（文件为空时无法质控）'
    return
  }
  qcLoading.value = true
  try {
    const content = await readFileContent(importFile.value)
    if (!content.trim()) {
      fileError.value = '文件为空，未提取到任何日报数据'
      return
    }
    const { result, failureReason } = await checkProductionBatch({
      fileName: importFile.value.name,
      content,
      wellIds: importWells.value,
      startDate: importDateRange.value[0],
      endDate: importDateRange.value[1]
    })
    if (!result) {
      fileError.value = failureReason || '质控失败，未提取到有效数据'
      return
    }
    draftsMap.value = new Map(result.rows.map((r) => [r.rowNo, toDraft(r)]))
    qcResult.value = result
    stepActive.value = 2
    activeTab.value = result.failureRows.length ? 'failed' : result.abnormalRows.length ? 'abnormal' : 'valid'
    ElMessage.warning(`质控完成：有效 ${result.validRows.length}，异常 ${result.abnormalRows.length}，失败 ${result.failureRows.length}`)
  } finally {
    qcLoading.value = false
  }
}

/** 单元格修正：先落入草稿表，再防抖重新质控 */
let recheckTimer: ReturnType<typeof setTimeout> | null = null
function handleCellUpdate(payload: { rowNo: number; field: keyof QcRowDraft; value: string }) {
  const draft = draftsMap.value.get(payload.rowNo)
  if (!draft) return
  ;(draft as unknown as Record<string, string>)[payload.field] = payload.value
  if (recheckTimer) clearTimeout(recheckTimer)
  recheckTimer = setTimeout(() => doRecheck(false), 400)
}

/** 取当前草稿（保持文件原始行序） */
function currentDrafts(): QcRowDraft[] {
  const result = qcResult.value
  if (!result) return []
  return result.rows.map((r) => draftsMap.value.get(r.rowNo) ?? toDraft(r))
}

async function doRecheck(toast: boolean) {
  if (!qcResult.value) return
  recheckLoading.value = true
  try {
    const rows = await recheckProductionBatch(currentDrafts(), {
      wellIds: qcResult.value.wellIds,
      startDate: qcResult.value.startDate,
      endDate: qcResult.value.endDate
    })
    applyRecheckedRows(rows)
    if (toast) {
      const part = partitionRows(rows)
      ElMessage.success(`重新质控完成：有效 ${part.validRows.length}，异常 ${part.abnormalRows.length}，失败 ${part.failureRows.length}`)
    }
  } finally {
    recheckLoading.value = false
  }
}

function recheckAll() {
  return doRecheck(true)
}

function applyRecheckedRows(rows: QcRow[]) {
  if (!qcResult.value) return
  const part = partitionRows(rows)
  qcResult.value = {
    ...qcResult.value,
    rows,
    validRows: part.validRows,
    abnormalRows: part.abnormalRows,
    failureRows: part.failureRows
  }
}

function toDraft(row: QcRow): QcRowDraft {
  return {
    rowNo: row.rowNo,
    rawText: row.rawText,
    parseError: row.parseError,
    wellId: row.wellId,
    reportDate: row.reportDate,
    productionHours: row.productionHours,
    oilProduction: row.oilProduction,
    waterProduction: row.waterProduction,
    gasProduction: row.gasProduction,
    waterCut: row.waterCut,
    cumulativeOil: row.cumulativeOil,
    tubingPressure: row.tubingPressure,
    casingPressure: row.casingPressure
  }
}

async function commitBatch() {
  if (!qcResult.value) return
  commitLoading.value = true
  try {
    const result = await commitProductionBatch({
      batchId: qcResult.value.batchId,
      wellIds: qcResult.value.wellIds,
      startDate: qcResult.value.startDate,
      endDate: qcResult.value.endDate,
      rows: currentDrafts()
    })

    const part = partitionRows(result.rows)
    const merged: QcResult & { summary: CommitSummary } = {
      ...qcResult.value,
      rows: result.rows,
      validRows: part.validRows,
      abnormalRows: part.abnormalRows,
      failureRows: part.failureRows,
      summary: result.summary
    }
    // 服务端为最终质控结果，以其回填草稿（含含水率自动推算等服务端补全）
    draftsMap.value = new Map(result.rows.map((r) => [r.rowNo, toDraft(r)]))
    qcResult.value = merged
    lastQc.value = merged
    persistQc(merged)

    // 列表、指标卡、趋势图刷新为同一批数据
    await loadData()

    stepActive.value = 2
    activeTab.value = part.failureRows.length ? 'failed' : part.abnormalRows.length ? 'abnormal' : 'valid'
    ElMessage.success(
      `提交完成：新增 ${result.summary.inserted} 条，更新 ${result.summary.updated} 条，` +
        `带预警回填 ${result.summary.warningCommitted} 条，跳过失败 ${result.summary.skipped} 条`
    )
  } finally {
    commitLoading.value = false
  }
}

function resetImport() {
  qcResult.value = null
  importFile.value = null
  fileError.value = ''
  draftsMap.value = new Map()
  uploadRef.value?.clearFiles()
  stepActive.value = 0
}

function handleDialogClosed() {
  qcResult.value = null
  importFile.value = null
  fileError.value = ''
  readOnlyQc.value = false
  draftsMap.value = new Map()
  uploadRef.value?.clearFiles()
  if (recheckTimer) {
    clearTimeout(recheckTimer)
    recheckTimer = null
  }
}

function persistQc(data: QcResult & { summary: CommitSummary }) {
  try {
    localStorage.setItem(QC_STORAGE_KEY, JSON.stringify(data))
  } catch {
    // ignore
  }
}

function restoreQc() {
  try {
    const raw = localStorage.getItem(QC_STORAGE_KEY)
    if (raw) lastQc.value = JSON.parse(raw) as QcResult & { summary: CommitSummary }
  } catch {
    // ignore
  }
}

function dismissQcBanner() {
  lastQc.value = null
  try {
    localStorage.removeItem(QC_STORAGE_KEY)
  } catch {
    // ignore
  }
}

function reopenQcResult() {
  if (!lastQc.value) return
  readOnlyQc.value = true
  qcResult.value = lastQc.value
  dialogVisible.value = true
}

/* ------------------------------ 模板 / 导出 ------------------------------ */

const TEMPLATE_HEADER = '井编号,日期,生产时数(h),日产油量(t),日产水量(t),日产气量(m³),含水率(%),累计产油(t),油压(MPa),套压(MPa)'

function downloadText(filename: string, text: string) {
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function downloadTemplate() {
  const sample = [
    TEMPLATE_HEADER,
    '1,2026-09-10,24,126.5,352.1,8600,73.6,102350.2,8.5,12.1',
    '2,2026-09-10,22,88.4,260.6,7200,74.7,125480.0,7.9,11.8',
    '3,2026-09-10,0,0,0,0,0,148210.5,0,9.5'
  ].join('\n')
  downloadText('生产日报导入模板.csv', sample)
}

function exportCsv() {
  const rows = viewData.value
  if (!rows.length) {
    ElMessage.warning('当前没有可导出的数据')
    return
  }
  const lines = [TEMPLATE_HEADER]
  rows.forEach((r) => {
    lines.push(
      [
        r.wellId,
        r.reportDate,
        r.productionHours ?? '',
        r.oilProduction ?? '',
        r.waterProduction ?? '',
        r.gasProduction ?? '',
        r.waterCut ?? '',
        r.cumulativeOil ?? '',
        r.tubingPressure ?? '',
        r.casingPressure ?? ''
      ].join(',')
    )
  })
  downloadText(`生产日报_${startDate.value}_${endDate.value}.csv`, lines.join('\n'))
}

/* ------------------------------ 生命周期 ------------------------------ */

onMounted(async () => {
  const [wellList, groupList] = await Promise.all([getWellList(), getWellGroups()])
  wells.value = wellList
  groups.value = groupList
  dateRange.value = defaultDateRange()
  selectedGroup.value = ''
  selectedWells.value = wellList.map((w) => w.id)
  restoreQc()
  await loadData()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  chartInstance?.dispose()
  chartInstance = null
})
</script>

<style scoped lang="scss">
.production-container {
  width: 100%;
}

.filter-form {
  margin-bottom: -18px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px;
  border-radius: 8px;
  color: #fff;

  &.primary { background: linear-gradient(135deg, #3b82f6, #1d4ed8); }
  &.success { background: linear-gradient(135deg, #22c55e, #16a34a); }
  &.warning { background: linear-gradient(135deg, #f59e0b, #d97706); }
  &.info { background: linear-gradient(135deg, #06b6d4, #0891b2); }
  &.danger { background: linear-gradient(135deg, #ef4444, #dc2626); }
  &.purple { background: linear-gradient(135deg, #8b5cf6, #7c3aed); }

  .stat-icon {
    font-size: 30px;
    opacity: 0.9;
  }

  .stat-value {
    font-size: 24px;
    font-weight: 600;
    line-height: 1.1;
    margin-bottom: 4px;
  }

  .stat-label {
    font-size: 13px;
    opacity: 0.9;
  }
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
}

.chart-large {
  width: 100%;
  height: 320px;
}

.cumulative-stats {
  padding: 6px 0;
}

.cumulative-item {
  padding: 16px 0;
  border-bottom: 1px solid #f1f5f9;

  &:last-child {
    border-bottom: none;
  }

  .cumulative-label {
    font-size: 14px;
    color: #64748b;
    margin-bottom: 6px;
  }

  .cumulative-value {
    font-size: 28px;
    font-weight: 600;
    color: #1e293b;
  }
}

.qc-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.qc-summary {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tab-badge {
  margin-left: 6px;
  margin-top: -2px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}

:deep(.row-abnormal) {
  background-color: #fdf6ec !important;
}

:deep(.row-failed) {
  background-color: #fef0f0 !important;
}

:deep(.issue-cell) {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

:deep(.issue-line) {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  line-height: 1.5;

  .issue-msg {
    color: #475569;
  }

  &.issue-error .issue-msg {
    color: #dc2626;
  }
}

:deep(.cell-error :deep(.el-input__wrapper)),
:deep(.cell-error .el-input__wrapper) {
  box-shadow: 0 0 0 1px #ef4444 inset;
}

:deep(.cell-warn .el-input__wrapper) {
  box-shadow: 0 0 0 1px #e6a23c inset;
}
</style>
