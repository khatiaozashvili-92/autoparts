import { useState } from 'react'
import { useParams } from 'react-router-dom'
import Shell from '../components/Shell'
import { useReport } from '../components/useReport'
import { NumberField } from '../components/Fields'
import { Breakdown, Outcome } from '../components/Breakdown'
import { patchReport, setOpeningBalance } from '../lib/db'

export default function Result() {
  const { id = '' } = useParams()
  const { full, branch, error, refresh, locked } = useReport(id)
  const [msg, setMsg] = useState('')
  return (
    <Shell id={id} title="შედეგი" full={full} branchName={branch?.name} error={error || msg} locked={locked}>
      {full && branch && (
        <div className="stack">
          {full.previousCash === null && (
            <div className="card stack">
              <div className="banner">ამ ფილიალისთვის წინა დღე და საწყისი ნაშთი არ არის. შეიყვანეთ საწყისი ნაშთი (ერთჯერადად).</div>
              <NumberField label="საწყისი ნაშთი (ხელზე არსებული ქეში)" value={null} nullable disabled={locked}
                onSave={(n) => setOpeningBalance(branch.id, n).then(refresh).catch((e) => setMsg(e.message))} />
            </div>
          )}
          <Breakdown full={full} />
          <div className="card">
            <NumberField label="რეალურად მაქვს" value={full.report.actual_cash} nullable disabled={locked}
              onSave={(n) => patchReport(id, { actual_cash: n }).then(refresh).catch((e) => setMsg(e.message))} />
          </div>
          <Outcome full={full} />
        </div>
      )}
    </Shell>
  )
}
