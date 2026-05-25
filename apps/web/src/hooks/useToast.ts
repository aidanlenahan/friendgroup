import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: string
  type: ToastType
  message: string
}

interface ToastState {
  toasts: Toast[]
  addToast: (type: ToastType, message: string, duration?: number) => void
  removeToast: (id: string) => void
}

let counter = 0

// Default durations: errors stay longer so users can read them.
const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 4000,
  error: 6000,
  info: 4000,
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (type, message, duration) => {
    const id = `toast-${++counter}`
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, duration ?? DEFAULT_DURATION[type])
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export function useToast() {
  const addToast = useToastStore((s) => s.addToast)
  return {
    success: (msg: string, opts?: { duration?: number }) => addToast('success', msg, opts?.duration),
    error: (msg: string, opts?: { duration?: number }) => addToast('error', msg, opts?.duration),
    info: (msg: string, opts?: { duration?: number }) => addToast('info', msg, opts?.duration),
  }
}
