import { money, signed } from '../lib/format'
import { summarize } from '../lib/db'
import type { FullReport } from '../lib/types'

export function Breakdown({ full }: { full: FullReport }) {
  const s = summarize(full)
  const lines: [string, string][] = [
    ['წინა დღის „მაქვს“', money(s.previousCash)],
    ['+ დღის ნავაჭრი', money(s.turnover)],
    ['− TBC', money(s.tbc)],
    ['− BOG', money(s.bog)],
    ['− KEEPZ', money(s.keepz)],
    ['− ხარჯი საბუთით', money(s.receiptsTotal)],
    ['− უსაბუთო ხარჯი', money(s.unreceiptedExpense)],
    ['− ხელფასები', money(s.salariesTotal)],
    ['− გაცემული ქეში', money(s.cashOutTotal)],
    ['+ მიღებული ქეში', money(s.cashInTotal)],
  ]
  return (
    <div className="card stack">
      {lines.map(([k, v]) => <div className="row" key={k}><span>{k}</span><span>{v}</span></div>)}
      <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
      <div className="row"><strong>უნდა მქონდეს</strong><span className="big">{money(s.expected)}</span></div>
    </div>
  )
}

export function Outcome({ full }: { full: FullReport }) {
  const s = summarize(full)
  const cls = s.diff === null ? '' : s.diff < 0 ? 'neg' : s.diff > 0 ? 'pos' : ''
  const word = s.diff === null ? '' : s.diff < 0 ? 'ნაკლებობა' : s.diff > 0 ? 'ჭარბობა' : 'ზუსტად ემთხვევა'
  return (
    <div className="card">
      <div className="row"><strong>შედეგი</strong><span className={`big ${cls}`}>{s.diff === null ? '—' : signed(s.diff)}</span></div>
      {word && <p className={`muted ${cls}`}>{word}</p>}
    </div>
  )
}
