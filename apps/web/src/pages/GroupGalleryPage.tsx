import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useGroup, useGroupMembers, useGroupPhotosInfinite } from '../hooks/useGroups'
import { MediaLightbox } from '../components/MediaLightbox'
import type { LightboxMedia } from '../components/MediaLightbox'
import { apiFetch } from '../lib/api'
import { useAuthStore } from '../stores/authStore'
import PageToolbar from '../components/PageToolbar'
import Spinner from '../components/Spinner'
import EmptyState from '../components/EmptyState'

export default function GroupGalleryPage() {
  const { groupId } = useParams<{ groupId: string }>()
  const currentUser = useAuthStore((s) => s.user)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const { data: groupData } = useGroup(groupId!)
  const { data: membersData } = useGroupMembers(groupId!)
  const {
    data: photosPages,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useGroupPhotosInfinite(groupId!)

  const myMembership = membersData?.members?.find((m) => m.userId === currentUser?.id)
  const isAdmin = myMembership?.role === 'owner' || myMembership?.role === 'admin'

  const qc = useQueryClient()

  const handleSaveCaption = async (assetId: string, caption: string | null) => {
    await apiFetch(`/media/${assetId}/caption`, { method: 'PATCH', body: JSON.stringify({ caption }) })
    qc.invalidateQueries({ queryKey: ['groups', groupId, 'photos'] })
  }

  const group = groupData?.group

  useEffect(() => {
    if (!group?.name) return
    document.title = `${group.name} Photos — GEM`
    return () => { document.title = 'GEM — Group Event Manager' }
  }, [group?.name])

  const photos = photosPages?.pages.flatMap((p) => p.media) ?? []

  const lightboxMedia: LightboxMedia[] = photos.map((m) => ({
    id: m.id,
    url: m.url,
    filename: m.filename,
    sizeBytes: m.sizeBytes,
    mimeType: m.mimeType,
    width: m.width,
    height: m.height,
    exifData: m.exifData,
    caption: m.caption ?? null,
    createdAt: m.createdAt,
    uploader: m.uploader,
  }))

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <PageToolbar
        title={group ? `${group.name} — Gallery` : 'Gallery'}
        backTo={`/groups/${groupId}`}
      />

      {isLoading && (
        <div className="flex justify-center py-24">
          <Spinner className="text-indigo-400" />
        </div>
      )}

      {isError && !isLoading && (
        <div className="flex flex-col items-center gap-3 py-16 text-gray-400">
          <p>Failed to load photos.</p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 rounded-xl bg-gray-800 text-gray-200 text-sm hover:bg-gray-700 transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {!isLoading && !isError && photos.length === 0 && (
        <EmptyState
          icon={
            <svg className="w-16 h-16" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="6" y="14" width="52" height="38" rx="5"/>
              <circle cx="20" cy="27" r="5"/>
              <polyline points="6,52 24,34 36,46 44,38 58,52"/>
            </svg>
          }
          title="No photos yet"
          description="Photos uploaded to events in this group will appear here."
          action={
            <Link
              to={`/groups/${groupId}`}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
            >
              Back to group
            </Link>
          }
        />
      )}

      {!isLoading && !isError && photos.length > 0 && (
        <>
          <p className="text-sm text-gray-500 mb-4">{photos.length} photo{photos.length !== 1 ? 's' : ''}</p>
          <div className="columns-2 sm:columns-3 lg:columns-4 gap-1.5 [column-gap:6px]">
            {photos.map((photo, i) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => setLightboxIndex(i)}
                className="group relative w-full overflow-hidden rounded-lg bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 break-inside-avoid block"
              >
                <img
                  src={photo.url}
                  alt={photo.filename}
                  className="w-full object-cover transition-transform duration-200 group-hover:scale-105 block"
                  loading="lazy"
                  decoding="async"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors" />
                <div className="absolute bottom-0 inset-x-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Link
                    to={`/events/${photo.event.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-white text-[11px] font-medium truncate block leading-tight drop-shadow hover:underline"
                  >
                    {photo.event.title}
                  </Link>
                  <p className="text-white/70 text-[10px] truncate leading-tight drop-shadow">
                    {photo.uploader?.name ?? 'Unknown'}
                  </p>
                </div>
              </button>
            ))}
          </div>

          {hasNextPage && (
            <div className="flex justify-center mt-6">
              <button
                type="button"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="px-6 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-gray-200 text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}

      {lightboxIndex !== null && lightboxMedia.length > 0 && (
        <MediaLightbox
          media={lightboxMedia}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          currentUserId={currentUser?.id}
          isAdmin={isAdmin}
          onSaveCaption={handleSaveCaption}
        />
      )}
    </div>
  )
}
