import { useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'

/** Reads theme from auth store and applies data-theme attribute to <html>. */
export function useThemeApplier() {
  const theme = useAuthStore((s) => s.user?.theme)

  useEffect(() => {
    const resolved = theme === 'light' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', resolved)
  }, [theme])
}

/** Initialises dark theme before user loads (avoids flash on cold load). */
export function initTheme() {
  try {
    const stored = localStorage.getItem('fg-auth')
    if (stored) {
      const parsed = JSON.parse(stored) as { state?: { user?: { theme?: string } } }
      const theme = parsed?.state?.user?.theme
      if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light')
        return
      }
    }
  } catch {
    // ignore parse errors
  }
  document.documentElement.setAttribute('data-theme', 'dark')
}
