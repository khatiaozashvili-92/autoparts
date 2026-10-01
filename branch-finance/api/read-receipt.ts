// Vercel serverless function: ჩეკის ფოტოდან მონაცემების წაკითხვა (Claude vision).
// OPENROUTER_API_KEY ინახება მხოლოდ Vercel-ის გარემოს ცვლადებში.
// მოდელი იცვლება RECEIPT_MODEL ცვლადით (იხ. openrouter.ai/models).
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
  const key = process.env.OPENROUTER_API_KEY
  const model = process.env.RECEIPT_MODEL
  if (!key || !model) return res.status(500).json({ error: 'OPENROUTER_API_KEY ან RECEIPT_MODEL არ არის დაყენებული' })

  const image = (req.body as { image?: string })?.image
  if (!image) return res.status(400).json({ error: 'image missing' })

  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
    })
    if (!r.ok) return res.status(502).json({ error: `AI error ${r.status}` })
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] }
    const text = j.choices?.[0]?.message?.content ?? ''
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return res.status(502).json({ error: 'bad AI response' })
    return res.status(200).json(JSON.parse(m[0]))
  } catch (e) {
    return res.status(502).json({ error: (e as Error).message })
  }
}
