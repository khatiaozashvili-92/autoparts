import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminList, listBranches, loadMany, summarize, loadFull } from '../lib/db'
import { exportExcel } from '../lib/excel'
import { money, signed } from '../lib/format'
import type { Branch, FullReport, Report } from '../lib/types'

export default function Admin() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchId, setBranchId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState('')
  const [reports, setReports] = useState<Report[]>([])
  const [fulls, setFulls] = useState<Record<string, FullReport>>({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { listBranches().then(setBranches).catch((e) => setErr(e.message)) }, [])
  const name = useMemo(() => Object.fromEntries(branches.map((b) => [b.id, b.name])), [branches])

  useEffect(() => {
    setErr('')
    adminList({ branchId: branchId || undefined, from: from || undefined, to: to || undefined, status: status || undefined })
      .then(async (rs) => {
        setReports(rs)
        const fs = await loadMany(rs.slice(0, 200).map((r) => r.id))
        setFulls(Object.fromEntries(fs.map((f) => [f.report.id, f])))
      })
      .catch((e) => setErr(e.message))
  }, [branchId, from, to, status])

  const doExport = async () => {
    setBusy(true)
    try {
      const all = await Promise.all(reports.map((r) => fulls[r.id] ?? loadFull(r.id)))
      exportExcel(all.map((f) => ({ branchName: name[f.report.branch_id] ?? '', full: f })), `ანგარიშები_${from || 'ყველა'}_${to || ''}.xlsx`)
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }

  return (
    <div className="page wide">
      <div className="nav"><Link to="/">← მენეჯერის გვერდი</Link></div>
      <h1>ადმინისტრატორი</h1>
      {err && <div className="banner err">{err}</div>}
      <div className="filters">
        <div><label>ფილიალი</label><select value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">ყველა</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
        <div><label>თარიღიდან</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label>თარიღამდე</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div><label>სტატუსი</label><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">ყველა</option><option value="submitted">გაგზავნილი</option><option value="draft">მონახაზი</option></select></div>
      </div>
      <p><button disabled={busy || !reports.length} onClick={doExport}>{busy ? 'მზადდება…' : `Excel-ში ექსპორტი (${reports.length})`}</button></p>
      <div className="card scroll">
        <table>
          <thead><tr><th>თარიღი</th><th>ფილიალი</th><th>მენეჯერი</th><th>სტატუსი</th><th>ნავაჭრი</th><th>უნდა მქონდეს</th><th>რეალურად</th><th>შედეგი</th></tr></thead>
          <tbody>
            {reports.map((r) => {
              const f = fulls[r.id]; const s = f ? summarize(f) : null
              return (
                <tr key={r.id}>
                  <td><Link to={`/admin/${r.id}`}>{r.report_date}</Link></td>
                  <td>{name[r.branch_id]}</td><td>{r.manager_name}</td>
                  <td>{r.status === 'submitted' ? 'გაგზავნილი' : 'მონახაზი'}</td>
                  <td>{money(r.turnover)}</td><td>{s ? money(s.expected) : '…'}</td><td>{money(r.actual_cash)}</td>
                  <td className={s?.diff == null ? '' : s.diff < 0 ? 'neg' : s.diff > 0 ? 'pos' : ''}>{s?.diff == null ? '—' : signed(s.diff)}</td>
                </tr>
              )
            })}
            {!reports.length && <tr><td colSpan={8} className="muted">ანგარიშები არ მოიძებნა</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
