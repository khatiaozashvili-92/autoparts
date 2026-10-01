import * as XLSX from 'xlsx'
import { summarize } from './db'
import { monthLabel } from './format'
import type { FullReport } from './types'

export function exportExcel(rows: { branchName: string; full: FullReport }[], filename: string) {
  const summary = rows.map(({ branchName, full }) => {
    const s = summarize(full)
    const r = full.report
    return {
      თარიღი: r.report_date,
      ფილიალი: branchName,
      მენეჯერი: r.manager_name,
      სტატუსი: r.status === 'submitted' ? 'გაგზავნილი' : 'მონახაზი',
      'წინა დღის მაქვს': s.previousCash,
      'დღის ნავაჭრი': r.turnover,
      TBC: r.tbc,
      BOG: r.bog,
      KEEPZ: r.keepz,
      'ხარჯი საბუთით': s.receiptsTotal,
      'უსაბუთო ხარჯი': r.unreceipted_expense,
      ხელფასები: s.salariesTotal,
      'მიღებული ქეში': s.cashInTotal,
      'გაცემული ქეში': s.cashOutTotal,
      GLOVO: r.glovo,
      WOLT: r.wolt,
      კონსიგნაცია: r.consignments,
      'უნდა მქონდეს': s.expected,
      'რეალურად მაქვს': r.actual_cash,
      შედეგი: s.diff,
    }
  })
  const receipts = rows.flatMap(({ branchName, full }) =>
    full.receipts.map((x) => ({ თარიღი: full.report.report_date, ფილიალი: branchName, კომპანია: x.company, საიდენტიფიკაციო: x.tax_id, 'ჩეკის თარიღი': x.receipt_date, თანხა: x.amount })),
  )
  const salaries = rows.flatMap(({ branchName, full }) =>
    full.salaries.map((x) => ({ თარიღი: full.report.report_date, ფილიალი: branchName, სახელი: x.first_name, გვარი: x.last_name, თვე: monthLabel(x.salary_month), თანხა: x.amount })),
  )
  const cash = rows.flatMap(({ branchName, full }) => [
    ...full.cashIn.map((x) => ({ თარიღი: full.report.report_date, ფილიალი: branchName, ტიპი: 'მიღებული', თანხა: x.amount, 'კომენტარი / ვისზე': x.comment })),
    ...full.cashOut.map((x) => ({ თარიღი: full.report.report_date, ფილიალი: branchName, ტიპი: 'გაცემული', თანხა: x.amount, 'კომენტარი / ვისზე': x.recipient })),
  ])

  const wb = XLSX.utils.book_new()
  const add = (name: string, data: object[]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.length ? data : [{}]), name)
  add('დღიური შედეგი', summary)
  add('ჩეკები', receipts)
  add('ხელფასები', salaries)
  add('ქეშის მოძრაობა', cash)
  XLSX.writeFile(wb, filename)
}
