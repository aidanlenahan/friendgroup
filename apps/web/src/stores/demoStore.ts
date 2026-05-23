import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { randomUUID } from '../lib/uuid'

interface DemoState {
  isDemoMode: boolean
  demoSessionId: string | null
  demoExpiresAt: number | null  // unix ms
  demoDeviceId: string          // persisted across visits
  queuePosition: number | null  // null = not queued
  getOrCreateDeviceId: () => string
  startDemo: (sessionId: string, expiresAt: number) => void
  endDemo: () => void
  setQueuePosition: (pos: number | null) => void
}

export const useDemoStore = create<DemoState>()(
  persist(
    (set, get) => ({
      isDemoMode: false,
      demoSessionId: null,
      demoExpiresAt: null,
      demoDeviceId: randomUUID(),
      queuePosition: null,

      getOrCreateDeviceId: () => {
        return get().demoDeviceId
      },

      startDemo: (sessionId, expiresAt) => {
        set({ isDemoMode: true, demoSessionId: sessionId, demoExpiresAt: expiresAt, queuePosition: null })
      },

      endDemo: () => {
        set({ isDemoMode: false, demoSessionId: null, demoExpiresAt: null, queuePosition: null })
      },

      setQueuePosition: (pos) => {
        set({ queuePosition: pos })
      },
    }),
    {
      name: 'gem-demo',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        demoDeviceId: state.demoDeviceId,
        isDemoMode: state.isDemoMode,
        demoSessionId: state.demoSessionId,
        demoExpiresAt: state.demoExpiresAt,
      }),
    }
  )
)
