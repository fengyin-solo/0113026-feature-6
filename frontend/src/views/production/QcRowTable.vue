<template>
  <el-table :data="rows" border stripe size="small" height="380" row-key="rowNo">
    <el-table-column prop="rowNo" label="行号" width="64" />
    <el-table-column label="井编号" width="120">
      <template #default="{ row }">
        <el-input-number
          v-if="editable(row)"
          :model-value="parseWellId(row.wellId)"
          :controls="false"
          size="small"
          style="width: 100px"
          :class="cellClass(row, 'wellId')"
          @update:model-value="(v: number | undefined) => emitUpdate(row, 'wellId', v)"
        />
        <span v-else>{{ row.wellId || '—' }}</span>
      </template>
    </el-table-column>
    <el-table-column prop="wellName" label="井名" width="100" />
    <el-table-column label="日期" width="150">
      <template #default="{ row }">
        <el-date-picker
          v-if="editable(row)"
          :model-value="row.reportDate || undefined"
          type="date"
          size="small"
          value-format="YYYY-MM-DD"
          style="width: 132px"
          :class="cellClass(row, 'reportDate')"
          @update:model-value="(v: string | null) => emit('update', { rowNo: row.rowNo, field: 'reportDate', value: v ?? '' })"
        />
        <span v-else>{{ row.reportDate || '—' }}</span>
      </template>
    </el-table-column>
    <el-table-column
      v-for="col in numericColumns"
      :key="col.field"
      :label="col.label"
      :width="col.width"
    >
      <template #default="{ row }">
        <el-input-number
          v-if="editable(row)"
          :model-value="parseNum(row[col.field])"
          :controls="false"
          size="small"
          :precision="col.field === 'waterCut' ? 1 : undefined"
          style="width: 100%"
          :class="cellClass(row, col.field)"
          @update:model-value="(v: number | undefined) => emitUpdate(row, col.field, v)"
        />
        <span v-else>{{ row[col.field] === '' || row[col.field] === undefined ? '—' : row[col.field] }}</span>
      </template>
    </el-table-column>
    <el-table-column label="质控问题 / 失败原因" min-width="300">
      <template #default="{ row }">
        <div class="issue-cell">
          <p v-if="!row.issues.length" class="issue-empty">无</p>
          <div
            v-for="(iss, i) in row.issues"
            :key="i"
            class="issue-line"
            :class="iss.level === 'error' ? 'issue-error' : 'issue-warn'"
          >
            <el-tag :type="iss.level === 'error' ? 'danger' : 'warning'" size="small">
              {{ iss.level === 'error' ? '错误' : '预警' }}
            </el-tag>
            <span class="issue-msg">{{ iss.message }}</span>
          </div>
        </div>
      </template>
    </el-table-column>
  </el-table>
</template>

<script setup lang="ts">
import type { QcRow, QcRowDraft } from '@/utils/productionQc'

const props = defineProps<{ rows: QcRow[]; readonly: boolean }>()
const emit = defineEmits<{
  (e: 'update', payload: { rowNo: number; field: keyof QcRowDraft; value: string }): void
}>()

const numericColumns: Array<{ field: keyof QcRowDraft; label: string; width: string }> = [
  { field: 'productionHours', label: '生产时数(h)', width: '120px' },
  { field: 'oilProduction', label: '日产油量(t)', width: '120px' },
  { field: 'waterProduction', label: '日产水量(t)', width: '120px' },
  { field: 'waterCut', label: '含水率(%)', width: '112px' },
  { field: 'cumulativeOil', label: '累计产油(t)', width: '130px' }
]

/** 结构性解析错误的行无法逐格修正，只能改源文件后重新导入 */
function editable(row: QcRow): boolean {
  return !props.readonly && !row.parseError
}

function parseNum(v: string): number | undefined {
  if (v === '' || v === undefined || v === null) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function parseWellId(v: string): number | undefined {
  const n = Number(v)
  return v !== '' && Number.isInteger(n) ? n : undefined
}

function emitUpdate(row: QcRow, field: keyof QcRowDraft, v: number | undefined) {
  emit('update', { rowNo: row.rowNo, field, value: v === undefined || Number.isNaN(v) ? '' : String(v) })
}

function cellClass(row: QcRow, field: string): string {
  if (row.issues.some((i) => i.field === field && i.level === 'error')) return 'cell-error'
  if (row.issues.some((i) => i.field === field && i.level === 'warn')) return 'cell-warn'
  return ''
}
</script>

<style scoped>
.issue-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.issue-empty {
  margin: 0;
  color: #94a3b8;
  font-size: 12px;
}

.issue-line {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  line-height: 1.5;

  .issue-msg {
    color: #475569;
  }
}

.issue-error .issue-msg {
  color: #dc2626;
}

:deep(.cell-error .el-input__wrapper) {
  box-shadow: 0 0 0 1px #ef4444 inset;
}

:deep(.cell-warn .el-input__wrapper) {
  box-shadow: 0 0 0 1px #e6a23c inset;
}
</style>
