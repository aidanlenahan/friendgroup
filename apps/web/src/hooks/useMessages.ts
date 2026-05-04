import { useInfiniteQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'

export type ChannelMessage = {
  id: string
  content: string
  createdAt: string
  userId: string
  user?: { id: string; name: string; email: string; avatarUrl?: string | null }
}

export type ChannelMessagesPage = {
  messages: ChannelMessage[]
  hasMore: boolean
}

export function useChannelMessages(groupId: string, channelId: string) {
  return useInfiniteQuery({
    queryKey: ['messages', 'channel', channelId],
    queryFn: ({ pageParam }) =>
      apiFetch<ChannelMessagesPage>(
        `/groups/${groupId}/channels/${channelId}/messages?limit=50${pageParam ? `&before=${pageParam}` : ''}`,
      ),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.messages[0]?.id : undefined),
    initialPageParam: undefined as string | undefined,
    enabled: !!groupId && !!channelId,
  })
}
