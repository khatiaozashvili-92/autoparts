export interface OcrResult {
  kind: 'fiscal' | 'handwritten' | 'bank_slip' | 'other'
  multiple_documents: boolean
  readable: boolean
  company: string | null
  tax_id: string | null
  amount: number | null
  date: string | null
}

export async function readReceipt(base64: string): Promise<OcrResult> {
  const r = await fetch('/api/read-receipt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image: base64 }),
  })
  if (!r.ok) throw new Error('ავტომატური წაკითხვა ვერ მოხერხდა')
  return r.json()
}

/** ავტოშევსება ნებადართულია მხოლოდ მაშინ, როცა ყველაფერი მკაფიოდ იკითხება */
export function trustworthy(o: OcrResult): boolean {
  return (
    o.kind === 'fiscal' &&
    o.readable &&
    !o.multiple_documents &&
    !!o.company &&
    !!o.tax_id &&
    /^\d{9}(\d{2})?$/.test(o.tax_id) &&
    typeof o.amount === 'number' &&
    o.amount > 0 &&
    !!o.date &&
    /^\d{4}-\d{2}-\d{2}$/.test(o.date)
  )
}
