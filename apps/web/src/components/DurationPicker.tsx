import { useState } from 'react'
import { useDurationPresetsStore, formatDuration } from '../stores/durationPresetsStore'

interface Props {
  durationMinutes: number
  onChange: (minutes: number) => void
  disabled?: boolean
}

export default function DurationPicker({ durationMinutes, onChange, disabled }: Props) {
  const presets = useDurationPresetsStore((s) => s.presets)

  const [mode, setMode] = useState<'preset' | 'custom'>(() =>
    presets.includes(durationMinutes) ? 'preset' : 'custom',
  )
  const [customHr, setCustomHr] = useState(() => Math.floor(durationMinutes / 60))
  const [customMin, setCustomMin] = useState(() => durationMinutes % 60)

  const handleSelectChange = (value: string) => {
    if (value === 'custom') {
      setMode('custom')
    } else {
      const m = Number(value)
      setMode('preset')
      onChange(m)
    }
  }

  const handleCustomChange = (hr: number, min: number) => {
    const total = hr * 60 + min
    if (total > 0) onChange(total)
  }

  const selectValue = mode === 'custom' ? 'custom' : String(durationMinutes)

  return (
    <div className="space-y-2">
      <select
        value={selectValue}
        onChange={(e) => handleSelectChange(e.target.value)}
        disabled={disabled}
        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
      >
        {presets.map((p) => (
          <option key={p} value={String(p)}>
            {formatDuration(p)}
          </option>
        ))}
        <option value="custom">Custom</option>
      </select>

      {mode === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            max="23"
            value={customHr}
            onChange={(e) => {
              const h = Math.max(0, Number(e.target.value))
              setCustomHr(h)
              handleCustomChange(h, customMin)
            }}
            disabled={disabled}
            className="w-20 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-center focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
          />
          <span className="text-gray-400 text-sm">hr</span>
          <input
            type="number"
            min="0"
            max="59"
            value={customMin}
            onChange={(e) => {
              const m = Math.max(0, Math.min(59, Number(e.target.value)))
              setCustomMin(m)
              handleCustomChange(customHr, m)
            }}
            disabled={disabled}
            className="w-20 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-center focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
          />
          <span className="text-gray-400 text-sm">min</span>
        </div>
      )}
    </div>
  )
}
