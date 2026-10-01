import { useState } from 'react'
import { useParams } from 'react-router-dom'
import Shell from '../components/Shell'
import { useReport } from '../components/useReport'
import { addRow, deleteRow } from '../lib/db'
import { money, parseNum } from '../lib/format'

function Block({ title, textLabel, rows, table, reportId, locked, onChange, field }: {
  title: string; textLabel: string; table: 'cash_in' | 'cash_out'; reportId: string; locked?: boolean
  rows: { id: string; amount: number; text: string }[]; onChange: () => void; field: 'comment' | 'recipient'
}) {
  const [amount, setAmount] = useState('')
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const add = async () => {
    try {
      await addRow(table, { report_id: reportId, amount: parseNum(amount), [field]: text.trim() })
      setAmount(''); setText(''); setErr(''); onChange()
    } catch (e) { setErr((e as Error).message) }
  }
  return (
    <div className="card stack">
      <div className="row"><h2 style={{ margin: 0 }}>{title}</h2><strong>{money(total)}</strong></div>
      {err && <div className="banner err">{err}</div>}
      {rows.map((r) => (
        <div className="row" key={r.id}>
          <span>{money(r.amount)} <span className="muted">· {r.text}</span></span>
          {!locked && <button className="ghost" onClick={async () => { await deleteRow(table, r.id); onChange() }}>წაშლა</button>}
        </div>
      ))}
      {!locked && (
        <>
          <div><label>თანხა</label><input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><label>{textLabel}</label><input value={text} onChange={(e) => setText(e.target.value)} /></div>
          <button disabled={parseNum(amount) <= 0 || !text.trim()} onClick={add}>დამატება</button>
        </>
      )}
    </div>
  )
}

export default function CashMovement() {
  const { id = '' } = useParams()
  const { full, branch, error, refresh, locked } = useReport(id)
  return (
    <Shell id={id} title="ქეშის მოძრაობა" full={full} branchName={branch?.name} error={error} locked={locked}>
      {full && (
        <>
          <Block title="მიღებული ქეში" textLabel="კომენტარი: ვისგან მიიღეს" table="cash_in" field="comment" reportId={id} locked={locked} onChange={refresh}
            rows={full.cashIn.map((r) => ({ id: r.id, amount: r.amount, text: r.comment }))} />
          <Block title="გაცემული ქეში" textLabel="ვისზე გასცეს" table="cash_out" field="recipient" reportId={id} locked={locked} onChange={refresh}
            rows={full.cashOut.map((r) => ({ id: r.id, amount: r.amount, text: r.recipient }))} />
        </>
      )}
    </Shell>
  )
}
