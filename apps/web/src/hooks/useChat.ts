import { useEffect, useRef, useState, useCallback } from 'react'
import type { Socket } from 'socket.io-client'
import { io } from 'socket.io-client'
import { useQueryClient } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'
import { resolveApiBaseUrl } from '../lib/api'
import { acquireSocket, releaseSocket } from '../lib/socket'
import type { ChannelMessagesPage } from './useMessages'
import { useToast } from './useToast'

export interface ChatMessage {
  id: string
  userId: string
  content: string
  pinned: boolean
  createdAt: string
  updatedAt?: string
  deleted?: boolean
  replyToId?: string | null
  replyTo?: { id: string; content: string; user: { id: string; name: string } } | null
  reactions?: Array<{ userId: string; emoji: string }>
  user: { name: string; avatarUrl?: string }
}

// ---------------------------------------------------------------------------
// Event-chat hook (unchanged API, still creates its own socket)
// ---------------------------------------------------------------------------

export function useChat(eventId: string) {
  const socketRef = useRef<Socket | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const toast = useToast()

  useEffect(() => {
    const _explicit = import.meta.env.VITE_API_BASE_URL
    const socketUrl =
      (_explicit && _explicit.startsWith('http') ? _explicit : null) ??
      import.meta.env.VITE_SOCKET_URL ??
      (typeof window !== 'undefined' ? resolveApiBaseUrl() : '')
    const socket = io(socketUrl, {
      withCredentials: true,
      transports: ['websocket'],
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      socket.emit('join:event', { eventId })
    })
    socket.on('disconnect', () => setConnected(false))
    socket.on('error', () => {
      toast.error('Chat error. Please refresh if the problem persists.')
    })
    socket.on('message:new', (msg: ChatMessage) =>
      setMessages((prev) => [...prev, msg]),
    )
    socket.on('typing:start', ({ name }: { userId: string; name: string }) => {
      setTypingUsers((prev) => (prev.includes(name) ? prev : [...prev, name]))
      setTimeout(() => setTypingUsers((prev) => prev.filter((n) => n !== name)), 3000)
    })
    socket.on('message:pinned', ({ messageId }: { messageId: string }) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, pinned: true } : m)),
      )
    })

    return () => {
      socket.disconnect()
    }
  }, [eventId]) // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = (content: string) => {
    if (!socketRef.current?.connected) {
      toast.error('Not connected. Please wait and try again.')
      return
    }
    socketRef.current.emit('message:send', { eventId, content })
  }

  const sendTyping = () => {
    socketRef.current?.emit('typing:start', { eventId })
  }

  return { messages, setMessages, typingUsers, connected, sendMessage, sendTyping }
}

// ---------------------------------------------------------------------------
// Channel-chat hook — uses shared socket singleton
// ---------------------------------------------------------------------------

export interface SocketError {
  code: string
  message: string
  retryAfterSeconds?: number
}

export interface PendingMessage extends ChatMessage {
  pending: true
  failed?: boolean
}

interface CurrentUser {
  id: string
  name: string
  avatarUrl?: string | null
}

const OPTIMISTIC_TIMEOUT_MS = 5000

