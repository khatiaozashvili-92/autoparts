// Vercel serverless function: ჩეკის ფოტოდან მონაცემების წაკითხვა (Claude vision).
// ANTHROPIC_API_KEY ინახება მხოლოდ Vercel-ის გარემოს ცვლადებში.
import type { VercelRequest, VercelResponse } from '@vercel/node'

const PROMPT = `You are reading ONE photo of a Georgian purchase receipt. Return ONLY a JSON object, no prose:
{
  "kind": "fiscal" | "handwritten" | "bank_slip" | "other",
  "multiple_documents": boolean,
  "readable": boolean,
  "company": string | null,
  "tax_id": string | null,
  "amount": number | null,
  "date": "YYYY-MM-DD" | null
}
Rules:
- "fiscal": printed cash-register receipt (has company name, tax ID "ს/კ" / 9 or 11 digits, total "ჯამი", date dd-mm-yyyy).
- "handwritten": handwritten receipt/waybill. "bank_slip": bank POS card-payment slip (Bank of Georgia/TBC etc). Otherwise "other".
- multiple_documents = true if more than one separate receipt/document is visible.
- readable = true ONLY if company, tax_id, total amount and date are all clearly legible. If anything is blurred, cut off, covered or you are guessing, set readable=false.
- amount is the TOTAL paid (ჯამი), as a number with a dot decimal. tax_id digits only.
- Never guess. Use null for anything you cannot read.`

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return res.status(500).json({ error: 'ANTHROPIC_API_KEY არ არის დაყენებული' })

  const image = (req.body as { image?: string })?.image
  if (!image) return res.status(400).json({ error: 'image missing' })

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.RECEIPT_MODEL || 'claude-sonnet-5-5',
        max_tokens: 400,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
    })
    if (!r.ok) return res.status(502).json({ error: `AI error ${r.status}` })
    const j = (await r.json()) as { content: { type: string; text?: string }[] }
    const text = j.content.find((c) => c.type === 'text')?.text ?? ''
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return res.status(502).json({ error: 'bad AI response' })
    return res.status(200).json(JSON.parse(m[0]))
  } catch (e) {
    return res.status(502).json({ error: (e as Error).message })
  }
}
