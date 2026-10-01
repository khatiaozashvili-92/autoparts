import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listBranches, openReport } from '../lib/db'
import { todayISO } from '../lib/format'
import { getManager, setManager } from '../session'
import type { Branch } from '../lib/types'

export default function Login() {
  const nav = useNavigate()
  const [branches, setBranches] = useState<Branch[]>([])
  const [name, setName] = useState(getManager())
  const [branchId, setBranchId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { listBranches().then(setBranches).catch((e) => setErr(e.message)) }, [])

  const ready = name.trim().length >= 3 && branchId && date

  const go = async () => {
    setBusy(true)
    try {
      setManager(name.trim())
      const r = await openReport(branchId, date, name.trim())
      nav(`/r/${r.id}`)
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <h1>დღიური ფინანსური ანგარიში</h1>
      {err && <div className="banner err">{err}</div>}
      <div className="card stack">
        <div>
          <label>მენეჯერის სახელი და გვარი *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="მაგ: ნინო ბერიძე" />
        </div>
        <div>
          <label>ფილიალი *</label>
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">— აირჩიეთ —</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label>თარიღი *</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <button disabled={!ready || busy} onClick={go}>გაგრძელება</button>
      </div>
      <p className="muted"><Link to="/admin">ადმინისტრატორი</Link></p>
    </div>
  )
}
