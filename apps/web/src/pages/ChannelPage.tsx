import { memo, useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import PageToolbar from '../components/PageToolbar'
import NotificationBell from '../components/NotificationBell'
import { useKeyboardVisible, createSwipeRevealHandlers } from '../hooks/useMobile'
import { useChannelMessages } from '../hooks/useMessages'
import type { ChannelMessage } from '../hooks/useMessages'
import { useChannelChat } from '../hooks/useChat'
import type { ChatMessage, PendingMessage } from '../hooks/useChat'
import {
  useGroupChannels, useCreateChannel, useGroupTags, useUpdateChannelTags,
  useRenameChannel, useDeleteChannel, useMarkChannelRead, useDeleteMessage,
  useEditMessage, usePinMessage, useToggleReaction,
  useChannelSubscribers, useAddChannelSubscriber, useRemoveChannelSubscriber,
} from '../hooks/useGroups'
import { useGroupMembers } from '../hooks/useGroups'
import { useAuthStore } from '../stores/authStore'
import { useToast } from '../hooks/useToast'
import Avatar from '../components/Avatar'
import Spinner from '../components/Spinner'
import { getApiErrorMessage } from '../lib/api'

const URL_PATTERN = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/gi

function renderContent(
  content: string,
  currentUserId: string,
  members: Array<{ userId: string; username?: string | null }>,
  tags: Array<{ name: string; color?: string | null }> = [],
) {
  // Split on @mentions and #tag-mentions, then linkify URLs within plain text segments
  const parts = content.split(/(@[a-zA-Z0-9_.-]+|#[a-zA-Z0-9_-]+)/g)
  return parts.flatMap((part, i) => {
    const mentionMatch = part.match(/^@([a-zA-Z0-9_.-]+)$/)
    if (mentionMatch) {
      const handle = mentionMatch[1].toLowerCase()
      const member = members.find((m) => m.username?.toLowerCase() === handle)
      if (!member) return [<span key={`m${i}`}>{part}</span>]
      const isMe = member.userId === currentUserId
      return [
        <Link
          key={`m${i}`}
          to={`/u/${member.username}`}
          className={`font-medium ${isMe ? 'text-indigo-300 bg-indigo-900/30 rounded px-0.5' : 'text-indigo-400'} hover:underline`}
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </Link>,
      ]
    }
    const tagMatch = part.match(/^#([a-zA-Z0-9_-]+)$/)
    if (tagMatch) {
      const tagName = tagMatch[1].toLowerCase()
      const tag = tags.find((t) => t.name.toLowerCase() === tagName)
      return [
        <span
          key={`t${i}`}
          className="inline-flex items-center gap-1 font-medium text-emerald-400 bg-emerald-900/20 rounded px-0.5"
        >
          {tag?.color && <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: tag.color }} />}
          {part}
        </span>,
      ]
    }
    // Linkify URLs inside plain text
    const urlParts = part.split(URL_PATTERN)
    return urlParts.map((sub, j) =>
      /^https?:\/\//i.test(sub) ? (
        <a
          key={`${i}-${j}`}
          href={sub}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-400 underline hover:text-indigo-300 break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {sub}
        </a>
      ) : (
        <span key={`${i}-${j}`}>{sub}</span>
      )
    )
  })
}

const MessageContent = memo(function MessageContent({
  content,
  currentUserId,
  members,
  groupTags,
  className,
}: {
  content: string
  currentUserId: string
  members: Array<{ userId: string; username?: string | null }>
  groupTags: Array<{ name: string; color?: string | null }>
  className?: string
}) {
  return <p className={className}>{renderContent(content, currentUserId, members, groupTags)}</p>
})

function formatTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const isToday =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  if (isToday) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const GROUP_THRESHOLD_MS = 5 * 60 * 1000
const COMMON_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👀']

// Groups reactions by emoji and returns sorted array of [emoji, count, didReact]
function groupReactions(reactions: Array<{ userId: string; emoji: string }> | undefined, currentUserId: string | undefined) {
  if (!reactions || reactions.length === 0) return []
  const map = new Map<string, { count: number; mine: boolean }>()
  for (const r of reactions) {
    const entry = map.get(r.emoji) ?? { count: 0, mine: false }
    entry.count++
    if (r.userId === currentUserId) entry.mine = true
    map.set(r.emoji, entry)
  }
  return Array.from(map.entries()).map(([emoji, { count, mine }]) => ({ emoji, count, mine }))
}

// Reusable channel list — rendered in both the desktop sidebar and mobile drawer
function ChannelList({
  channels,
  groupId,
  channelId,
  isAdminOrOwner,
  renamingChannelId,
  renameValue,
  setRenameValue,
  onRenameSubmit,
  onRenameCancel,
  onStartRename,
  onDeleteRequest,
  onTagsClick,
  onManageSubscribers,
  onChannelClick,
}: {
  channels: ReturnType<typeof useGroupChannels>['data'] extends { channels: infer C } | undefined ? C : never
  groupId: string
  channelId: string | undefined
  isAdminOrOwner: boolean
  renamingChannelId: string | null
  renameValue: string
  setRenameValue: (v: string) => void
  onRenameSubmit: (id: string) => void
  onRenameCancel: () => void
  onStartRename: (id: string, name: string) => void
  onDeleteRequest: (id: string) => void
  onTagsClick: (id: string, tagIds: string[]) => void
  onManageSubscribers: (id: string) => void
  onChannelClick?: () => void
}) {
  return (
    <>
      {channels?.map((ch) => (
        <div key={ch.id} className="group/ch relative mx-1">
          {renamingChannelId === ch.id ? (
            <form
              onSubmit={(e) => { e.preventDefault(); onRenameSubmit(ch.id) }}
              className="flex items-center gap-1 px-2 py-1"
            >
              <span className="text-gray-500 text-sm">#</span>
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value.toLowerCase().replace(/\s/g, '-'))}
                onBlur={() => onRenameSubmit(ch.id)}
                onKeyDown={(e) => e.key === 'Escape' && onRenameCancel()}
                maxLength={32}
                autoFocus
                className="flex-1 bg-gray-800 border border-indigo-500 rounded px-1.5 py-0.5 text-sm text-white focus:outline-none w-0 min-w-0"
              />
            </form>
          ) : (
            <Link
              to={`/groups/${groupId}/channels/${ch.id}`}
              onClick={onChannelClick}
              className={`px-3 py-2 text-sm rounded-lg flex items-center gap-1 transition-colors ${
                ch.id === channelId
                  ? 'bg-indigo-900 text-white font-medium'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              <span className="text-gray-500">#</span>
              <span className="truncate flex-1">{ch.name}</span>
              {ch.isGeneral && ch.id !== channelId && (
                <span className="text-xs text-gray-600 ml-auto">★</span>
              )}
              {(ch.unreadCount ?? 0) > 0 && ch.id !== channelId && (
                <span className="ml-auto bg-indigo-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                  {ch.unreadCount! > 99 ? '99+' : ch.unreadCount}
                </span>
              )}
            </Link>
          )}
          {/* Tag dots */}
          {ch.tags && ch.tags.length > 0 && (
            <div className="flex gap-0.5 px-3 pb-1 -mt-0.5 flex-wrap">
              {ch.tags.map((t) => (
                <span
                  key={t.id}
                  title={t.name}
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: t.color ?? '#6366f1' }}
                />
              ))}
            </div>
          )}
          {/* Admin hover actions */}
          {isAdminOrOwner && renamingChannelId !== ch.id && (
            <div className="absolute right-1 top-1.5 hidden group-hover/ch:flex items-center gap-0.5">
              <button
                onClick={() => onTagsClick(ch.id, ch.tags?.map((t) => t.id) ?? [])}
                className="flex items-center justify-center w-5 h-5 rounded text-gray-500 hover:text-indigo-300 hover:bg-gray-700 transition-colors"
                title="Set channel tags"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M3 11l10 10a4 4 0 005.657 0l4.343-4.343A4 4 0 0023 13.657L13 3.657A4 4 0 0010.343 3L6 3H3v3l.343.343z" />
                </svg>
              </button>
              {ch.isInviteOnly && (
                <button
                  onClick={() => onManageSubscribers(ch.id)}
                  className="flex items-center justify-center w-5 h-5 rounded text-gray-500 hover:text-indigo-300 hover:bg-gray-700 transition-colors"
                  title="Manage members"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => onStartRename(ch.id, ch.name)}
                className="flex items-center justify-center w-5 h-5 rounded text-gray-500 hover:text-indigo-300 hover:bg-gray-700 transition-colors"
                title="Rename channel"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              {!ch.isGeneral && (
                <button
                  onClick={() => onDeleteRequest(ch.id)}
                  className="flex items-center justify-center w-5 h-5 rounded text-gray-500 hover:text-red-400 hover:bg-gray-700 transition-colors"
                  title="Delete channel"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </>
  )
}

export default function ChannelPage() {
  const { groupId, channelId } = useParams<{ groupId: string; channelId: string }>()
  const currentUser = useAuthStore((s) => s.user)
  const toast = useToast()

  const { data: channelsData } = useGroupChannels(groupId!)
  const channel = channelsData?.channels.find((c) => c.id === channelId)

  useEffect(() => {
    if (!channel?.name) return
    document.title = `#${channel.name} — GEM`
    return () => { document.title = 'GEM — Group Event Manager' }
  }, [channel?.name])

  const { data: membersData } = useGroupMembers(groupId!)
  const myMembership = membersData?.members.find((m) => m.userId === currentUser?.id)
  const isAdminOrOwner = myMembership?.role === 'owner' || myMembership?.role === 'admin'

  const { data: groupTagsData } = useGroupTags(groupId!)
  const groupTags = groupTagsData?.tags ?? []

  const { data: messagesData, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useChannelMessages(groupId!, channelId!)

  const {
    messages: liveMessages,
    typingUsers,
    connected,
    lastError,
    clearError,
    sendMessage,
    sendTyping,
    stopTyping,
    retryMessage,
  } = useChannelChat(groupId!, channelId!, currentUser ?? undefined)

  const [input, setInput] = useState('')
  const [replyingTo, setReplyingTo] = useState<MergedMessage | null>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStart, setMentionStart] = useState(-1)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [tagQuery, setTagQuery] = useState<string | null>(null)
  const [tagStart, setTagStart] = useState(-1)
  const [tagIndex, setTagIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [newChannelInviteOnly, setNewChannelInviteOnly] = useState(false)
  const [showTagModal, setShowTagModal] = useState(false)
  const [tagModalChannelId, setTagModalChannelId] = useState<string | null>(null)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [renamingChannelId, setRenamingChannelId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteChannelId, setConfirmDeleteChannelId] = useState<string | null>(null)
  const [showMobileDrawer, setShowMobileDrawer] = useState(false)
  const [showPinnedModal, setShowPinnedModal] = useState(false)

  // Edit state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  // Reaction picker state — keyed by message id
  const [reactionPickerForId, setReactionPickerForId] = useState<string | null>(null)

  // Subscriber management modal
  const [manageSubscribersChannelId, setManageSubscribersChannelId] = useState<string | null>(null)

  // Message delete confirmation
  const [confirmDeleteMessageId, setConfirmDeleteMessageId] = useState<string | null>(null)

  // Mobile: long-press action sheet
  const [actionSheetMessageId, setActionSheetMessageId] = useState<string | null>(null)

  // Mobile: keyboard detection for compact header
  const keyboardVisible = useKeyboardVisible()

  const headerRef = useRef<HTMLElement>(null)
  const composerRef = useRef<HTMLFormElement>(null)
  const [headerHeight, setHeaderHeight] = useState(56)
  const [composerHeight, setComposerHeight] = useState(72)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)

  const createChannel = useCreateChannel(groupId!)
  const updateChannelTags = useUpdateChannelTags(groupId!)
  const renameChannel = useRenameChannel(groupId!)
  const deleteChannel = useDeleteChannel(groupId!)
  const markRead = useMarkChannelRead(groupId!)
  const deleteMessage = useDeleteMessage(groupId!, channelId!)
  const editMessage = useEditMessage(groupId!, channelId!)
  const pinMessage = usePinMessage(groupId!, channelId!)
  const toggleReaction = useToggleReaction(groupId!, channelId!)

  useEffect(() => {
    const els = [
      { ref: headerRef, set: setHeaderHeight },
      { ref: composerRef, set: setComposerHeight },
    ] as const
    const observers = els.map(({ ref, set }) => {
      const ro = new ResizeObserver(() => {
        if (ref.current) set(ref.current.offsetHeight)
      })
      if (ref.current) ro.observe(ref.current)
      return ro
    })
    return () => observers.forEach((ro) => ro.disconnect())
  }, [])

  // Prevent iOS visual-viewport panning downward (finger up = content up = blank revealed below).
  // Downward swipes (finger down = content down = restoring viewport position) are always
  // allowed so the user can scroll back to the correct view after iOS auto-scrolls on focus.
  // Only upward swipes on non-scrollable surfaces are blocked.
  useEffect(() => {
    let startY = 0
    const onStart = (e: TouchEvent) => { startY = e.touches[0].clientY }
    const prevent = (e: TouchEvent) => {
      if (e.touches[0].clientY > startY) return  // finger moving down — always allow
      let el = e.target as Element | null
      while (el && el !== document.documentElement) {
        const { overflowY } = window.getComputedStyle(el)
        if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
          return  // inside a real scroll container — let it scroll
        }
        el = el.parentElement
      }
      e.preventDefault()
    }
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', prevent, { passive: false })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', prevent)
    }
  }, [])

  // Mark channel as read whenever the active channel changes
  useEffect(() => {
    if (!channelId) return
    markRead.mutate(channelId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId])


  // Merge REST messages with live socket messages
  const restMessages: ChannelMessage[] =
    messagesData?.pages.flatMap((p) => p.messages) ?? []

  type MergedMessage = ChannelMessage & { pending?: boolean; failed?: boolean; deleted?: boolean }

  const socketMessages: MergedMessage[] = liveMessages.map((m: ChatMessage | PendingMessage) => ({
    id: m.id,
    content: m.content,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    userId: m.userId,
    pinned: m.pinned,
    deleted: m.deleted,
    reactions: m.reactions,
    user: m.user
      ? { id: m.userId, name: m.user.name, email: '', avatarUrl: m.user.avatarUrl }
      : undefined,
    pending: 'pending' in m ? m.pending : undefined,
    failed: 'failed' in m ? m.failed : undefined,
  }))

  const allMessages: MergedMessage[] = [
    ...restMessages,
    ...socketMessages.filter((sm) => !restMessages.some((rm) => rm.id === sm.id)),
  ]

  const actionSheetMessage = actionSheetMessageId
    ? allMessages.find((m) => m.id === actionSheetMessageId) ?? null
    : null

  const pinnedMessages = allMessages.filter((m) => m.pinned && !m.pending)

  // Socket error toast
  useEffect(() => {
    if (!lastError) return
    toast.error(lastError.message)
    clearError()
  }, [lastError, clearError, toast])


  // Smart auto-scroll: only scroll when already near bottom
  useEffect(() => {
    if (isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    } else {
      setShowScrollBtn(true)
    }
  }, [allMessages.length])

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100
    isAtBottomRef.current = atBottom
    if (atBottom) setShowScrollBtn(false)
  }, [])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    setShowScrollBtn(false)
  }

  const members = membersData?.members ?? []

  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return []
    return members
      .filter((m) => m.status === 'active' && m.username)
      .filter((m) => mentionQuery === '' || m.username!.toLowerCase().startsWith(mentionQuery.toLowerCase()))
      .slice(0, 8)
  }, [mentionQuery, members])

  const applyMention = useCallback((username: string) => {
    const before = input.slice(0, mentionStart)
    const after = input.slice(mentionStart + 1 + (mentionQuery?.length ?? 0))
    setInput(`${before}@${username} ${after}`)
    setMentionQuery(null)
    setMentionIndex(0)
    textareaRef.current?.focus()
  }, [input, mentionStart, mentionQuery])

  const tagCandidates = useMemo(() => {
    if (tagQuery === null) return []
    return groupTags
      .filter((t) => tagQuery === '' || t.name.toLowerCase().startsWith(tagQuery.toLowerCase()))
      .slice(0, 8)
  }, [tagQuery, groupTags])

  const applyTagMention = useCallback((tagName: string) => {
    const before = input.slice(0, tagStart)
    const after = input.slice(tagStart + 1 + (tagQuery?.length ?? 0))
    setInput(`${before}#${tagName} ${after}`)
    setTagQuery(null)
    setTagIndex(0)
    textareaRef.current?.focus()
  }, [input, tagStart, tagQuery])

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || !connected) return
    sendMessage(
      trimmed,
      replyingTo?.id ?? null,
      replyingTo ? { id: replyingTo.id, content: replyingTo.content, user: { id: replyingTo.userId, name: replyingTo.user?.name ?? 'Unknown' } } : null,
    )
    setInput('')
    setReplyingTo(null)
    setMentionQuery(null)
    setTagQuery(null)
    stopTyping()
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInput(val)
    if (val) sendTyping()
    const cursor = e.target.selectionStart ?? val.length
    const before = val.slice(0, cursor)
    const atMatch = before.match(/@([a-zA-Z0-9_.-]*)$/)
    const hashMatch = before.match(/#([a-zA-Z0-9_-]*)$/)
    if (atMatch) {
      setMentionQuery(atMatch[1])
      setMentionStart(before.lastIndexOf('@'))
      setMentionIndex(0)
      setTagQuery(null)
    } else if (hashMatch) {
      setTagQuery(hashMatch[1])
      setTagStart(before.lastIndexOf('#'))
      setTagIndex(0)
      setMentionQuery(null)
    } else {
      setMentionQuery(null)
      setTagQuery(null)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex((i) => Math.min(i + 1, mentionCandidates.length - 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionIndex((i) => Math.max(i - 1, 0)); return }
      if (e.key === 'Escape')    { e.preventDefault(); setMentionQuery(null); return }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        applyMention(mentionCandidates[mentionIndex].username!)
        return
      }
    }
    if (tagCandidates.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setTagIndex((i) => Math.min(i + 1, tagCandidates.length - 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setTagIndex((i) => Math.max(i - 1, 0)); return }
      if (e.key === 'Escape')    { e.preventDefault(); setTagQuery(null); return }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        applyTagMention(tagCandidates[tagIndex].name)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend(e as unknown as React.FormEvent)
    }
  }

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newChannelName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    if (!name) return
    try {
      await createChannel.mutateAsync({ name, isInviteOnly: newChannelInviteOnly })
      toast.success(`#${name} created`)
      setShowCreateModal(false)
      setNewChannelName('')
      setNewChannelInviteOnly(false)
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to create channel'))
    }
  }

  const openTagModal = (chId: string, currentTagIds: string[]) => {
    setTagModalChannelId(chId)
    setSelectedTagIds(currentTagIds)
    setShowTagModal(true)
  }

  const handleRenameSubmit = async (id: string) => {
    const name = renameValue.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    if (!name) { setRenamingChannelId(null); return }
    try {
      await renameChannel.mutateAsync({ channelId: id, name })
      toast.success(`Renamed to #${name}`)
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to rename channel'))
    } finally {
      setRenamingChannelId(null)
    }
  }

  const handleDeleteChannel = async (id: string) => {
    try {
      await deleteChannel.mutateAsync(id)
      toast.success('Channel deleted')
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to delete channel'))
    } finally {
      setConfirmDeleteChannelId(null)
    }
  }

  const handleSaveChannelTags = async () => {
    if (!tagModalChannelId) return
    try {
      await updateChannelTags.mutateAsync({ channelId: tagModalChannelId, tagIds: selectedTagIds })
      toast.success('Channel tags updated')
      setShowTagModal(false)
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to update tags'))
    }
  }

  const handleDeleteMessage = async (messageId: string) => {
    try {
      await deleteMessage.mutateAsync(messageId)
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to delete message'))
    }
  }

  const startEdit = (msg: MergedMessage) => {
    setEditingMessageId(msg.id)
    setEditValue(msg.content)
    setReactionPickerForId(null)
  }

  const cancelEdit = () => {
    setEditingMessageId(null)
    setEditValue('')
  }

  const submitEdit = async (messageId: string) => {
    const trimmed = editValue.trim()
    if (!trimmed) { cancelEdit(); return }
    try {
      await editMessage.mutateAsync({ messageId, content: trimmed })
      cancelEdit()
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to edit message'))
    }
  }

  const handlePin = async (messageId: string) => {
    try {
      await pinMessage.mutateAsync(messageId)
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to pin message'))
    }
  }

  const handleReact = async (messageId: string, emoji: string) => {
    setReactionPickerForId(null)
    try {
      await toggleReaction.mutateAsync({ messageId, emoji })
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to react'))
    }
  }

  const [showChannelSettingsModal, setShowChannelSettingsModal] = useState(false)
  const [settingsRenameValue, setSettingsRenameValue] = useState('')

  const channelListProps = {
    channels: [...(channelsData?.channels ?? [])].sort((a, b) => (b.isGeneral ? 1 : 0) - (a.isGeneral ? 1 : 0)),
    groupId: groupId!,
    channelId,
    isAdminOrOwner,
    renamingChannelId,
    renameValue,
    setRenameValue,
    onRenameSubmit: handleRenameSubmit,
    onRenameCancel: () => setRenamingChannelId(null),
    onStartRename: (id: string, name: string) => { setRenamingChannelId(id); setRenameValue(name) },
    onDeleteRequest: setConfirmDeleteChannelId,
    onTagsClick: openTagModal,
    onManageSubscribers: setManageSubscribersChannelId,
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-52 flex-shrink-0 bg-gray-900 border-r border-gray-800 overflow-y-auto">
        <div className="flex items-center justify-between px-3 pt-4 pb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Channels</span>
          {isAdminOrOwner && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="text-gray-400 hover:text-white text-lg leading-none"
              title="New channel"
            >
              +
            </button>
          )}
        </div>
        <ChannelList {...channelListProps} />
        <div className="mt-auto p-3">
          <Link
            to={`/groups/${groupId}`}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            ← Back to group
          </Link>
        </div>
      </aside>

      {/* Mobile drawer overlay */}
      {showMobileDrawer && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/60"
          onClick={() => setShowMobileDrawer(false)}
        />
      )}
      <aside
        className={`md:hidden fixed inset-y-0 left-0 z-50 flex flex-col w-64 bg-gray-900 border-r border-gray-800 overflow-y-auto transition-transform duration-200 ${
          showMobileDrawer ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-3 pt-4 pb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Channels</span>
          <div className="flex items-center gap-2">
            {isAdminOrOwner && (
              <button
                onClick={() => { setShowCreateModal(true); setShowMobileDrawer(false) }}
                className="text-gray-400 hover:text-white text-lg leading-none"
                title="New channel"
              >
                +
              </button>
            )}
            <button
              onClick={() => setShowMobileDrawer(false)}
              className="text-gray-500 hover:text-white p-1"
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <ChannelList {...channelListProps} onChannelClick={() => setShowMobileDrawer(false)} />
        <div className="mt-auto p-3">
          <Link
            to={`/groups/${groupId}`}
            onClick={() => setShowMobileDrawer(false)}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            ← Back to group
          </Link>
        </div>
      </aside>

      {/* Main chat area — absolute layout so header/composer are never in the flex chain
          that iOS resizes when the keyboard appears */}
      <div className="relative flex-1 min-w-0 min-h-0 overflow-hidden bg-gray-950">
        {/* Header — pinned to container top, never participates in keyboard resize */}
        <header
          ref={headerRef}
          className={`absolute top-0 inset-x-0 z-20 flex items-center gap-3 border-b border-gray-800 bg-gray-950 transition-[padding] duration-150 touch-none
            ${keyboardVisible ? 'px-3 py-1' : 'px-4 py-3'}`}
        >
          <button
            onClick={() => setShowMobileDrawer(true)}
            className="md:hidden p-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            aria-label="Open channels"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-gray-400 text-lg">#</span>
          {isAdminOrOwner ? (
            <button
              onClick={() => { setSettingsRenameValue(channel?.name ?? ''); setShowChannelSettingsModal(true) }}
              className="font-semibold text-white truncate hover:text-gray-300 transition-colors"
              title="Channel settings"
            >
              {channel?.name ?? 'Channel'}
            </button>
          ) : (
            <h1 className="font-semibold text-white truncate">
              {channel?.name ?? 'Channel'}
            </h1>
          )}
          {channel?.isInviteOnly && (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-gray-500 shrink-0" aria-label="Invite-only channel">
                <title>Invite-only channel</title>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              {channel.isSubscribed && (
                <button
                  onClick={() => setManageSubscribersChannelId(channelId!)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                  title="View members"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>{channel.subscriberCount}</span>
                </button>
              )}
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            {pinnedMessages.length > 0 && (
              <button
                onClick={() => setShowPinnedModal(true)}
                className="flex items-center gap-1 p-1 rounded-lg text-amber-500 hover:text-amber-300 hover:bg-gray-800 transition-colors"
                title={`${pinnedMessages.length} pinned message${pinnedMessages.length > 1 ? 's' : ''}`}
              >
                <span className="text-base leading-none">📌</span>
                <span className="text-xs font-medium tabular-nums">{pinnedMessages.length}</span>
              </button>
            )}
            <span
              className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-gray-600'}`}
              title={connected ? 'Live' : 'Connecting…'}
            />
            <span className="md:hidden"><NotificationBell /></span>
            <PageToolbar />
          </div>
        </header>

        {/* Messages scroll container — bounded by measured header/composer heights */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="absolute inset-x-0 overflow-y-auto [overflow-anchor:none]"
          style={{ top: headerHeight, bottom: composerHeight }}
          onClick={() => setReactionPickerForId(null)}
        >
        <div className="px-4 pt-3 pb-4 space-y-1 relative">
          {hasNextPage && (
            <div className="flex justify-center mb-2">
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
              >
                {isFetchingNextPage ? 'Loading…' : 'Load older messages'}
              </button>
            </div>
          )}
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner className="text-indigo-400" />
            </div>
          ) : allMessages.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-gray-500 text-sm gap-2">
              <span className="text-3xl">#</span>
              <p>This is the beginning of <strong className="text-gray-300">#{channel?.name ?? 'this channel'}</strong>.</p>
              <p>No messages yet.</p>
            </div>
          ) : (
            allMessages.map((msg, i) => {
              const prev = allMessages[i - 1]
              const isGrouped =
                !!prev &&
                prev.userId === msg.userId &&
                new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_THRESHOLD_MS

              const isOwn = msg.userId === currentUser?.id
              const msgUsername = members.find((m) => m.userId === msg.userId)?.username ?? null
              const canDelete = !msg.pending && !msg.deleted && isOwn
              const canEdit = !msg.pending && !msg.deleted && isOwn
              const canPin = !msg.pending && !msg.deleted && isAdminOrOwner
              const isEditing = editingMessageId === msg.id
              const wasEdited = !!msg.updatedAt && Math.abs(new Date(msg.updatedAt).getTime() - new Date(msg.createdAt).getTime()) > 5000

              const reactionGroups = groupReactions(msg.reactions, currentUser?.id)

              const statusIndicator = msg.failed ? (
                <div className={`flex items-center gap-1 text-xs mt-0.5 ${isOwn ? 'justify-end text-red-300' : 'text-red-400'}`}>
                  Failed to send
                  <button onClick={() => retryMessage(msg.id)} className="underline hover:opacity-80">
                    Retry
                  </button>
                </div>
              ) : msg.pending ? (
                <p className={`text-xs mt-0.5 ${isOwn ? 'text-right text-indigo-200/60' : 'text-gray-500'}`}>Sending…</p>
              ) : null

              const hoverActions = !msg.pending && (
                <div className="absolute bottom-full right-0 mb-0.5 hidden group-hover/msg:flex items-center gap-0.5 bg-gray-900 border border-gray-700 rounded-lg p-0.5 shadow-lg z-10">
                  {/* Reply */}
                  {!msg.deleted && (
                    <button
                      onClick={() => setReplyingTo(msg)}
                      className="p-1 rounded text-gray-500 hover:text-indigo-400 hover:bg-gray-800 transition-colors"
                      title="Reply"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <polyline points="9 17 4 12 9 7" />
                        <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                      </svg>
                    </button>
                  )}
                  <div className="relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); setReactionPickerForId(reactionPickerForId === msg.id ? null : msg.id) }}
                      disabled={toggleReaction.isPending}
                      className="p-1 rounded text-gray-500 hover:text-yellow-400 hover:bg-gray-800 transition-colors disabled:opacity-50"
                      title="React"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <circle cx="12" cy="12" r="10" />
                        <path strokeLinecap="round" d="M8 13s1.5 2 4 2 4-2 4-2" />
                        <line x1="9" y1="9" x2="9.01" y2="9" strokeWidth={3} strokeLinecap="round" />
                        <line x1="15" y1="9" x2="15.01" y2="9" strokeWidth={3} strokeLinecap="round" />
                      </svg>
                    </button>
                    {reactionPickerForId === msg.id && (
                      <div
                        className="absolute bottom-full right-0 mb-1 bg-gray-800 border border-gray-700 rounded-xl p-2 flex gap-1 shadow-xl z-20"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {COMMON_EMOJIS.map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => void handleReact(msg.id, emoji)}
                            className="text-lg hover:scale-125 transition-transform leading-none"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => startEdit(msg)}
                      className="p-1 rounded text-gray-500 hover:text-indigo-400 hover:bg-gray-800 transition-colors"
                      title="Edit message"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  )}
                  {canPin && (
                    <button
                      onClick={() => void handlePin(msg.id)}
                      disabled={pinMessage.isPending}
                      className={`p-1 rounded transition-colors hover:bg-gray-800 disabled:opacity-50 ${msg.pinned ? 'text-amber-400 hover:text-amber-300' : 'text-gray-500 hover:text-amber-400'}`}
                      title={msg.pinned ? 'Unpin message' : 'Pin message'}
                    >
                      📌
                    </button>
                  )}
                  {canDelete && (
                    confirmDeleteMessageId === msg.id
                      ? <>
                          <button
                            onClick={() => { void handleDeleteMessage(msg.id); setConfirmDeleteMessageId(null) }}
                            className="px-1.5 py-0.5 rounded text-xs font-medium text-red-300 bg-red-900/60 hover:bg-red-800 transition-colors"
                          >
                            Confirm?
                          </button>
                          <button
                            onClick={() => setConfirmDeleteMessageId(null)}
                            className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors text-xs"
                            title="Cancel"
                          >✕</button>
                        </>
                      : <button
                          onClick={() => setConfirmDeleteMessageId(msg.id)}
                          disabled={deleteMessage.isPending}
                          className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-gray-800 transition-colors disabled:opacity-50"
                          title="Delete message"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                  )}
                </div>
              )

              const messageBody = msg.deleted ? (
                <p className={`text-sm italic ${isOwn ? 'text-indigo-200/60' : 'text-gray-500'}`}>This message was deleted.</p>
              ) : isEditing ? (
                <div className="mt-0.5">
                  <textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submitEdit(msg.id) }
                      if (e.key === 'Escape') cancelEdit()
                    }}
                    autoFocus
                    rows={2}
                    maxLength={2000}
                    className="w-full bg-gray-800 border border-indigo-500 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none"
                  />
                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={() => void submitEdit(msg.id)}
                      disabled={editMessage.isPending}
                      className="text-xs px-2 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg"
                    >
                      Save
                    </button>
                    <button onClick={cancelEdit} className="text-xs px-2 py-1 text-gray-400 hover:text-white">
                      Cancel
                    </button>
                    <span className="text-xs text-gray-600 self-center">Enter to save · Esc to cancel</span>
                  </div>
                </div>
              ) : (
                <>
                  <MessageContent content={msg.content} currentUserId={currentUser?.id ?? ''} members={members} groupTags={groupTags} className={`text-[15px] break-words whitespace-pre-wrap ${isOwn ? 'text-white' : 'text-gray-100'}`} />
                  {wasEdited && <span className={`text-[10px] ${isOwn ? 'text-indigo-200/60' : 'text-gray-600'}`}>(edited)</span>}
                  {statusIndicator}
                </>
              )

              const reactionsBar = reactionGroups.length > 0 && !isEditing && (
                <div className={`flex flex-wrap gap-1 mt-1 ${isOwn ? 'justify-end' : ''}`}>
                  {reactionGroups.map(({ emoji, count, mine }) => (
                    <button
                      key={emoji}
                      onClick={() => void handleReact(msg.id, emoji)}
                      className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full border transition-colors ${
                        mine
                          ? 'bg-indigo-900/50 border-indigo-600 text-indigo-300'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
                      }`}
                    >
                      <span>{emoji}</span>
                      <span>{count}</span>
                    </button>
                  ))}
                </div>
              )

              const swipeHandlers = createSwipeRevealHandlers(
                () => { if (!msg.pending && !msg.deleted) setActionSheetMessageId(msg.id) },
              )

              return (
                <div
                  key={msg.id}
                  className={`flex items-end gap-2 ${isGrouped ? '' : 'mt-3'} ${isOwn ? 'justify-end' : ''} ${msg.pinned ? 'bg-amber-950/20 rounded-lg px-1' : ''}`}
                >
                  {/* Left avatar / spacer (others only) */}
                  {!isOwn && (
                    isGrouped
                      ? <div className="w-8 flex-shrink-0" />
                      : msgUsername
                        ? <Link to={`/u/${msgUsername}`} className="flex-shrink-0" onClick={(e) => e.stopPropagation()}><Avatar name={msg.user?.name ?? 'Unknown'} avatarUrl={msg.user?.avatarUrl ?? undefined} size="sm" /></Link>
                        : <Avatar name={msg.user?.name ?? 'Unknown'} avatarUrl={msg.user?.avatarUrl ?? undefined} size="sm" />
                  )}

                  {/* Content column */}
                  <div className={`relative group/msg min-w-0 ${isEditing ? 'flex-1' : 'max-w-[75%]'}`}>
                    {!isGrouped && (
                      <div className={`flex items-baseline gap-2 mb-0.5 ${isOwn ? 'flex-row-reverse' : ''}`}>
                        {!isOwn && <span className="text-sm font-semibold text-white">{msg.user?.name ?? 'Unknown'}</span>}
                        <span className="text-xs text-gray-500">{formatTime(msg.createdAt)}</span>
                        {msg.pinned && <span className="text-xs text-amber-500" title="Pinned">📌</span>}
                      </div>
                    )}

                    {isEditing ? (
                      <div>{messageBody}</div>
                    ) : (
                      <div
                        {...swipeHandlers}
                        className={`touch-pan-y relative ${msg.pending ? 'opacity-60' : ''} ${
                          isOwn
                            ? 'bg-indigo-600 rounded-2xl rounded-br-sm px-3 py-2'
                            : 'bg-gray-800 rounded-2xl rounded-bl-sm px-3 py-2'
                        }`}
                      >
                        {hoverActions}
                        {msg.replyTo && (
                          <div className={`mb-1.5 pl-2 border-l-2 rounded text-xs ${isOwn ? 'border-indigo-300/60 bg-indigo-700/30' : 'border-indigo-500/60 bg-gray-700/50'} py-1 pr-1`}>
                            <p className={`font-semibold ${isOwn ? 'text-indigo-200' : 'text-indigo-400'}`}>{msg.replyTo.user.name}</p>
                            <p className={`truncate ${isOwn ? 'text-indigo-100/70' : 'text-gray-400'}`}>{msg.replyTo.content.slice(0, 100)}</p>
                          </div>
                        )}
                        {messageBody}
                      </div>
                    )}

                    {reactionsBar}
                  </div>

                  {/* Right avatar / spacer (own only) */}
                  {isOwn && (
                    isGrouped
                      ? <div className="w-8 flex-shrink-0" />
                      : currentUser?.username
                        ? <Link to={`/u/${currentUser.username}`} className="flex-shrink-0" onClick={(e) => e.stopPropagation()}><Avatar name={msg.user?.name ?? 'Unknown'} avatarUrl={msg.user?.avatarUrl ?? undefined} size="sm" /></Link>
                        : <Avatar name={msg.user?.name ?? 'Unknown'} avatarUrl={msg.user?.avatarUrl ?? undefined} size="sm" />
                  )}
                </div>
              )
            })
          )}
          {typingUsers.length > 0 && (
            <p className="text-xs text-gray-500 italic pt-1">
              {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing…
            </p>
          )}
          <div ref={messagesEndRef} />
        </div>{/* end messages content */}
        </div>{/* end scroll container */}

        {/* Scroll-to-bottom button */}
        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            className="absolute right-6 bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1.5 rounded-full shadow-lg transition-colors flex items-center gap-1 z-10"
            style={{ bottom: composerHeight + 12 }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            New messages
          </button>
        )}

        {/* Input — pinned to container bottom, never participates in keyboard resize */}
        <form
          ref={composerRef}
          onSubmit={handleSend}
          className="absolute bottom-0 inset-x-0 z-20 border-t border-gray-800 bg-gray-950 touch-none"
        >
          {replyingTo && (
            <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 bg-gray-900/60">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-indigo-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" />
              </svg>
              <span className="text-xs text-indigo-400 shrink-0">Replying to <strong>{replyingTo.user?.name ?? 'Unknown'}</strong></span>
              <span className="flex-1 truncate text-xs text-gray-500">{replyingTo.content.slice(0, 80)}</span>
              <button type="button" onClick={() => setReplyingTo(null)} className="text-gray-500 hover:text-white shrink-0 text-lg leading-none" aria-label="Cancel reply">×</button>
            </div>
          )}
          <div className="px-4 pb-4 pt-2">
          <div className="relative flex items-end gap-2">
            {mentionCandidates.length > 0 && (
              <div className="absolute bottom-full left-0 right-10 mb-1 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden z-50">
                {mentionCandidates.map((m, i) => (
                  <button
                    key={m.userId}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); applyMention(m.username!) }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                      i === mentionIndex ? 'bg-gray-700' : 'hover:bg-gray-700/50'
                    }`}
                  >
                    <Avatar name={m.name} avatarUrl={m.avatarUrl ?? undefined} size="sm" />
                    <span className="text-white font-medium">@{m.username}</span>
                    <span className="text-gray-400 text-xs">{m.name}</span>
                  </button>
                ))}
              </div>
            )}
            {tagCandidates.length > 0 && (
              <div className="absolute bottom-full left-0 right-10 mb-1 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden z-50">
                {tagCandidates.map((t, i) => (
                  <button
                    key={t.id}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); applyTagMention(t.name) }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                      i === tagIndex ? 'bg-gray-700' : 'hover:bg-gray-700/50'
                    }`}
                  >
                    {t.color && (
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                    )}
                    <span className="text-emerald-400 font-medium">#{t.name}</span>
                    <span className="text-gray-500 text-xs">notify tag subscribers</span>
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onBlur={stopTyping}
              placeholder={connected ? `Message #${channel?.name ?? 'channel'}` : 'Connecting…'}
              disabled={!connected}
              rows={1}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 text-base md:text-sm touch-pan-y"
              style={{ maxHeight: '8rem', overflowY: 'auto' }}
            />
            <button
              type="submit"
              disabled={!input.trim() || !connected}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-3 rounded-xl text-sm font-medium transition-colors flex-shrink-0"
            >
              Send
            </button>
          </div>
          <p className="text-xs text-gray-600 mt-1">Enter to send · Shift+Enter for new line</p>
          </div>
        </form>
      </div>

      {/* Create Channel Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 border border-gray-700 space-y-4">
            <h2 className="text-lg font-bold text-white">Create Channel</h2>
            <form onSubmit={handleCreateChannel} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Channel name</label>
                <div className="flex items-center bg-gray-800 border border-gray-700 rounded-xl px-3 py-2">
                  <span className="text-gray-500 mr-1">#</span>
                  <input
                    value={newChannelName}
                    onChange={(e) => setNewChannelName(e.target.value.toLowerCase().replace(/\s/g, '-'))}
                    placeholder="e.g. general, announcements"
                    maxLength={32}
                    className="flex-1 bg-transparent text-white placeholder-gray-500 focus:outline-none text-sm"
                    autoFocus
                  />
                </div>
              </div>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newChannelInviteOnly}
                  onChange={(e) => setNewChannelInviteOnly(e.target.checked)}
                  className="w-4 h-4 rounded accent-indigo-500"
                />
                <span className="text-sm text-gray-300">Invite-only channel</span>
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setShowCreateModal(false); setNewChannelName('') }}
                  className="px-4 py-2 rounded-xl text-sm text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newChannelName.trim() || createChannel.isPending}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors"
                >
                  {createChannel.isPending ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Channel Confirmation */}
      {confirmDeleteChannelId && (() => {
        const ch = channelsData?.channels.find((c) => c.id === confirmDeleteChannelId)
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
            <div className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 border border-gray-700 space-y-4">
              <h2 className="text-lg font-bold text-white">Delete #{ch?.name}?</h2>
              <p className="text-sm text-gray-400">
                All messages in this channel will be permanently deleted. This cannot be undone.
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteChannelId(null)}
                  className="px-4 py-2 rounded-xl text-sm text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteChannel(confirmDeleteChannelId)}
                  disabled={deleteChannel.isPending}
                  className="px-4 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors"
                >
                  {deleteChannel.isPending ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Delete Message Confirmation */}
      {confirmDeleteMessageId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 border border-gray-700 space-y-4">
            <h2 className="text-lg font-bold text-white">Delete message?</h2>
            <p className="text-sm text-gray-400">This cannot be undone.</p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmDeleteMessageId(null)}
                className="px-4 py-2 rounded-xl text-sm text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void handleDeleteMessage(confirmDeleteMessageId); setConfirmDeleteMessageId(null) }}
                disabled={deleteMessage.isPending}
                className="px-4 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors"
              >
                {deleteMessage.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Channel Tag Assignment Modal */}
      {showTagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 border border-gray-700 space-y-4">
            <h2 className="text-lg font-bold text-white">Channel Tags</h2>
            <p className="text-sm text-gray-400">
              Members subscribed to these tags will be notified of messages in this channel.
            </p>
            {groupTags.length === 0 ? (
              <p className="text-sm text-gray-500 italic">
                No tags exist in this group yet.{' '}
                {isAdminOrOwner ? (
                  <a
                    href={`/groups/${groupId}/manage#tags`}
                    className="text-indigo-400 hover:text-indigo-300 underline not-italic"
                    onClick={() => setShowTagModal(false)}
                  >
                    Create one
                  </a>
                ) : (
                  <span className="not-italic text-gray-500">Ask an admin to create a tag.</span>
                )}
              </p>
            ) : (
              <div className="space-y-2">
                {groupTags.map((tag) => (
                  <label key={tag.id} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedTagIds.includes(tag.id)}
                      onChange={(e) => {
                        setSelectedTagIds((prev) =>
                          e.target.checked ? [...prev, tag.id] : prev.filter((id) => id !== tag.id)
                        )
                      }}
                      className="w-4 h-4 rounded accent-indigo-500"
                    />
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: tag.color ?? '#6366f1' }}
                    />
                    <span className="text-sm text-gray-200">{tag.name}</span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-500">
              Leave all unchecked to notify all group members (no tag filter).
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowTagModal(false)}
                className="px-4 py-2 rounded-xl text-sm text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveChannelTags}
                disabled={updateChannelTags.isPending}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors"
              >
                {updateChannelTags.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile long-press action sheet */}
      {actionSheetMessage && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end md:hidden"
          onClick={() => setActionSheetMessageId(null)}
        >
          <div
            className="w-full bg-gray-900 rounded-t-2xl border-t border-gray-800 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full bg-gray-700" />
            </div>
            {/* Message preview */}
            <div className="px-5 py-2 border-b border-gray-800">
              <p className="text-xs text-gray-500 truncate">{actionSheetMessage.content}</p>
            </div>
            {/* Quick reactions */}
            {!actionSheetMessage.deleted && !actionSheetMessage.pending && (
              <div className="flex justify-around items-center px-4 py-3 border-b border-gray-800">
                {COMMON_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => { void handleReact(actionSheetMessage.id, emoji); setActionSheetMessageId(null) }}
                    className="text-2xl active:scale-125 transition-transform"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
            {/* Actions */}
            <div className="py-1">
              {!actionSheetMessage.deleted && (
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(actionSheetMessage.content)
                    setActionSheetMessageId(null)
                    toast.success('Copied')
                  }}
                  className="flex items-center gap-3 w-full px-5 py-3.5 text-sm text-gray-200 active:bg-gray-800"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                  Copy text
                </button>
              )}
              {!actionSheetMessage.deleted && !actionSheetMessage.pending && actionSheetMessage.userId === currentUser?.id && (
                <button
                  onClick={() => { startEdit(actionSheetMessage); setActionSheetMessageId(null) }}
                  className="flex items-center gap-3 w-full px-5 py-3.5 text-sm text-gray-200 active:bg-gray-800"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit message
                </button>
              )}
              {!actionSheetMessage.deleted && !actionSheetMessage.pending && isAdminOrOwner && (
                <button
                  onClick={() => { void handlePin(actionSheetMessage.id); setActionSheetMessageId(null) }}
                  className="flex items-center gap-3 w-full px-5 py-3.5 text-sm text-gray-200 active:bg-gray-800"
                >
                  <span className="text-base">📌</span>
                  {actionSheetMessage.pinned ? 'Unpin message' : 'Pin message'}
                </button>
              )}
              {!actionSheetMessage.deleted && !actionSheetMessage.pending && actionSheetMessage.userId === currentUser?.id && (
                <button
                  onClick={() => { setConfirmDeleteMessageId(actionSheetMessage.id); setActionSheetMessageId(null) }}
                  className="flex items-center gap-3 w-full px-5 py-3.5 text-sm text-red-400 active:bg-gray-800"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete message
                </button>
              )}
            </div>
            {/* Cancel */}
            <div className="px-4 py-3 border-t border-gray-800">
              <button
                onClick={() => setActionSheetMessageId(null)}
                className="w-full py-3 bg-gray-800 rounded-xl text-sm text-gray-300 font-medium active:bg-gray-700"
              >
                Cancel
              </button>
            </div>
            {/* Safe area bottom inset */}
            <div className="h-[env(safe-area-inset-bottom,8px)]" />
          </div>
        </div>
      )}

      {/* Pinned Messages Modal */}
      {showPinnedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setShowPinnedModal(false)}>
          <div
            className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-700 flex flex-col max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-amber-500">📌</span>
                <h2 className="text-base font-semibold text-white">
                  Pinned Messages
                  <span className="ml-2 text-xs font-normal text-gray-500">{pinnedMessages.length}</span>
                </h2>
              </div>
              <button
                onClick={() => setShowPinnedModal(false)}
                className="text-gray-500 hover:text-white transition-colors p-1"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-gray-800">
              {pinnedMessages.map((msg) => (
                <div key={msg.id} className="px-5 py-3 flex items-start gap-3">
                  <Avatar
                    name={msg.user?.name ?? 'Unknown'}
                    avatarUrl={msg.user?.avatarUrl ?? undefined}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-white">{msg.user?.name ?? 'Unknown'}</span>
                      <span className="text-xs text-gray-500">{formatTime(msg.createdAt)}</span>
                    </div>
                    <MessageContent content={msg.content} currentUserId={currentUser?.id ?? ''} members={members} groupTags={groupTags} className="text-sm text-gray-200 break-words whitespace-pre-wrap" />
                  </div>
                  {isAdminOrOwner && (
                    <button
                      onClick={() => void handlePin(msg.id)}
                      disabled={pinMessage.isPending}
                      className="flex-shrink-0 p-1 rounded text-amber-600 hover:text-amber-400 hover:bg-gray-800 transition-colors disabled:opacity-50"
                      title="Unpin message"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" />
                        <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Channel Settings Modal */}
      {showChannelSettingsModal && channel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          onClick={() => setShowChannelSettingsModal(false)}
        >
          <div
            className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 border border-gray-700 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">#{channel.name}</h2>
              <button
                onClick={() => setShowChannelSettingsModal(false)}
                className="text-gray-500 hover:text-white transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {!channel.isGeneral && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  const name = settingsRenameValue.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
                  if (!name || name === channel.name) { setShowChannelSettingsModal(false); return }
                  try {
                    await renameChannel.mutateAsync({ channelId: channelId!, name })
                    toast.success(`Renamed to #${name}`)
                    setShowChannelSettingsModal(false)
                  } catch (err) {
                    toast.error(getApiErrorMessage(err, 'Failed to rename'))
                  }
                }}
                className="space-y-2"
              >
                <label className="block text-sm text-gray-400">Rename channel</label>
                <div className="flex items-center gap-2">
                  <div className="flex items-center flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2">
                    <span className="text-gray-500 mr-1">#</span>
                    <input
                      value={settingsRenameValue}
                      onChange={(e) => setSettingsRenameValue(e.target.value.toLowerCase().replace(/\s/g, '-'))}
                      maxLength={32}
                      className="flex-1 bg-transparent text-white placeholder-gray-500 focus:outline-none text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={renameChannel.isPending || !settingsRenameValue.trim() || settingsRenameValue === channel.name}
                    className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors"
                  >
                    Save
                  </button>
                </div>
              </form>
            )}
            <div className="space-y-2">
              <button
                onClick={() => { setShowChannelSettingsModal(false); openTagModal(channelId!, channel.tags?.map((t) => t.id) ?? []) }}
                className="flex items-center gap-3 w-full px-4 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-sm text-gray-200 transition-colors text-left"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M3 11l10 10a4 4 0 005.657 0l4.343-4.343A4 4 0 0023 13.657L13 3.657A4 4 0 0010.343 3L6 3H3v3l.343.343z" />
                </svg>
                Notification Tags
              </button>
              {channel.isInviteOnly && (
                <button
                  onClick={() => { setShowChannelSettingsModal(false); setManageSubscribersChannelId(channelId!) }}
                  className="flex items-center gap-3 w-full px-4 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 text-sm text-gray-200 transition-colors text-left"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Manage Members
                </button>
              )}
              {!channel.isGeneral && (
                <button
                  onClick={() => { setShowChannelSettingsModal(false); setConfirmDeleteChannelId(channelId!) }}
                  className="flex items-center gap-3 w-full px-4 py-3 rounded-xl bg-gray-800 hover:bg-red-900/30 text-sm text-red-400 transition-colors text-left"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete Channel
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Manage Subscribers Modal */}
      {manageSubscribersChannelId && (
        <ManageSubscribersModal
          groupId={groupId!}
          channelId={manageSubscribersChannelId}
          channelName={channelsData?.channels.find((c) => c.id === manageSubscribersChannelId)?.name ?? ''}
          groupMembers={membersData?.members ?? []}
          isAdmin={isAdminOrOwner}
          onClose={() => setManageSubscribersChannelId(null)}
        />
      )}
    </div>
  )
}

function ManageSubscribersModal({
  groupId,
  channelId,
  channelName,
  groupMembers,
  isAdmin,
  onClose,
}: {
  groupId: string
  channelId: string
  channelName: string
  groupMembers: Array<{ userId: string; name: string; email?: string | null; avatarUrl?: string | null; role: string; status: string }>
  isAdmin: boolean
  onClose: () => void
}) {
  const toast = useToast()
  const { data, isLoading } = useChannelSubscribers(groupId, channelId)
  const addSubscriber = useAddChannelSubscriber(groupId, channelId)
  const removeSubscriber = useRemoveChannelSubscriber(groupId, channelId)

  const subscribers = data?.subscribers ?? []
  const subscriberIds = new Set(subscribers.map((s) => s.id))
  // Admins see all active members (to add/remove). Non-admins see only current subscribers.
  const displayMembers = isAdmin
    ? groupMembers.filter((m) => m.status === 'active')
    : groupMembers.filter((m) => subscriberIds.has(m.userId))

  const handleAdd = async (userId: string) => {
    try {
      await addSubscriber.mutateAsync(userId)
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to add member'))
    }
  }

  const handleRemove = async (userId: string) => {
    try {
      await removeSubscriber.mutateAsync(userId)
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to remove member'))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6 border border-gray-700 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Members of #{channelName}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {isAdmin && (
          <p className="text-sm text-gray-400">Control who has access to this invite-only channel.</p>
        )}
        {isLoading ? (
          <div className="flex justify-center py-4"><Spinner className="text-indigo-400" /></div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {displayMembers.map((member) => {
              const isSubscribed = subscriberIds.has(member.userId)
              const isPending = addSubscriber.isPending || removeSubscriber.isPending
              return (
                <div key={member.userId} className="flex items-center gap-3 py-1.5">
                  <Avatar name={member.name} avatarUrl={member.avatarUrl ?? undefined} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{member.name}</p>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => void (isSubscribed ? handleRemove(member.userId) : handleAdd(member.userId))}
                      disabled={isPending}
                      className={`text-xs px-3 py-1 rounded-lg font-medium transition-colors disabled:opacity-50 ${
                        isSubscribed
                          ? 'bg-gray-700 text-gray-300 hover:bg-red-900 hover:text-red-300'
                          : 'bg-indigo-700 text-indigo-100 hover:bg-indigo-600'
                      }`}
                    >
                      {isSubscribed ? 'Remove' : 'Add'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <div className="flex justify-end pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-gray-400 hover:text-white transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
