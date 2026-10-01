import { useState } from 'react'
import { useParams } from 'react-router-dom'
import Shell from '../components/Shell'
import { useReport } from '../components/useReport'
import { NumberField } from '../components/Fields'
import { FilePick, PhotoView } from '../components/Photo'
import { patchReport, uploadPhoto } from '../lib/db'
import { shrink } from '../lib/image'
import type { Report } from '../lib/types'

export default function Income() {
  const { id = '' } = useParams()
  const { full, branch, error, refresh, locked } = useReport(id)
  const [msg, setMsg] = useState('')
  const r = full?.report

  const save = (patch: Partial<Report>) => patchReport(id, patch).then(refresh).catch((e) => setMsg(e.message))
  const upload = async (f: File) => {
    setMsg('იტვირთება…')
    try { const path = await uploadPhoto(id, 'z', await shrink(f)); await patchReport(id, { z_photo_path: path }); await refresh(); setMsg('') }
    catch (e) { setMsg((e as Error).message) }
  }

  return (
    <Shell id={id} title="შემოსავალი" full={full} branchName={branch?.name} error={error || msg} locked={locked}>
      {r && (
        <div className="card stack">
          <NumberField label="დღის ნავაჭრი" value={r.turnover} disabled={locked} onSave={(n) => save({ turnover: n })} />
          <NumberField label="TBC" value={r.tbc} disabled={locked} onSave={(n) => save({ tbc: n })} />
          <NumberField label="BOG" value={r.bog} disabled={locked} onSave={(n) => save({ bog: n })} />
          <NumberField label="KEEPZ" value={r.keepz} disabled={locked} onSave={(n) => save({ keepz: n })} />
          <div>
            <label>Z რეპორტი (ფოტო)</label>
            <PhotoView path={r.z_photo_path} />
            <div style={{ marginTop: 8 }}><FilePick label={r.z_photo_path ? 'ფოტოს შეცვლა' : 'ფოტოს გადაღება / ატვირთვა'} onFile={upload} disabled={locked} /></div>
          </div>
        </div>
      )}
    </Shell>
  )
}
