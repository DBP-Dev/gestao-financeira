import type { CSSProperties } from 'react'
import type { Member } from '../types'

interface AvatarProps {
  member: Member
  size?: 'small' | 'medium' | 'large'
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/** Avatar com a inicial do nome e um contorno na cor do membro. */
export function Avatar({ member, size = 'medium' }: AvatarProps) {
  const initial = member.name.trim().charAt(0).toUpperCase() || '?'
  const style = HEX_COLOR.test(member.color)
    ? ({ '--member-color': member.color } as CSSProperties)
    : undefined
  return (
    <span className={`avatar avatar--${size}`} style={style} aria-hidden="true">
      {initial}
    </span>
  )
}
