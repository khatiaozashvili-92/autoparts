import { Link, useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import Shell from '../components/Shell'
import { useReport } from '../components/useReport'
import { submitReport, summarize } from '../lib/db'
import { money, signed } from '../lib/format'

export default function ReportHub() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { full, branch, error, refresh, locked } = useReport(id)
  const [busy, setBusy] = useState(false)
  const s = full ? summarize(full) : null
  const r = full?.report

  const submit = async () => {
    if (!full || !s) return
    if (s.diff === null) return alert('ჯერ შედეგის გვერდზე შეიყვანეთ „რეალურად მაქვს“.')
    if (!confirm('გაგზავნის შემდეგ ანგარიშს ვეღარ შეასწორებთ. გავაგზავნო?')) return
    setBusy(true)
    try { await submitReport(id, full.report.manager_name); await refresh() } catch (e) { alert((e as Error).message) }
    setBusy(false)
  }

  const tiles = full && s && r ? [
    { to: 'income', t: 'შემოსავალი', v: money(r.turnover), sub: 'დღის ნავაჭრი' },
    { to: 'expenses', t: 'ხარჯი', v: money(s.receiptsTotal + s.unreceiptedExpense + s.salariesTotal), sub: `${full.receipts.length} ჩეკი · ${full.salaries.length} ხელფასი` },
    { to: 'cash', t: 'ქეშის მოძრაობა', v: money(s.cashInTotal - s.cashOutTotal), sub: 'მიღებული − გაცემული' },
    { to: 'other', t: 'სხვა გაყიდვები', v: money(r.glovo + r.wolt + r.consignments), sub: 'GLOVO · WOLT · კონსიგნაცია' },
    { to: 'result', t: 'შედეგი', v: s.diff === null ? 'არ არის შევსებული' : signed(s.diff), sub: `უნდა მქონდეს: ${money(s.expected)}`, cls: s.diff === null ? '' : s.diff < 0 ? 'neg' : s.diff > 0 ? 'pos' : '' },
  ] : []

  return (
    <Shell id={id} title="ანგარიში" full={full} branchName={branch?.name} error={error} locked={locked}>
      <div className="stack">
        {tiles.map((t) => (
          <Link key={t.to} to={`/r/${id}/${t.to}`} className="card tile">
            <div className="row"><span>{t.t}</span><span className={`total ${t.cls ?? ''}`}>{t.v}</span></div>
            <div className="muted">{t.sub}</div>
          </Link>
        ))}
        {!locked ? (
          <button disabled={busy} onClick={submit}>ანგარიშის გაგზავნა</button>
        ) : <div className="banner ok">გაგზავნილია ✓</div>}
        <button className="ghost" onClick={() => nav('/')}>სხვა ფილიალი / თარიღი</button>
      </div>
    </Shell>
  )
}
