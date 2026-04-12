import { useToastStore } from '../hooks/useToast'

const typeClasses = {
  success: 'bg-green-900 border-green-700 text-green-200',
  error: 'bg-red-900 border-red-700 text-red-200',
  info: 'bg-blue-900 border-blue-700 text-blue-200',
}

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`px-4 py-3 rounded-xl border text-sm shadow-lg ${typeClasses[toast.type]}`}
        >
          <div className="flex items-center justify-between gap-3">
            <span>{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-current opacity-60 hover:opacity-100"
            >
              x
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
