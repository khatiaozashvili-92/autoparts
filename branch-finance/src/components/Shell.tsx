import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { FullReport } from '../lib/types'

export default function Shell({ id, title, full, branchName, error, children, locked }: {
  id: string
  title: string
  full: FullReport | null
  branchName?: string
  error?: string
  locked?: boolean
  children: ReactNode
}) {
  return (
    <div className="page">
      <div className="nav"><Link to={`/r/${id}`}>← უკან</Link></div>
      <h1>{title}</h1>
      {full && <p className="muted">{branchName} · {full.report.report_date} · {full.report.manager_name}</p>}
      {locked && <div className="banner">ანგარიში გაგზავნილია და ჩაკეტილია. შესაცვლელად მიმართეთ ადმინს.</div>}
      {error && <div className="banner err">{error}</div>}
      {full ? children : !error && <p className="muted">იტვირთება…</p>}
    </div>
  )
}
