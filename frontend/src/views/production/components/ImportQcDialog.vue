<template>
  <el-dialog
    :model-value="modelValue"
    title="批量导入日报与数据质控"
    width="1180px"
    top="5vh"
    :close-on-click-modal="false"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
    @closed="handleClosed"
  >
    <!-- 步骤一：选择文件 -->
    <div class="import-toolbar">
      <el-upload
        ref="uploadRef"
        action=""
        accept=".csv"
        :auto-upload="false"
        :show-file-list="false"
        :on-change="handleFileChange"
      >
        <el-button type="primary">
          <el-icon class="mr-5"><Upload /></el-icon>选择 CSV 文件
        </el-button>
      </el-upload>
      <el-button text type="primary" @click="downloadTemplate(false)">
        <el-icon class="mr-5"><Download /></el-icon>下载导入模板
      </el-button>
      <el-button text type="primary" @click="downloadTemplate(true)">下载含异常的演示样本</el-button>
      <span v-if="fileName" class="file-name">
        <el-icon><Document /></el-icon>{{ fileName }}
      </span>
      <span class="range-hint">
        井组 {{ wellIds.length }} 口井 · {{ startDate || '不限' }} 至 {{ endDate || '不限' }}
      </span>
    </div>

    <!-- 文件为空 -->
    <el-alert
      v-if="parsed && !parsed.headerError && parsed.totalLines === 0 && parsed.failures.length === 0"
      class="mb-15"
      type="warning"
      :closable="false"
      title="文件为空：未解析到任何数据行，未写入任何数据。请按模板补充日报后重新导入。"
    />

    <!-- 表头不可识别 -->
    <el-alert
      v-if="parsed?.headerError"
      class="mb-15"
      type="error"
      :closable="false"
      :title="parsed.headerError"
      description="请使用模板中的列名：井号、日期、生产时数、日产油量、日产水量、产气量、含水率、累计产油。"
    />

    <template v-else-if="parsed">
      <!-- 质控汇总 -->
      <el-row :gutter="12" class="mb-15 summary-row">
        <el-col :span="4">
          <div class="summary-card">
            <div class="summary-num">{{ parsed.totalLines }}</div>
            <div class="summary-label">数据行</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="summary-card ok">
            <div class="summary-num">{{ validCount - abnormalCount }}</div>
            <div class="summary-label">校验通过</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="summary-card warn">
            <div class="summary-num">{{ warningCount }}</div>
            <div class="summary-label">疑似异常(警告)</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="summary-card err">
            <div class="summary-num">{{ errorCount }}</div>
            <div class="summary-label">异常(错误)</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="summary-card fail">
            <div class="summary-num">{{ parsed.failures.length }}</div>
            <div class="summary-label">无效行(丢弃)</div>
          </div>
        </el-col>
        <el-col :span="4">
          <div class="summary-card">
            <div class="summary-num">{{ validCount }}</div>
            <div class="summary-label">待回填行</div>
          </div>
        </el-col>
      </el-row>

      <!-- 失败原因 -->
      <el-card v-if="parsed.failures.length > 0" class="mb-15" shadow="never">
        <template #header>
          <div class="panel-title">
            <el-icon color="#ef4444"><CircleCloseFilled /></el-icon>
            失败明细（{{ parsed.failures.length }} 行未导入，仅列出原因，不影响其余有效数据）
          </div>
        </template>
        <el-table :data="parsed.failures" size="small" border max-height="180">
          <el-table-column prop="rowNumber" label="文件行号" width="90" />
          <el-table-column prop="wellCode" label="井号" width="110" />
          <el-table-column prop="reportDate" label="日期" width="120" />
          <el-table-column prop="reason" label="失败原因" min-width="260">
            <template #default="{ row }">
              <span class="fail-reason">{{ row.reason }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="rawText" label="原始内容" min-width="240" show-overflow-tooltip />
        </el-table>
      </el-card>

      <!-- 有效数据 + 异常逐条修正 -->
      <el-card v-if="rows.length > 0" shadow="never">
        <template #header>
          <div class="panel-title">
            <el-icon color="#3b82f6"><DocumentChecked /></el-icon>
            逐条质控与修正
            <el-radio-group v-model="rowFilter" size="small" class="ml-15">
              <el-radio-button label="all">全部 {{ validCount }}</el-radio-button>
              <el-radio-button label="error">错误 {{ errorCount }}</el-radio-button>
              <el-radio-button label="warning">警告 {{ warningCount }}</el-radio-button>
              <el-radio-button label="ok">正常 {{ validCount - abnormalCount }}</el-radio-button>
            </el-radio-group>
          </div>
        </template>
        <el-table :data="filteredRows" size="small" border max-height="320" :row-class-name="rowClass">
          <el-table-column prop="wellName" label="井名" width="90" fixed />
          <el-table-column prop="reportDate" label="日期" width="105" fixed />
          <el-table-column v-for="f in editableFields" :key="f.key" :width="f.width" align="center">
            <template #header>
              <span :class="{ 'col-error': activeFieldIssues(f.key).error > 0 }">{{ f.label }}</span>
            </template>
            <template #default="{ row }">
              <el-input-number
                :model-value="row[f.key]"
                :min="f.key === 'productionHours' ? 0 : undefined"
                :max="f.key === 'productionHours' ? 24 : undefined"
                :precision="f.precision"
                :controls="false"
                size="small"
                class="cell-input"
                :class="{ 'cell-invalid': rowHasFieldIssue(row, f.key) }"
                @focus="stashOld(row, f.key)"
                @change="(v: number) => onFieldChange(row, f.key, v)"
              />
            </template>
          </el-table-column>
          <el-table-column label="质控" width="150" fixed="right">
            <template #default="{ row }">
              <el-popover placement="left" :width="360" trigger="click">
                <template #reference>
                  <el-tag v-if="rowErrorCount(row) > 0" type="danger" size="small" class="issue-tag">
                    {{ rowErrorCount(row) }} 错误
                  </el-tag>
                  <el-tag v-else-if="rowWarningCount(row) > 0" type="warning" size="small" class="issue-tag">
                    {{ rowWarningCount(row) }} 警告
                  </el-tag>
                  <el-tag v-else type="success" size="small" class="issue-tag">正常</el-tag>
                </template>
                <div class="issue-pop">
                  <div v-if="activeIssues(row).length === 0" class="pop-ok">未发现质控异常</div>
                  <div v-for="issue in activeIssues(row)" :key="issue.id" class="issue-line">
                    <el-tag :type="issue.level === 'error' ? 'danger' : 'warning'" size="small">
                      {{ issue.level === 'error' ? '错误' : '警告' }}
                    </el-tag>
                    <span>{{ issue.message }}</span>
                  </div>
                  <el-divider v-if="resolvedIssues(row).length > 0" />
                  <div v-for="issue in resolvedIssues(row)" :key="`r-${issue.id}`" class="issue-line resolved">
                    <el-tag type="success" size="small">已修正</el-tag>
                    <span>{{ issue.message }}</span>
                    <span v-if="issue.history.length > 0" class="history-text">
                      （{{ issue.history.map((h) => `${fieldLabel(h.field)} ${h.from ?? '-'}→${h.to ?? '-'}`).join('；') }}）
                    </span>
                  </div>
                </div>
              </el-popover>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>

    <el-empty v-else description="请选择生产日报 CSV 文件，系统将逐行校验并保留质控结果" :image-size="80" />

    <template #footer>
      <span class="footer-tip" v-if="rows.length > 0">
        含错误的行不会被回填，可直接在表格中修改后一次提交；已修正的异常将保留修改痕迹。
      </span>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button
        type="primary"
        :disabled="rows.length === 0 || submitting"
        :loading="submitting"
        @click="handleSubmit"
      >
        提交修正并回填（{{ rows.length }} 行）
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { UploadFile } from 'element-plus'
import { ElMessage } from 'element-plus'
import {
  BatchQcResult,
  ProductionRow,
  QcField,
  activeIssues,
  abnormalRowCount,
  issueCount,
  runQc
} from '@/utils/productionQc'
import { downloadImportTemplate, previewProductionImport, submitProductionCorrections } from '@/api/production'

const props = defineProps<{
  modelValue: boolean
  wellIds: number[]
  startDate?: string
  endDate?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'submitted'): void
}>()

