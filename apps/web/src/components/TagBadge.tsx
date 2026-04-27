interface TagBadgeProps {
  name: string
  color?: string | null
}

/**
 * TagBadge — renders a pill badge for a tag.
 *
 * Background: the tag's theme color at full opacity so the badge is
 * immediately identifiable by its configured color.
 *
 * Text: `text-white` which resolves to white in dark mode and to
 * near-black (#1a1816) in light mode via the CSS variable override in
 * index.css — ensuring legibility against any saturated background in
 * both themes without needing per-color contrast calculations.
 */
export default function TagBadge({ name, color }: TagBadgeProps) {
  if (color) {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white"
        style={{ backgroundColor: color }}
      >
        {name}
      </span>
    )
  }

  // Fallback when no color is set — neutral solid surface
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-600 text-white">
      {name}
    </span>
  )
}