export function useChannelChat(groupId: string, channelId: string, currentUser?: CurrentUser) {
  const socketRef = useRef<Socket | null>(null)
  const [messages, setMessages] = useState<(ChatMessage | PendingMessage)[]>([])
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const [lastError, setLastError] = useState<SocketError | null>(null)
  const [reconnected, setReconnected] = useState(false)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const everConnectedRef = useRef(false)
  const qc = useQueryClient()

  const confirmPending = useCallback((confirmedUserId: string) => {
    setMessages((prev) => {
      const idx = prev.findIndex(
        (m) => 'pending' in m && m.pending && m.userId === confirmedUserId,
      )
      if (idx === -1) return prev
      const tempId = prev[idx].id
      const timer = pendingTimers.current.get(tempId)
      if (timer) {
        clearTimeout(timer)
        pendingTimers.current.delete(tempId)
      }
      return prev.filter((_, i) => i !== idx)
    })
  }, [])

  useEffect(() => {
    everConnectedRef.current = false
    const socket = acquireSocket()
    socketRef.current = socket

    const onConnect = () => {
      setConnected(true)
      socket.emit('join:channel', { channelId, groupId })
      if (everConnectedRef.current) {
        setReconnected(true)
      }
      everConnectedRef.current = true
    }

    const onDisconnect = () => setConnected(false)

    const onMessage = (msg: ChatMessage & { channelId?: string }) => {
      if (msg.channelId && msg.channelId !== channelId) return
      if (currentUser && msg.userId === currentUser.id) {
        confirmPending(currentUser.id)
      }
      setMessages((prev) => [...prev, msg])
    }

    const patchRestCache = (updater: (m: ChannelMessagesPage['messages'][number]) => ChannelMessagesPage['messages'][number]) => {
      qc.setQueryData<InfiniteData<ChannelMessagesPage>>(
        ['messages', 'channel', channelId],
        (old) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              messages: page.messages.map(updater),
            })),
          }
        },
      )
    }

    const onMessageDeleted = ({ messageId, channelId: evtChannelId }: { messageId: string; channelId: string }) => {
      if (evtChannelId !== channelId) return
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, deleted: true, reactions: [] } : m))
      patchRestCache((m) => m.id === messageId ? { ...m, deleted: true, reactions: [] } : m)
    }

    const onMessageEdited = ({ messageId, channelId: evtCh, content, updatedAt }: { messageId: string; channelId: string; content: string; updatedAt: string }) => {
      if (evtCh !== channelId) return
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, content, updatedAt } : m))
      patchRestCache((m) => m.id === messageId ? { ...m, content, updatedAt } : m)
    }

    const onMessagePinned = ({ messageId, channelId: evtCh, pinned }: { messageId: string; channelId: string; pinned: boolean }) => {
      if (evtCh !== channelId) return
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, pinned } : m))
      patchRestCache((m) => m.id === messageId ? { ...m, pinned } : m)
    }

    const onMessageReact = ({ messageId, channelId: evtCh, userId, emoji }: { messageId: string; channelId: string; userId: string; emoji: string }) => {
      if (evtCh !== channelId) return
      setMessages((prev) => prev.map((m) => {
        if (m.id !== messageId) return m
        const reactions = m.reactions ?? []
        if (reactions.some((r) => r.userId === userId && r.emoji === emoji)) return m
        return { ...m, reactions: [...reactions, { userId, emoji }] }
      }))
      patchRestCache((m) => {
        if (m.id !== messageId) return m
        const reactions = m.reactions ?? []
        if (reactions.some((r) => r.userId === userId && r.emoji === emoji)) return m
        return { ...m, reactions: [...reactions, { userId, emoji }] }
      })
    }

    const onMessageUnreact = ({ messageId, channelId: evtCh, userId, emoji }: { messageId: string; channelId: string; userId: string; emoji: string }) => {
      if (evtCh !== channelId) return
      setMessages((prev) => prev.map((m) => {
        if (m.id !== messageId) return m
        return { ...m, reactions: (m.reactions ?? []).filter((r) => !(r.userId === userId && r.emoji === emoji)) }
      }))
      patchRestCache((m) => {
        if (m.id !== messageId) return m
        return { ...m, reactions: (m.reactions ?? []).filter((r) => !(r.userId === userId && r.emoji === emoji)) }
      })
    }

    const onTypingStart = ({ name, channelId: evtCh }: { userId: string; name: string; channelId: string }) => {
      if (evtCh !== channelId) return
      setTypingUsers((prev) => (prev.includes(name) ? prev : [...prev, name]))
      setTimeout(() => setTypingUsers((prev) => prev.filter((n) => n !== name)), 3000)
    }

    const onTypingStop = ({ userId, channelId: evtCh }: { userId: string; channelId: string }) => {
      if (evtCh !== channelId) return
      setTypingUsers((prev) => prev.filter((n) => n !== userId))
    }

    const onError = (err: SocketError) => {
      setLastError(err)
      setMessages((prev) => {
        const idx = prev.findIndex((m) => 'pending' in m && m.pending && !('failed' in m && m.failed))
        if (idx === -1) return prev
        const updated = [...prev] as PendingMessage[]
        updated[idx] = { ...updated[idx], failed: true } as PendingMessage
        return updated
      })
    }

    if (socket.connected) onConnect()

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('channel:message:new', onMessage)
    socket.on('channel:message:deleted', onMessageDeleted)
    socket.on('channel:message:edited', onMessageEdited)
    socket.on('channel:message:pinned', onMessagePinned)
    socket.on('channel:message:react', onMessageReact)
    socket.on('channel:message:unreact', onMessageUnreact)
    socket.on('channel:typing:start', onTypingStart)
    socket.on('channel:typing:stop', onTypingStop)
    socket.on('error', onError)

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('channel:message:new', onMessage)
      socket.off('channel:message:deleted', onMessageDeleted)
      socket.off('channel:message:edited', onMessageEdited)
      socket.off('channel:message:pinned', onMessagePinned)
      socket.off('channel:message:react', onMessageReact)
      socket.off('channel:message:unreact', onMessageUnreact)
      socket.off('channel:typing:start', onTypingStart)
      socket.off('channel:typing:stop', onTypingStop)
      socket.off('error', onError)
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
      pendingTimers.current.forEach((t) => clearTimeout(t))
      pendingTimers.current.clear()
      socket.emit('leave:channel', channelId)
      releaseSocket()
    }
  }, [groupId, channelId, currentUser, confirmPending, qc])

  const sendMessage = useCallback((
    content: string,
    replyToId?: string | null,
    replyToPreview?: { id: string; content: string; user: { id: string; name: string } } | null,
  ) => {
    setLastError(null)
    if (currentUser) {
      const tempId = `optimistic-${Date.now()}-${Math.random()}`
      const optimistic: PendingMessage = {
        id: tempId,
        userId: currentUser.id,
        content,
        pinned: false,
        createdAt: new Date().toISOString(),
        user: { name: currentUser.name, avatarUrl: currentUser.avatarUrl ?? undefined },
        replyToId: replyToId ?? null,
        replyTo: replyToPreview ?? null,
        pending: true,
      }
      setMessages((prev) => [...prev, optimistic])
      const timer = setTimeout(() => {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, failed: true } as PendingMessage : m)),
        )
        pendingTimers.current.delete(tempId)
      }, OPTIMISTIC_TIMEOUT_MS)
      pendingTimers.current.set(tempId, timer)
    }
    socketRef.current?.emit('channel:message:send', { channelId, content, replyToId: replyToId ?? null })
  }, [channelId, currentUser])

  const stopTyping = useCallback(() => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current)
      typingTimeoutRef.current = null
    }
    socketRef.current?.emit('channel:typing:stop', channelId)
  }, [channelId])

  const sendTyping = useCallback(() => {
    socketRef.current?.emit('channel:typing:start', channelId)
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(stopTyping, 2000)
  }, [channelId, stopTyping])

  const clearError = useCallback(() => setLastError(null), [])
  const clearReconnected = useCallback(() => setReconnected(false), [])

  const retryMessage = useCallback((tempId: string) => {
    setMessages((prev) => {
      const msg = prev.find((m) => m.id === tempId)
      if (!msg) return prev
      socketRef.current?.emit('channel:message:send', { channelId, content: msg.content, replyToId: msg.replyToId ?? null })
      return prev.map((m) =>
        m.id === tempId ? { ...m, failed: false, pending: true } as PendingMessage : m,
      )
    })
  }, [channelId])

  return {
    messages,
    setMessages,
    typingUsers,
    connected,
    reconnected,
    clearReconnected,
    lastError,
    clearError,
    sendMessage,
    sendTyping,
    stopTyping,
    retryMessage,
  }
}
