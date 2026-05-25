import { memo } from 'react'

export const Skeleton = memo(function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-gray-800 ${className ?? ''}`} />
  )
})

export const GroupCardSkeleton = memo(function GroupCardSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-900 border border-gray-800">
      <Skeleton className="w-10 h-10 rounded-full shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  )
})

export const EventCardSkeleton = memo(function EventCardSkeleton() {
  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="h-3 w-28" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  )
})

export const MemberRowSkeleton = memo(function MemberRowSkeleton() {
  return (
    <div className="flex items-center gap-3 py-2">
      <Skeleton className="w-9 h-9 rounded-full shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-2.5 w-16" />
      </div>
      <Skeleton className="h-5 w-14 rounded-full" />
    </div>
  )
})

export const MessageBubbleSkeleton = memo(function MessageBubbleSkeleton({ reverse = false }: { reverse?: boolean }) {
  return (
    <div className={`flex items-end gap-2 ${reverse ? 'flex-row-reverse' : ''}`}>
      <Skeleton className="w-7 h-7 rounded-full shrink-0" />
      <div className={`space-y-1 max-w-[70%] ${reverse ? 'items-end flex flex-col' : ''}`}>
        <Skeleton className="h-4 w-20" />
        <Skeleton className={`h-10 rounded-2xl ${reverse ? 'rounded-br-sm' : 'rounded-bl-sm'} w-48`} />
      </div>
    </div>
  )
})

export const NotificationItemSkeleton = memo(function NotificationItemSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Skeleton className="w-9 h-9 rounded-full shrink-0 mt-0.5" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-48" />
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
  )
})

export const PhotoGridSkeleton = memo(function PhotoGridSkeleton({ count = 9 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="aspect-square" />
      ))}
    </div>
  )
})

export const ProfileHeaderSkeleton = memo(function ProfileHeaderSkeleton() {
  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <Skeleton className="w-20 h-20 rounded-full" />
      <Skeleton className="h-5 w-36" />
      <Skeleton className="h-3.5 w-24" />
    </div>
  )
})

export const EventDetailSkeleton = memo(function EventDetailSkeleton() {
  return (
    <div className="space-y-4 px-4 py-6">
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-2/5" />
      <div className="pt-2 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  )
})
