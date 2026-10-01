import { supabase } from './supabase'
import { difference, expectedCash, type CalcInput } from './calc'
import type { Branch, CashIn, CashOut, FullReport, Receipt, Report, Salary } from './types'

const must = <T,>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message)
  return r.data as T
}

export async function listBranches(): Promise<Branch[]> {
  return must(await supabase.from('branches').select('*').order('sort_order'))
}

export async function setOpeningBalance(branchId: string, amount: number) {
  must(await supabase.from('branches').update({ opening_balance: amount }).eq('id', branchId).select())
}

/** წინა დღის "მაქვს": ბოლო წინა ანგარიშის actual_cash, ან ფილიალის საწყისი ნაშთი */
export async function previousCash(branchId: string, date: string): Promise<number | null> {
  const prev = must(
    await supabase
      .from('reports')
      .select('actual_cash')
      .eq('branch_id', branchId)
      .lt('report_date', date)
      .not('actual_cash', 'is', null)
      .order('report_date', { ascending: false })
      .limit(1),
  ) as { actual_cash: number }[]
  if (prev.length) return Number(prev[0].actual_cash)
  const b = must(await supabase.from('branches').select('opening_balance').eq('id', branchId).single()) as { opening_balance: number | null }
  return b.opening_balance === null ? null : Number(b.opening_balance)
}

const num = <T extends object>(row: T, keys: string[]): T => {
  const o = { ...row } as Record<string, unknown>
  for (const k of keys) if (o[k] !== null && o[k] !== undefined) o[k] = Number(o[k])
  return o as T
}
const REPORT_NUMS = ['turnover', 'tbc', 'bog', 'keepz', 'unreceipted_expense', 'glovo', 'wolt', 'consignments', 'actual_cash']

export async function loadFull(reportId: string): Promise<FullReport> {
  const report = num(must(await supabase.from('reports').select('*').eq('id', reportId).single()) as Report, REPORT_NUMS)
  const [receipts, salaries, cashIn, cashOut, prev] = await Promise.all([
    supabase.from('receipts').select('*').eq('report_id', reportId).order('created_at'),
    supabase.from('salaries').select('*').eq('report_id', reportId).order('created_at'),
    supabase.from('cash_in').select('*').eq('report_id', reportId).order('created_at'),
    supabase.from('cash_out').select('*').eq('report_id', reportId).order('created_at'),
    previousCash(report.branch_id, report.report_date),
  ])
  return {
    report,
    receipts: (must(receipts) as Receipt[]).map((r) => num(r, ['amount'])),
    salaries: (must(salaries) as Salary[]).map((r) => num(r, ['amount'])),
    cashIn: (must(cashIn) as CashIn[]).map((r) => num(r, ['amount'])),
    cashOut: (must(cashOut) as CashOut[]).map((r) => num(r, ['amount'])),
    previousCash: prev,
  }
}

/** ანგარიშის გახსნა/შექმნა ფილიალისა და თარიღის მიხედვით */
export async function openReport(branchId: string, date: string, manager: string): Promise<Report> {
  const existing = must(await supabase.from('reports').select('*').eq('branch_id', branchId).eq('report_date', date).limit(1)) as Report[]
  if (existing.length) return num(existing[0], REPORT_NUMS)
  const created = must(
    await supabase.from('reports').insert({ branch_id: branchId, report_date: date, manager_name: manager }).select().single(),
  ) as Report
  return num(created, REPORT_NUMS)
}

export async function patchReport(id: string, patch: Partial<Report>) {
  must(await supabase.from('reports').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select())
}

export async function submitReport(id: string, actor: string) {
  must(await supabase.from('reports').update({ status: 'submitted', submitted_at: new Date().toISOString() }).eq('id', id).select())
  must(await supabase.from('report_log').insert({ report_id: id, action: 'submitted', actor }).select())
}

export async function reopenReport(id: string, actor: string) {
  must(await supabase.from('reports').update({ status: 'draft', submitted_at: null }).eq('id', id).select())
  must(await supabase.from('report_log').insert({ report_id: id, action: 'reopened', actor }).select())
}

type ChildTable = 'receipts' | 'salaries' | 'cash_in' | 'cash_out'
export async function addRow(table: ChildTable, row: Record<string, unknown>) {
  must(await supabase.from(table).insert(row).select())
}
export async function deleteRow(table: ChildTable, id: string) {
  must(await supabase.from(table).delete().eq('id', id).select())
}

export const toCalc = (f: FullReport): CalcInput => ({
  previousCash: f.previousCash ?? 0,
  turnover: f.report.turnover,
  tbc: f.report.tbc,
  bog: f.report.bog,
  keepz: f.report.keepz,
  receiptsTotal: f.receipts.reduce((s, r) => s + r.amount, 0),
  unreceiptedExpense: f.report.unreceipted_expense,
  salariesTotal: f.salaries.reduce((s, r) => s + r.amount, 0),
  cashOutTotal: f.cashOut.reduce((s, r) => s + r.amount, 0),
  cashInTotal: f.cashIn.reduce((s, r) => s + r.amount, 0),
  actualCash: f.report.actual_cash,
})

export const summarize = (f: FullReport) => {
  const c = toCalc(f)
  return { ...c, expected: expectedCash(c), diff: difference(c) }
}

// ---------- ფოტოები ----------
export async function uploadPhoto(reportId: string, kind: 'z' | 'receipt', blob: Blob): Promise<string> {
  const path = `${reportId}/${kind}-${Date.now()}.jpg`
  const { error } = await supabase.storage.from('receipts').upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw new Error(error.message)
  return path
}
export async function photoUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 3600)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

// ---------- ადმინი ----------
export interface AdminRow { report: Report; branchName: string; full: FullReport }
export async function adminList(filter: { branchId?: string; from?: string; to?: string; status?: string }): Promise<Report[]> {
  let q = supabase.from('reports').select('*').order('report_date', { ascending: false })
  if (filter.branchId) q = q.eq('branch_id', filter.branchId)
  if (filter.from) q = q.gte('report_date', filter.from)
  if (filter.to) q = q.lte('report_date', filter.to)
  if (filter.status) q = q.eq('status', filter.status)
  return (must(await q) as Report[]).map((r) => num(r, REPORT_NUMS))
}
export async function loadMany(ids: string[]): Promise<FullReport[]> {
  return Promise.all(ids.map(loadFull))
}

/** იგივე ჩეკი (ს/კ + თარიღი + თანხა) უკვე ატვირთულია? */
export async function isDuplicateReceipt(taxId: string, amount: number, date: string): Promise<boolean> {
  const rows = must(await supabase.from('receipts').select('id').eq('tax_id', taxId).eq('amount', amount).eq('receipt_date', date).limit(1)) as { id: string }[]
  return rows.length > 0
}
