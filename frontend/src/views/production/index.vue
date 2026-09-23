<template>
  <div class="production-container">
    <!-- 井组 + 时间区间 -->
    <el-row :gutter="20" class="mb-20">
      <el-col :span="9">
        <el-select
          v-model="selectedWellIds"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="选择井组（可多选）"
          style="width: 100%"
        >
          <el-option v-for="well in wellList" :key="well.id" :label="well.wellName" :value="well.id" />
        </el-select>
      </el-col>
      <el-col :span="8">
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          style="width: 100%"
        />
      </el-col>
      <el-col :span="7" class="text-right">
        <el-button type="primary" :loading="loading" @click="loadData">
          <el-icon class="mr-5"><Search /></el-icon>查询
        </el-button>
        <el-button type="success" @click="importVisible = true">
          <el-icon class="mr-5"><Upload /></el-icon>批量导入质控
        </el-button>
        <el-button @click="exportCsv">
          <el-icon class="mr-5"><Download /></el-icon>导出报表
        </el-button>
      </el-col>
    </el-row>

    <!-- 指标卡：与列表、趋势图同源（filteredRows） -->
    <el-row :gutter="16" class="mb-20">
      <el-col :span="3" v-for="card in metricCards" :key="card.label">
        <div class="stat-card" :class="card.theme">
          <div class="stat-info">
            <div class="stat-value">{{ card.value }}</div>
            <div class="stat-label">{{ card.label }}</div>
          </div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="mb-20">
      <el-col :span="16">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>井组产量趋势（{{ filteredRows.length }} 条日报）</span>
              <el-radio-group v-model="chartType" size="small">
                <el-radio-button label="oil">日产油</el-radio-button>
                <el-radio-button label="water">日产水</el-radio-button>
                <el-radio-button label="waterCut">综合含水率</el-radio-button>
                <el-radio-button label="cumulativeOil">累计产油</el-radio-button>
              </el-radio-group>
            </div>
          </template>
          <div ref="trendChart" class="chart-large"></div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card>
          <template #header>
            <span>区间累计产量（按井）</span>
          </template>
          <el-table :data="wellCumulative" size="small" border>
            <el-table-column prop="wellName" label="井名" width="90" />
            <el-table-column label="累计产油(t)">
              <template #default="{ row }">
                {{ formatNum(row.cumulativeOil) }}
              </template>
            </el-table-column>
            <el-table-column label="累计产水(t)">
              <template #default="{ row }">
                {{ formatNum(row.cumulativeWater) }}
              </template>
            </el-table-column>
          </el-table>
          <div class="range-total">
            <div>区间产油合计：<b>{{ formatNum(rangeTotals.oil) }}</b> t</div>
            <div>区间产水合计：<b>{{ formatNum(rangeTotals.water) }}</b> t</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card>
      <template #header>
        <div class="card-header">
          <span>生产数据列表（井组批量）</span>
          <el-radio-group v-model="listFilter" size="small">
            <el-radio-button label="all">全部</el-radio-button>
            <el-radio-button label="error">仅错误</el-radio-button>
            <el-radio-button label="warning">仅警告</el-radio-button>
          </el-radio-group>
        </div>
      </template>
      <el-table :data="displayRows" border stripe style="width: 100%" :row-class-name="rowClass">
        <el-table-column prop="reportDate" label="日期" width="110" sortable :sort-method="sortByDate" />
        <el-table-column prop="wellName" label="井名" width="100" />
        <el-table-column label="生产时数(h)" width="120">
          <template #default="{ row }">
            <span :class="fieldCellClass(row, 'productionHours')">{{ row.productionHours }}</span>
          </template>
        </el-table-column>
        <el-table-column label="日产油量(t)" width="120">
          <template #default="{ row }">
            <span :class="fieldCellClass(row, 'oilProduction')">{{ row.oilProduction }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="waterProduction" label="日产水量(t)" width="120" />
        <el-table-column prop="gasProduction" label="产气量(m³)" width="120" />
        <el-table-column label="含水率(%)" width="150">
          <template #default="{ row }">
            <el-progress
              :percentage="Math.min(100, Math.max(0, row.waterCut))"
              :stroke-width="12"
              :show-text="false"
              :status="cutStatus(row)"
            />
            <span :class="fieldCellClass(row, 'waterCut')" class="cut-text">{{ row.waterCut }}%</span>
          </template>
        </el-table-column>
        <el-table-column label="累计产油(t)" width="130">
          <template #default="{ row }">
            <span :class="fieldCellClass(row, 'cumulativeOil')">{{ formatNum(row.cumulativeOil) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="质控" width="160">
          <template #default="{ row }">
            <el-popover placement="left" :width="360" trigger="click">
              <template #reference>
                <el-tag v-if="errorIssues(row).length > 0" type="danger" size="small" class="issue-tag">
                  {{ errorIssues(row).length }} 项错误
                </el-tag>
                <el-tag v-else-if="warningIssues(row).length > 0" type="warning" size="small" class="issue-tag">
                  {{ warningIssues(row).length }} 项警告
                </el-tag>
                <el-tag v-else type="success" size="small">正常</el-tag>
              </template>
              <div class="issue-pop">
                <div v-for="issue in row.issues" :key="issue.id" class="issue-line">
                  <el-tag :type="issue.resolved ? 'success' : issue.level === 'error' ? 'danger' : 'warning'" size="small">
                    {{ issue.resolved ? '已修正' : issue.level === 'error' ? '错误' : '警告' }}
                  </el-tag>
                  <span :class="{ resolved: issue.resolved }">{{ issue.message }}</span>
                  <span v-if="issue.history.length > 0" class="history-text">
                    （{{ issue.history.map((h: QcCorrection) => `${fieldLabelMap[h.field]} ${h.from ?? '-'}→${h.to ?? '-'}`).join('；') }}）
                  </span>
                </div>
              </div>
            </el-popover>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="80">
          <template #default="{ row }">
            <el-tag :type="row.source === 'import' ? 'success' : 'info'" size="small" effect="plain">
              {{ row.source === 'import' ? '导入' : '系统' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button type="danger" size="small" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <ImportQcDialog
      v-model="importVisible"
      :well-ids="selectedWellIds"
      :start-date="startDate"
      :end-date="endDate"
      @submitted="loadData"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ProductionRow,
  QcCorrection,
  QcField,
  QcIssue,
  activeIssues,
  abnormalRowCount,
  issueCount
} from '@/utils/productionQc'
import { getProductionList, getWellGroupOptions, removeProductionRow } from '@/api/production'
import ImportQcDialog from './components/ImportQcDialog.vue'

const selectedWellIds = ref<number[]>([])
const dateRange = ref<[string, string] | null>(['2024-01-10', '2024-01-21'])
const chartType = ref<'oil' | 'water' | 'waterCut' | 'cumulativeOil'>('oil')
const listFilter = ref<'all' | 'error' | 'warning'>('all')
const loading = ref(false)
const importVisible = ref(false)

const wellList = ref<{ id: number; wellName: string }[]>([])
const allRows = ref<ProductionRow[]>([])
const trendChart = ref<HTMLElement>()
let chart: echarts.ECharts | null = null
let resizeHandler: (() => void) | null = null

const startDate = computed(() => dateRange.value?.[0])
const endDate = computed(() => dateRange.value?.[1])

/** 列表、指标卡、趋势图唯一数据源 */
const filteredRows = computed(() =>
  allRows.value
    .filter((row) => selectedWellIds.value.includes(row.wellId))
    .filter((row) => !startDate.value || row.reportDate >= startDate.value)
    .filter((row) => !endDate.value || row.reportDate <= endDate.value)
)

const displayRows = computed(() => {
  if (listFilter.value === 'error') {
    return filteredRows.value.filter((row) => activeIssues(row).some((i) => i.level === 'error'))
  }
  if (listFilter.value === 'warning') {
    return filteredRows.value.filter(
      (row) => !activeIssues(row).some((i) => i.level === 'error') && activeIssues(row).some((i) => i.level === 'warning')
    )
  }
  return filteredRows.value
})

const fieldLabelMap: Record<QcField, string> = {
  productionHours: '生产时数',
  oilProduction: '日产油量',
  waterProduction: '日产水量',
  waterCut: '含水率',
  cumulativeOil: '累计产油'
}

const formatNum = (n: number): string =>
  n >= 10000 ? `${(n / 10000).toFixed(2)}万` : (Math.round(n * 10) / 10).toLocaleString()

const active = (row: ProductionRow): QcIssue[] => activeIssues(row)
const errorIssues = (row: ProductionRow): QcIssue[] => active(row).filter((i) => i.level === 'error')
const warningIssues = (row: ProductionRow): QcIssue[] => active(row).filter((i) => i.level === 'warning')

const fieldCellClass = (row: ProductionRow, field: QcField): string => {
  const issue = active(row).find((i) => i.field === field)
  if (!issue) return ''
  return issue.level === 'error' ? 'cell-error' : 'cell-warning'
}

const cutStatus = (row: ProductionRow): 'exception' | '' =>
  fieldCellClass(row, 'waterCut') ? 'exception' : ''

const rowClass = ({ row }: { row: ProductionRow }): string => {
  if (errorIssues(row).length > 0) return 'row-error'
  if (warningIssues(row).length > 0) return 'row-warning'
  return ''
}

const sortByDate = (a: ProductionRow, b: ProductionRow): number => a.reportDate.localeCompare(b.reportDate)

/* ----------------------------- 指标卡 ----------------------------- */

const rangeTotals = computed(() => {
  let oil = 0
  let water = 0
  let liquid = 0
  let hours = 0
  for (const row of filteredRows.value) {
    oil += row.oilProduction
    water += row.waterProduction
    liquid += row.oilProduction + row.waterProduction
    hours += row.productionHours
  }
  return { oil, water, liquid, hours }
})

const metricCards = computed(() => {
  const rows = filteredRows.value
  const count = rows.length
  const avgHours = count ? rangeTotals.value.hours / count : 0
  const wellDays = new Set(rows.map((r) => r.key)).size
  const avgOil = wellDays ? rangeTotals.value.oil / wellDays : 0
  const cut = rangeTotals.value.liquid ? (rangeTotals.value.water / rangeTotals.value.liquid) * 100 : 0
  const latestCum = latestCumulativeOil.value
  return [
    { label: `日报行数（${new Set(rows.map((r) => r.wellId)).size} 口井）`, value: count, theme: 'primary' },
    { label: '异常行数', value: abnormalRowCount(rows), theme: abnormalRowCount(rows) > 0 ? 'danger' : 'success' },
    { label: '未解决错误', value: issueCount(rows, 'error'), theme: issueCount(rows, 'error') > 0 ? 'danger' : 'success' },
    { label: '平均生产时数(h)', value: avgHours.toFixed(1), theme: 'info' },
    { label: '区间产油(t)', value: formatNum(rangeTotals.value.oil), theme: 'primary' },
    { label: '井均日产油(t/d)', value: avgOil.toFixed(1), theme: 'success' },
    { label: '综合含水率', value: `${cut.toFixed(1)}%`, theme: 'warning' },
    { label: '期末累计产油(t)', value: formatNum(latestCum), theme: 'purple' }
  ]
})

const latestCumulativeOil = computed(() => {
  const byWell = new Map<number, ProductionRow>()
  for (const row of filteredRows.value) {
    const cur = byWell.get(row.wellId)
    if (!cur || row.reportDate > cur.reportDate) byWell.set(row.wellId, row)
  }
  return [...byWell.values()].reduce((sum, row) => sum + row.cumulativeOil, 0)
})

/* ----------------------------- 区间累计（右卡） ----------------------------- */

const wellCumulative = computed(() => {
  const byWell = new Map<number, { wellName: string; cumulativeOil: number; cumulativeWater: number }>()
  const sorted = [...filteredRows.value].sort((a, b) => a.reportDate.localeCompare(b.reportDate))
  for (const row of sorted) {
    let item = byWell.get(row.wellId)
    if (!item) {
      item = { wellName: row.wellName, cumulativeOil: 0, cumulativeWater: 0 }
      byWell.set(row.wellId, item)
    }
    item.cumulativeOil += row.oilProduction
    item.cumulativeWater += row.waterProduction
  }
  return [...byWell.values()]
})

/* ----------------------------- 趋势图（同源聚合） ----------------------------- */

const chartSeries = computed(() => {
  const byDate = new Map<string, { oil: number; water: number; liquid: number; cum: Map<number, number> }>()
  const sorted = [...filteredRows.value].sort((a, b) =>
    a.reportDate === b.reportDate ? a.wellId - b.wellId : a.reportDate.localeCompare(b.reportDate)
  )
  for (const row of sorted) {
    let point = byDate.get(row.reportDate)
    if (!point) {
      point = { oil: 0, water: 0, liquid: 0, cum: new Map() }
      byDate.set(row.reportDate, point)
    }
    point.oil += row.oilProduction
    point.water += row.waterProduction
    point.liquid += row.oilProduction + row.waterProduction
    // 取每口井当日累计值（同日覆盖为最新）
    point.cum.set(row.wellId, row.cumulativeOil)
  }
  const dates = [...byDate.keys()]
  const oil: number[] = []
  const water: number[] = []
  const cut: number[] = []
  const cum: number[] = []
  for (const date of dates) {
    const point = byDate.get(date)!
    oil.push(Math.round(point.oil * 10) / 10)
    water.push(Math.round(point.water * 10) / 10)
    cut.push(point.liquid ? Math.round((point.water / point.liquid) * 1000) / 10 : 0)
    cum.push([...point.cum.values()].reduce((s, v) => s + v, 0))
  }
  return { dates, oil, water, cut, cum }
})

const renderChart = (): void => {
  if (!chart) return
  const { dates, oil, water, cut, cum } = chartSeries.value
  const configs = {
    oil: { name: '日产油量(t)', data: oil, color: '#3b82f6', area: true },
    water: { name: '日产水量(t)', data: water, color: '#06b6d4', area: true },
    waterCut: { name: '综合含水率(%)', data: cut, color: '#f59e0b', area: false },
    cumulativeOil: { name: '累计产油(t)', data: cum, color: '#8b5cf6', area: false }
  } as const
  const conf = configs[chartType.value]
  chart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: dates },
    yAxis: { type: 'value', name: conf.name },
    series: [
      {
        name: conf.name,
        type: 'line',
        smooth: true,
        areaStyle: conf.area ? { color: 'rgba(59, 130, 246, 0.1)' } : undefined,
        data: conf.data,
        itemStyle: { color: conf.color }
      }
    ]
  })
}

/* ----------------------------- 数据加载 ----------------------------- */

async function loadData(): Promise<void> {
  if (selectedWellIds.value.length === 0) {
    ElMessage.warning('请至少选择一口井')
    return
  }
  loading.value = true
  try {
    const res = await getProductionList({
      wellIds: selectedWellIds.value,
      startDate: startDate.value,
      endDate: endDate.value
    })
    allRows.value = res.data
    await nextTick()
    renderChart()
  } finally {
    loading.value = false
  }
}

async function handleDelete(row: ProductionRow): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除 ${row.wellName} ${row.reportDate} 的生产日报？`, '删除确认', {
      type: 'warning'
    })
  } catch {
    return
  }
  await removeProductionRow(row.key)
  ElMessage.success('删除成功')
  await loadData()
}

function exportCsv(): void {
  const header = ['日期', '井名', '生产时数(h)', '日产油量(t)', '日产水量(t)', '产气量(m³)', '含水率(%)', '累计产油(t)', '质控']
  const lines = displayRows.value.map((row) => {
    const issues = active(row)
      .map((i) => `${i.level === 'error' ? '错误' : '警告'}:${i.message}`)
      .join(' | ')
    return [
      row.reportDate,
      row.wellName,
      row.productionHours,
      row.oilProduction,
      row.waterProduction,
      row.gasProduction ?? '',
      row.waterCut,
      row.cumulativeOil,
      issues
    ]
  })
  const csv = [header, ...lines]
    .map((line) =>
      line
        .map((v) => {
          const s = String(v)
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(',')
    )
    .join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `生产日报_${startDate.value ?? ''}_${endDate.value ?? ''}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(async () => {
  const wellRes = await getWellGroupOptions()
  wellList.value = wellRes.data
  selectedWellIds.value = wellRes.data.map((w) => w.id)

  chart = echarts.init(trendChart.value!)
  resizeHandler = () => chart?.resize()
  window.addEventListener('resize', resizeHandler)
  watch([chartType, chartSeries], renderChart, { deep: false })
  await loadData()
})

onBeforeUnmount(() => {
  if (resizeHandler) window.removeEventListener('resize', resizeHandler)
  chart?.dispose()
  chart = null
})
</script>

<style scoped lang="scss">
.production-container {
  width: 100%;
}

.stat-card {
  display: flex;
  align-items: center;
  padding: 16px;
  border-radius: 8px;
  color: #fff;
  min-height: 78px;

  &.primary { background: linear-gradient(135deg, #3b82f6, #1d4ed8); }
  &.success { background: linear-gradient(135deg, #22c55e, #16a34a); }
  &.warning { background: linear-gradient(135deg, #f59e0b, #d97706); }
  &.info { background: linear-gradient(135deg, #06b6d4, #0891b2); }
  &.danger { background: linear-gradient(135deg, #ef4444, #dc2626); }
  &.purple { background: linear-gradient(135deg, #8b5cf6, #7c3aed); }

  .stat-value {
    font-size: 22px;
    font-weight: 600;
    line-height: 1.1;
    margin-bottom: 6px;
  }

  .stat-label {
    font-size: 12px;
    opacity: 0.92;
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

.range-total {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f1f5f9;
  font-size: 13px;
  color: #475569;
  line-height: 2;

  b {
    color: #1d4ed8;
    font-size: 15px;
  }
}

.cell-error {
  color: #dc2626;
  font-weight: 600;
}

.cell-warning {
  color: #d97706;
  font-weight: 600;
}

.cut-text {
  font-size: 12px;
  margin-left: 6px;
}

.issue-tag {
  cursor: pointer;
}

.issue-pop {
  .issue-line {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 13px;
    line-height: 1.6;
    color: #334155;
    margin-bottom: 6px;

    .resolved {
      color: #16a34a;
    }
  }

  .history-text {
    color: #94a3b8;
    font-size: 12px;
  }
}

:deep(.row-error) {
  background-color: #fef2f2 !important;
}

:deep(.row-warning) {
  background-color: #fffbeb !important;
}

.text-right {
  text-align: right;
}
</style>
