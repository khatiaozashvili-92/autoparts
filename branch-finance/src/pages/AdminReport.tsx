import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useReport } from '../components/useReport'
import { Breakdown, Outcome } from '../components/Breakdown'
import { PhotoView } from '../components/Photo'
import { reopenReport } from '../lib/db'
import { money, monthLabel } from '../lib/format'

export default function AdminReport() {
  const { id = '' } = useParams()
  const { full, branch, error, refresh } = useReport(id)
  const [busy, setBusy] = useState(false)
  const r = full?.report

  const reopen = async () => {
    if (!r || !confirm('დავაბრუნო მონახაზში? მენეჯერი შეძლებს გასწორებას.')) return
    setBusy(true)
    try { await reopenReport(id, 'ადმინისტრატორი'); await refresh() } catch (e) { alert((e as Error).message) }
    setBusy(false)
  }

  return (
    <div className="page">
      <div className="nav"><Link to="/admin">← სია</Link></div>
      <h1>{branch?.name} · {r?.report_date}</h1>
      {error && <div className="banner err">{error}</div>}
      {full && r && (
        <div className="stack">
          <div className="card row">
            <span>მენეჯერი: <strong>{r.manager_name}</strong><br /><span className="muted">{r.status === 'submitted' ? `გაგზავნილია ${r.submitted_at?.slice(0, 16).replace('T', ' ')}` : 'მონახაზი'}</span></span>
            {r.status === 'submitted' && <button className="ghost" disabled={busy} onClick={reopen}>დაბრუნება რედაქტირებისთვის</button>}
          </div>
          <Breakdown full={full} />
          <div className="card"><div className="row"><span>რეალურად მაქვს</span><strong>{money(r.actual_cash)}</strong></div></div>
          <Outcome full={full} />
          <div className="card stack">
            <h2 style={{ margin: 0 }}>შემოსავალი</h2>
            <div className="muted">TBC {money(r.tbc)} · BOG {money(r.bog)} · KEEPZ {money(r.keepz)}</div>
            <PhotoView path={r.z_photo_path} />
          </div>
          <div className="card stack">
            <h2 style={{ margin: 0 }}>ჩეკები</h2>
            {full.receipts.map((x) => (
              <div key={x.id} className="stack">
                <div>{money(x.amount)} <span className="muted">· {x.company} · ს/კ {x.tax_id} · {x.receipt_date}{x.read_by_ai ? ' · ავტო' : ' · ხელით'}</span></div>
                <PhotoView path={x.photo_path} />
              </div>
            ))}
            {!full.receipts.length && <span className="muted">არ არის</span>}
          </div>
          <div className="card stack">
            <h2 style={{ margin: 0 }}>ხელფასები</h2>
            {full.salaries.map((x) => <div key={x.id}>{money(x.amount)} <span className="muted">· {x.first_name} {x.last_name} · {monthLabel(x.salary_month)}</span></div>)}
            {!full.salaries.length && <span className="muted">არ არის</span>}
          </div>
          <div className="card stack">
            <h2 style={{ margin: 0 }}>ქეშის მოძრაობა</h2>
            {full.cashIn.map((x) => <div key={x.id}>+ {money(x.amount)} <span className="muted">· {x.comment}</span></div>)}
            {full.cashOut.map((x) => <div key={x.id}>− {money(x.amount)} <span className="muted">· {x.recipient}</span></div>)}
            {!full.cashIn.length && !full.cashOut.length && <span className="muted">არ არის</span>}
          </div>
          <div className="card muted">სხვა გაყიდვები: GLOVO {money(r.glovo)} · WOLT {money(r.wolt)} · კონსიგნაცია {money(r.consignments)}<br />უსაბუთო ხარჯი: {money(r.unreceipted_expense)}</div>
        </div>
      )}
    </div>
  )
}
