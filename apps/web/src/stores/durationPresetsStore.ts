import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const DEFAULT_PRESETS = [30, 60, 120, 180]
export const MAX_PRESETS_COUNT = 5

interface DurationPresetsState {
  presets: number[] // in minutes, sorted ascending
  addPreset: (minutes: number) => void
  removePreset: (minutes: number) => void
}

export const useDurationPresetsStore = create<DurationPresetsState>()(
  persist(
    (set, get) => ({
      presets: DEFAULT_PRESETS,
      addPreset: (minutes) => {
        const { presets } = get()
        if (presets.includes(minutes) || presets.length >= MAX_PRESETS_COUNT || minutes < 1) return
        set({ presets: [...presets, minutes].sort((a, b) => a - b) })
      },
      removePreset: (minutes) => {
        set({ presets: get().presets.filter((p) => p !== minutes) })
      },
    }),
    { name: 'fg-duration-presets' },
  ),
)

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} hr`
  return `${h} hr ${m} min`
}
