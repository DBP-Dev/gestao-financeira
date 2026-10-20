import type { Member } from '../types'

interface AvatarProps {
  member: Member
  size?: 'small' | 'medium' | 'large'
}

/** Avatar neutro com a inicial do nome. */
export function Avatar({ member, size = 'medium' }: AvatarProps) {
  const initial = member.name.trim().charAt(0).toUpperCase() || '?'
  return (
    <span className={`avatar avatar--${size}`} aria-hidden="true">
      {initial}
    </span>
  )
}
