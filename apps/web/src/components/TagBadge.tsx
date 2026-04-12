interface TagBadgeProps {
  name: string
  color?: string | null
}

export default function TagBadge({ name, color }: TagBadgeProps) {
  if (color) {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
        style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}44` }}
      >
        {name}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-700 text-gray-300">
      {name}
    </span>
  )
}
