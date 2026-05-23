import { QueryClient, QueryCache } from '@tanstack/react-query'
import { ApiError } from './api'

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      // Lazy import to avoid circular dependency at module load time.
      import('../stores/authStore').then(({ useAuthStore }) => {
        if (error instanceof ApiError && error.status === 401 && useAuthStore.getState().user) {
          window.dispatchEvent(new CustomEvent('auth:expired'))
        }
      })
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        const apiError = error instanceof ApiError ? error : null
        if (apiError?.status === 401 || apiError?.status === 403 || apiError?.status === 404) {
          return false
        }

        if (apiError?.status === 429 || (apiError && apiError.status >= 500) || apiError?.status === 0) {
          return failureCount < 3
        }

        return failureCount < 2
      },
      retryDelay: (attemptIndex, error) => {
        if (error instanceof ApiError && error.status === 429 && error.retryAfterSeconds) {
          return error.retryAfterSeconds * 1000
        }

        const base = 600
        return Math.min(base * 2 ** attemptIndex, 5_000)
      },
    },
  },
})
