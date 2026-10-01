import { useCallback, useEffect, useState } from 'react'
import { loadFull, listBranches } from '../lib/db'
import type { Branch, FullReport } from '../lib/types'

export function useReport(id: string | undefined) {
  const [full, setFull] = useState<FullReport | null>(null)
  const [branch, setBranch] = useState<Branch | null>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!id) return
    try {
      const f = await loadFull(id)
      setFull(f)
      const bs = await listBranches()
      setBranch(bs.find((b) => b.id === f.report.branch_id) ?? null)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])

  useEffect(() => { void refresh() }, [refresh])
  return { full, branch, error, refresh, locked: full?.report.status === 'submitted' }
}
