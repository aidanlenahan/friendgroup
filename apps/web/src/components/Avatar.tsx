function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

interface AvatarProps {
  name: string
  avatarUrl?: string | null
  size?: 'sm' | 'md' | 'lg'
  title?: string
}

const sizeClasses = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-lg',
}

export default function Avatar({ name, avatarUrl, size = 'md', title }: AvatarProps) {
  const cls = sizeClasses[size]

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={title ?? name}
        title={title ?? name}
        className={`${cls} rounded-full object-cover`}
      />
    )
  }

  return (
    <div
      title={title ?? name}
      className={`${cls} rounded-full bg-indigo-900 flex items-center justify-center font-bold text-indigo-200`}
    >
      {getInitials(name)}
    </div>
  )
}
