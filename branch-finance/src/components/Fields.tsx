import { useEffect, useState } from 'react'
import { parseNum } from '../lib/format'

/** რიცხვითი ველი: ინახება ფოკუსის დაკარგვისას */
export function NumberField({ label, value, onSave, disabled, nullable }: {
  label: string
  value: number | null
  onSave: (n: number) => void | Promise<void>
  disabled?: boolean
  nullable?: boolean
}) {
  const show = (v: number | null) => (v === null || (v === 0 && !nullable) ? '' : String(v))
  const [text, setText] = useState(show(value))
  useEffect(() => setText(show(value)), [value]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <label>{label}</label>
      <input
        inputMode="decimal"
        placeholder="0.00"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text.trim() === '' && nullable) return
          const n = parseNum(text)
          setText(String(n))
          if (n !== value) void onSave(n)
        }}
      />
    </div>
  )
}