interface EditableField {
  key: QcField
  label: string
  width: number
  precision: number
}

const editableFields: EditableField[] = [
  { key: 'productionHours', label: '生产时数(h)', width: 115, precision: 1 },
  { key: 'oilProduction', label: '日产油量(t)', width: 115, precision: 2 },
  { key: 'waterProduction', label: '日产水量(t)', width: 115, precision: 2 },
  { key: 'waterCut', label: '含水率(%)', width: 110, precision: 2 },
  { key: 'cumulativeOil', label: '累计产油(t)', width: 125, precision: 2 }
]

const fieldLabels: Record<QcField, string> = {
  productionHours: '生产时数',
  oilProduction: '日产油量',
  waterProduction: '日产水量',
  waterCut: '含水率',
  cumulativeOil: '累计产油'
}
const fieldLabel = (f: QcField): string => fieldLabels[f]

const uploadRef = ref()
const fileName = ref('')
const parsed = ref<BatchQcResult | null>(null)
const rows = ref<ProductionRow[]>([])
const rowFilter = ref<'all' | 'error' | 'warning' | 'ok'>('all')
const submitting = ref(false)
const stashed = ref<{ key: string; field: QcField; value: number } | null>(null)

const validCount = computed(() => rows.value.length)
const errorCount = computed(() => issueCount(rows.value, 'error'))
const warningCount = computed(() => issueCount(rows.value, 'warning'))
const abnormalCount = computed(() => abnormalRowCount(rows.value))

