import { useInfiniteQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'

export type MessageReaction = { userId: string; emoji: string }

export type ChannelMessage = {
  id: string
  content: string
  createdAt: string
  updatedAt?: string
  userId: string
  pinned?: boolean
  replyToId?: string | null
  replyTo?: { id: string; content: string; user: { id: string; name: string } } | null
  user?: { id: string; name: string; email?: string; avatarUrl?: string | null }
  reactions?: MessageReaction[]
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
    maxPages: 10,
    enabled: !!groupId && !!channelId,
  })
}
