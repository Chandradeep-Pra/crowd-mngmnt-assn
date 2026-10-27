import { QueryClient } from '@tanstack/react-query'

/** Client freshness policy, not a guarantee about source data or a server rate limit. */
export function createApiQueryClient(staleTimeMs = 30_000) {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: staleTimeMs,
        gcTime: 5 * 60_000,
        retry: false,
        refetchOnMount: true,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchInterval: false,
      },
      mutations: { retry: false },
    },
  })
}
