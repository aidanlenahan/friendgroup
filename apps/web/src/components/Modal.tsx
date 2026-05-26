import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
}

export default function Modal({ open, onClose, children }: ModalProps) {
  // Track visual viewport height so the overlay stays above the soft keyboard.
  // When the keyboard opens, vv.height shrinks; the overlay height follows,
  // keeping the modal centered in the visible area rather than behind the keyboard.
  const [vvHeight, setVvHeight] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setVvHeight(vv.height)
    vv.addEventListener('resize', update)
    update()
    return () => {
      vv.removeEventListener('resize', update)
      setVvHeight(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      style={vvHeight !== null ? { height: vvHeight } : undefined}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-md border border-gray-800 overflow-y-auto max-h-full">
        {children}
      </div>
    </div>
  )
}