const filteredRows = computed(() => {
  const list = rows.value
  if (rowFilter.value === 'error') return list.filter((r) => activeIssues(r).some((i) => i.level === 'error'))
  if (rowFilter.value === 'warning') {
    return list.filter((r) => !activeIssues(r).some((i) => i.level === 'error') && activeIssues(r).some((i) => i.level === 'warning'))
  }
  if (rowFilter.value === 'ok') return list.filter((r) => activeIssues(r).length === 0)
  return list
})

const activeFieldIssues = (field: QcField) => {
  let error = 0
  let warning = 0
  for (const row of rows.value) {
    for (const issue of activeIssues(row)) {
      if (issue.field === field) {
        if (issue.level === 'error') error++
        else warning++
      }
    }
  }
  return { error, warning }
}

const rowHasFieldIssue = (row: ProductionRow, field: QcField): boolean =>
  activeIssues(row).some((i) => i.field === field)
const rowErrorCount = (row: ProductionRow): number =>
  activeIssues(row).filter((i) => i.level === 'error').length
const rowWarningCount = (row: ProductionRow): number =>
  activeIssues(row).filter((i) => i.level === 'warning').length
const resolvedIssues = (row: ProductionRow) => row.issues.filter((i) => i.resolved)

const rowClass = ({ row }: { row: ProductionRow }): string => {
  if (rowErrorCount(row) > 0) return 'row-error'
  if (rowWarningCount(row) > 0) return 'row-warning'
  return ''
}

async function decodeFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const utf8 = new TextDecoder('utf-8').decode(buffer)
  // UTF-8 解码出现大量替换符时，回退 GBK（Excel 导出的中文 CSV 常见编码）
  const replaced = (utf8.match(/�/g) || []).length
  if (replaced > 0 && replaced / Math.max(utf8.length, 1) > 0.02) {
    return new TextDecoder('gbk').decode(buffer)
  }
  return utf8
}

async function handleFileChange(uploadFile: UploadFile): Promise<void> {
  const raw = uploadFile.raw
  if (!raw) return
  if (!/\.csv$/i.test(raw.name)) {
    ElMessage.warning('仅支持 CSV 文件')
    return
  }
  fileName.value = raw.name
  const content = await decodeFile(raw)
  const res = await previewProductionImport({
    fileName: raw.name,
    content,
    wellIds: props.wellIds,
    startDate: props.startDate,
    endDate: props.endDate
  })
  parsed.value = res.data
  rows.value = res.data.validRows
  rowFilter.value = 'all'
  if (res.data.headerError) {
    ElMessage.error('文件表头无法识别，请使用标准模板')
  } else if (res.data.totalLines === 0 && res.data.failures.length === 0) {
    ElMessage.warning('文件为空，未导入任何数据')
  } else {
    ElMessage.success(`解析完成：有效 ${res.data.validRows.length} 行，失败 ${res.data.failures.length} 行`)
  }
}

