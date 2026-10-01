import { useEffect, useState } from 'react'
import { photoUrl } from '../lib/db'

export function PhotoView({ path }: { path: string | null }) {
  const [url, setUrl] = useState('')
  useEffect(() => { if (path) photoUrl(path).then(setUrl).catch(() => setUrl('')); else setUrl('') }, [path])
  if (!path) return null
  return url ? <a href={url} target="_blank" rel="noreferrer"><img className="thumb" src={url} alt="ფოტო" /></a> : <p className="muted">ფოტო იტვირთება…</p>
}

export function FilePick({ label, onFile, disabled }: { label: string; onFile: (f: File) => void; disabled?: boolean }) {
  return (
    <label className="btn ghost" style={{ opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      {label}
      <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
    </label>
  )
}
