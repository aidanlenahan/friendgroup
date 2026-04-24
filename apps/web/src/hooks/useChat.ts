import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { getToken } from '../lib/api'

const SOCKET_URL = import.meta.env.VITE_API_BASE_URL ?? ''

export interface ChatMessage {
  id: string
  userId: string
  content: string
  pinned: boolean
  createdAt: string
  user: { name: string; avatarUrl?: string }
}

export function useChat(eventId: string) {
  const socketRef = useRef<Socket | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      auth: { token: getToken() },
      transports: ['websocket'],
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      socket.emit('join:event', { eventId })
    })
    socket.on('disconnect', () => setConnected(false))
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
  }, [eventId])

  const sendMessage = (content: string) => {
    socketRef.current?.emit('message:send', { eventId, content })
  }

  const sendTyping = () => {
    socketRef.current?.emit('typing:start', { eventId })
  }

  return { messages, setMessages, typingUsers, connected, sendMessage, sendTyping }
}

export function useChannelChat(groupId: string, channelId: string) {
  const socketRef = useRef<Socket | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      auth: { token: getToken() },
      transports: ['websocket'],
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      socket.emit('join:channel', { channelId, groupId })
    })
    socket.on('disconnect', () => setConnected(false))
    socket.on('channel:message:new', (msg: ChatMessage) =>
      setMessages((prev) => [...prev, msg]),
    )
    socket.on('channel:typing:start', ({ name }: { userId: string; name: string; channelId: string }) => {
      setTypingUsers((prev) => (prev.includes(name) ? prev : [...prev, name]))
      setTimeout(() => setTypingUsers((prev) => prev.filter((n) => n !== name)), 3000)
    })

    return () => {
      socket.emit('leave:channel', channelId)
      socket.disconnect()
    }
  }, [groupId, channelId])

  const sendMessage = (content: string) => {
    socketRef.current?.emit('channel:message:send', { channelId, content })
  }

  const sendTyping = () => {
    socketRef.current?.emit('channel:typing:start', channelId)
  }

  return { messages, setMessages, typingUsers, connected, sendMessage, sendTyping }
}