function stashOld(row: ProductionRow, field: QcField): void {
  stashed.value = { key: row.key, field, value: row[field] }
}

function onFieldChange(row: ProductionRow, field: QcField, value: number | undefined): void {
  const next = value ?? 0
  // 先把修改痕迹记入该字段当前未解决的异常，再整批复校（复校会按异常 ID 保留痕迹）
  if (stashed.value && stashed.value.key === row.key && stashed.value.field === field && stashed.value.value !== next) {
    for (const issue of row.issues) {
      if (!issue.resolved && issue.field === field) {
        issue.history.push({ field, from: stashed.value.value, to: next, at: new Date().toISOString() })
      }
    }
  }
  row[field] = next
  runQc(rows.value)
}

async function handleSubmit(): Promise<void> {
  if (rows.value.length === 0) return
  submitting.value = true
  try {
    const payload = rows.value.map((row) => ({
      key: row.key,
      wellId: row.wellId,
      reportDate: row.reportDate,
      productionHours: row.productionHours,
      oilProduction: row.oilProduction,
      waterProduction: row.waterProduction,
      gasProduction: row.gasProduction,
      waterCut: row.waterCut,
      cumulativeOil: row.cumulativeOil,
      issues: row.issues
    }))
    const res = await submitProductionCorrections(payload)
    const { accepted, rejected } = res.data

    if (rejected.length > 0) {
      // 被服务端拒绝的行（仍有错误）保留在表格中继续修改；返回的复校结果不丢失
      const rejectedByKey = new Map(rejected.map((r) => [r.key, r]))
      rows.value = rows.value
        .filter((row) => rejectedByKey.has(row.key))
        .map((row) => rejectedByKey.get(row.key)!)
      ElMessage.warning(`已回填 ${accepted.length} 行，${rejected.length} 行仍有错误未回填`)
    } else {
      ElMessage.success(`已成功回填 ${accepted.length} 行生产日报`)
      emit('submitted')
      emit('update:modelValue', false)
    }
  } finally {
    submitting.value = false
  }
}

async function downloadTemplate(withSamples: boolean): Promise<void> {
  const { fileName: name, content } = await downloadImportTemplate(withSamples)
  // 加 UTF-8 BOM，保证 Excel 直接打开中文不乱码
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function handleClosed(): void {
  parsed.value = null
  rows.value = []
  fileName.value = ''
  rowFilter.value = 'all'
  uploadRef.value?.clearFiles()
}
</script>

<style scoped lang="scss">
.import-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 16px;

  .file-name {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: #1e293b;
    font-weight: 500;
  }

  .range-hint {
    margin-left: auto;
    font-size: 12px;
    color: #94a3b8;
  }
}

.summary-card {
  padding: 14px;
  border-radius: 8px;
  background: #f1f5f9;
  text-align: center;

  .summary-num {
    font-size: 26px;
    font-weight: 700;
    color: #1e293b;
    line-height: 1.1;
  }

  .summary-label {
    margin-top: 4px;
    font-size: 12px;
    color: #64748b;
  }

  &.ok {
    background: #dcfce7;
    .summary-num { color: #16a34a; }
  }
  &.warn {
    background: #fef3c7;
    .summary-num { color: #d97706; }
  }
  &.err {
    background: #fee2e2;
    .summary-num { color: #dc2626; }
  }
  &.fail {
    background: #f1f5f9;
    .summary-num { color: #475569; }
  }
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.fail-reason {
  color: #dc2626;
}

.cell-input {
  width: 100%;

  :deep(.el-input__wrapper) {
    padding: 0 6px;
  }
}

.cell-invalid :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px #ef4444 inset;
}

.col-error {
  color: #dc2626;
  font-weight: 600;
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

    &.resolved {
      color: #16a34a;
    }
  }

  .pop-ok {
    color: #16a34a;
    font-size: 13px;
  }

  .history-text {
    color: #94a3b8;
    font-size: 12px;
  }
}

.footer-tip {
  float: left;
  font-size: 12px;
  color: #94a3b8;
  line-height: 32px;
}

:deep(.row-error) {
  background-color: #fef2f2 !important;
}

:deep(.row-warning) {
  background-color: #fffbeb !important;
}
</style>
