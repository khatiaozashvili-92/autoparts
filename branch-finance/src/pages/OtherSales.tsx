import { useState } from 'react'
import { useParams } from 'react-router-dom'
import Shell from '../components/Shell'
import { useReport } from '../components/useReport'
import { NumberField } from '../components/Fields'
import { patchReport } from '../lib/db'
import type { Report } from '../lib/types'

export default function OtherSales() {
  const { id = '' } = useParams()
  const { full, branch, error, refresh, locked } = useReport(id)
  const [msg, setMsg] = useState('')
  const r = full?.report
  const save = (patch: Partial<Report>) => patchReport(id, patch).then(refresh).catch((e) => setMsg(e.message))
  return (
    <Shell id={id} title="სხვა გაყიდვები" full={full} branchName={branch?.name} error={error || msg} locked={locked}>
      {r && (
        <div className="card stack">
          <p className="muted">საინფორმაციოა, ქეშის დათვლაში არ მონაწილეობს.</p>
          <NumberField label="GLOVO" value={r.glovo} disabled={locked} onSave={(n) => save({ glovo: n })} />
          <NumberField label="WOLT" value={r.wolt} disabled={locked} onSave={(n) => save({ wolt: n })} />
          <NumberField label="სხვა კონსიგნაციები" value={r.consignments} disabled={locked} onSave={(n) => save({ consignments: n })} />
        </div>
      )}
    </Shell>
  )
}
