export interface Branch { id: string; name: string; opening_balance: number | null; sort_order: number }

export interface Report {
  id: string
  branch_id: string
  report_date: string
  manager_name: string
  status: 'draft' | 'submitted'
  turnover: number
  tbc: number
  bog: number
  keepz: number
  z_photo_path: string | null
  unreceipted_expense: number
  glovo: number
  wolt: number
  consignments: number
  actual_cash: number | null
  submitted_at: string | null
}

export interface Receipt { id: string; report_id: string; company: string; tax_id: string; amount: number; receipt_date: string | null; photo_path: string | null; read_by_ai: boolean }
export interface Salary { id: string; report_id: string; first_name: string; last_name: string; amount: number; salary_month: string }
export interface CashIn { id: string; report_id: string; amount: number; comment: string }
export interface CashOut { id: string; report_id: string; amount: number; recipient: string }

export interface FullReport {
  report: Report
  receipts: Receipt[]
  salaries: Salary[]
  cashIn: CashIn[]
  cashOut: CashOut[]
  previousCash: number | null // null = წინა დღე და საწყისი ნაშთი არ არსებობს
}
