import { useState } from 'react'
import { useParams } from 'react-router-dom'
import Shell from '../components/Shell'
import { useReport } from '../components/useReport'
import { NumberField } from '../components/Fields'
import { FilePick, PhotoView } from '../components/Photo'
import { addRow, deleteRow, isDuplicateReceipt, patchReport, uploadPhoto } from '../lib/db'
import { shrink, toBase64 } from '../lib/image'
import { readReceipt, trustworthy } from '../lib/ocr'
import { money, monthLabel, monthOptions, parseNum } from '../lib/format'

interface Draft { path: string; company: string; taxId: string; amount: string; date: string; auto: boolean; note: string }

function ReceiptSection({ id, locked, receipts, onChange }: { id: string; locked?: boolean; receipts: import('../lib/types').Receipt[]; onChange: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const total = receipts.reduce((s, r) => s + r.amount, 0)

  const pick = async (f: File) => {
    setBusy(true); setErr(''); setDraft(null)
    try {
      const blob = await shrink(f)
      const [path, ocr] = await Promise.all([
        uploadPhoto(id, 'receipt', blob),
        toBase64(blob).then(readReceipt).catch(() => null),
      ])
      if (ocr?.kind === 'bank_slip') { setErr('ეს ბანკის POS ქვითარია და არა ხარჯის ჩეკი. გადაიღეთ მაღაზიის ჩეკი.'); return }
      if (ocr?.multiple_documents) { setErr('ფოტოზე რამდენიმე ჩეკია. გადაიღეთ თითო ჩეკი ცალკე.'); return }
      if (ocr && trustworthy(ocr)) {
        setDraft({ path, company: ocr.company!, taxId: ocr.tax_id!, amount: String(ocr.amount), date: ocr.date!, auto: true, note: 'წაკითხულია ავტომატურად. გადაამოწმეთ ჩეკთან და დაადასტურეთ.' })
      } else {
        setDraft({ path, company: '', taxId: '', amount: '', date: '', auto: false, note: 'ჩეკი კარგად ვერ იკითხება. შეიყვანეთ მონაცემები ხელით ჩეკის მიხედვით.' })
      }
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const amount = draft ? parseNum(draft.amount) : 0
  const valid = !!draft && draft.company.trim() && /^\d{9}(\d{2})?$/.test(draft.taxId.trim()) && amount > 0 && draft.date

  const confirm = async () => {
    if (!draft || !valid) return
    setBusy(true)
    try {
      if (await isDuplicateReceipt(draft.taxId.trim(), amount, draft.date)) { setErr('ეს ჩეკი (იგივე ს/კ, თარიღი და თანხა) უკვე ატვირთულია.'); setBusy(false); return }
      await addRow('receipts', { report_id: id, company: draft.company.trim(), tax_id: draft.taxId.trim(), amount, receipt_date: draft.date, photo_path: draft.path, read_by_ai: draft.auto })
      setDraft(null); setErr(''); onChange()
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }

  return (
    <div className="card stack">
      <div className="row"><h2 style={{ margin: 0 }}>ხარჯი საბუთით</h2><strong>{money(total)}</strong></div>
      {err && <div className="banner err">{err}</div>}
      {receipts.map((r) => (
        <div key={r.id} className="row">
          <span>{money(r.amount)} <span className="muted">· {r.company} · ს/კ {r.tax_id} · {r.receipt_date}</span></span>
          {!locked && <button className="ghost" onClick={async () => { await deleteRow('receipts', r.id); onChange() }}>წაშლა</button>}
        </div>
      ))}
      {!locked && !draft && <FilePick label={busy ? 'მუშავდება…' : 'ჩეკის გადაღება (თითო ჩეკი ცალკე)'} onFile={pick} disabled={busy} />}
      {draft && (
        <div className="stack">
          <PhotoView path={draft.path} />
          <div className={`banner ${draft.auto ? 'ok' : ''}`}>{draft.note}</div>
          <div><label>კომპანია</label><input value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} /></div>
          <div><label>საიდენტიფიკაციო კოდი (9 ან 11 ციფრი)</label><input inputMode="numeric" value={draft.taxId} onChange={(e) => setDraft({ ...draft, taxId: e.target.value })} /></div>
          <div><label>თანხა</label><input inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} /></div>
          <div><label>თარიღი</label><input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></div>
          <div className="row">
            <button className="ghost" onClick={() => setDraft(null)}>გაუქმება</button>
            <button disabled={!valid || busy} onClick={confirm}>დადასტურება</button>
          </div>
        </div>
      )}
    </div>
  )
}

function SalarySection({ id, locked, salaries, onChange }: { id: string; locked?: boolean; salaries: import('../lib/types').Salary[]; onChange: () => void }) {
  const months = monthOptions()
  const [first, setFirst] = useState(''); const [last, setLast] = useState(''); const [amount, setAmount] = useState(''); const [month, setMonth] = useState(months[1] ?? months[0])
  const [err, setErr] = useState('')
  const total = salaries.reduce((s, r) => s + r.amount, 0)
  const add = async () => {
    try {
      await addRow('salaries', { report_id: id, first_name: first.trim(), last_name: last.trim(), amount: parseNum(amount), salary_month: month })
      setFirst(''); setLast(''); setAmount(''); setErr(''); onChange()
    } catch (e) { setErr((e as Error).message) }
  }
  return (
    <div className="card stack">
      <div className="row"><h2 style={{ margin: 0 }}>ხელფასები</h2><strong>{money(total)}</strong></div>
      {err && <div className="banner err">{err}</div>}
      {salaries.map((s) => (
        <div key={s.id} className="row">
          <span>{money(s.amount)} <span className="muted">· {s.first_name} {s.last_name} · {monthLabel(s.salary_month)}</span></span>
          {!locked && <button className="ghost" onClick={async () => { await deleteRow('salaries', s.id); onChange() }}>წაშლა</button>}
        </div>
      ))}
      {!locked && (
        <>
          <div><label>სახელი</label><input value={first} onChange={(e) => setFirst(e.target.value)} /></div>
          <div><label>გვარი</label><input value={last} onChange={(e) => setLast(e.target.value)} /></div>
          <div><label>თანხა</label><input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><label>რომელი თვის ხელფასი</label>
            <select value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
          </div>
          <button disabled={!first.trim() || !last.trim() || parseNum(amount) <= 0} onClick={add}>დამატება</button>
        </>
      )}
    </div>
  )
}

export default function Expenses() {
  const { id = '' } = useParams()
  const { full, branch, error, refresh, locked } = useReport(id)
  const [msg, setMsg] = useState('')
  return (
    <Shell id={id} title="ხარჯი" full={full} branchName={branch?.name} error={error || msg} locked={locked}>
      {full && (
        <>
          <ReceiptSection id={id} locked={locked} receipts={full.receipts} onChange={refresh} />
          <div className="card stack">
            <NumberField label="უსაბუთო ხარჯი" value={full.report.unreceipted_expense} disabled={locked}
              onSave={(n) => patchReport(id, { unreceipted_expense: n }).then(refresh).catch((e) => setMsg(e.message))} />
          </div>
          <SalarySection id={id} locked={locked} salaries={full.salaries} onChange={refresh} />
        </>
      )}
    </Shell>
  )
}
