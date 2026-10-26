// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Member } from '../types'
import { DEFAULT_CURRENT_MEMBER_ID } from '../utils/personal'
import { useCurrentMember } from './useCurrentMember'

const PROFILE_KEY = 'gestao-financeira:perfil:v1'

const member = (id: string, name: string, inactive = false): Member => ({
  id,
  name,
  emoji: '🙂',
  color: '#d8ecff',
  ...(inactive ? { inactive: true } : {}),
})

beforeEach(() => {
  localStorage.clear()
})

describe('perfil do painel pessoal (useCurrentMember)', () => {
  it('perfil salvo de participante ativo continua sendo o usuário atual', () => {
    localStorage.setItem(PROFILE_KEY, 'h2')
    const { result } = renderHook(() => useCurrentMember([member('h1', 'Ana'), member('h2', 'Bia')]))
    expect(result.current.member?.id).toBe('h2')
  })

  it('perfil salvo de participante desativado não é aceito', () => {
    localStorage.setItem(PROFILE_KEY, 'h2')
    const { result } = renderHook(() =>
      useCurrentMember([member('h1', 'Ana'), member('h2', 'Bia', true)]),
    )
    expect(result.current.member).toBeNull()
    // Só deixa de valer: a preferência gravada neste aparelho não é apagada.
    expect(localStorage.getItem(PROFILE_KEY)).toBe('h2')
  })

  it('"Eu" desativado não é usado; a escolha salva de um ativo vale no lugar', () => {
    localStorage.setItem(PROFILE_KEY, 'h2')
    const members = [member(DEFAULT_CURRENT_MEMBER_ID, 'Eu', true), member('h2', 'Bia')]
    const { result } = renderHook(() => useCurrentMember(members))
    expect(result.current.member?.id).toBe('h2')
  })

  it('"Eu" ativo continua tendo prioridade sobre a escolha salva', () => {
    localStorage.setItem(PROFILE_KEY, 'h2')
    const members = [member(DEFAULT_CURRENT_MEMBER_ID, 'Eu'), member('h2', 'Bia')]
    const { result } = renderHook(() => useCurrentMember(members))
    expect(result.current.member?.id).toBe(DEFAULT_CURRENT_MEMBER_ID)
  })

  it('participante desativado depois de escolhido deixa de ser o usuário atual', () => {
    const { result, rerender } = renderHook(({ members }) => useCurrentMember(members), {
      initialProps: { members: [member('h1', 'Ana'), member('h2', 'Bia')] },
    })
    act(() => result.current.chooseMember('h2'))
    expect(result.current.member?.id).toBe('h2')
    expect(localStorage.getItem(PROFILE_KEY)).toBe('h2')
    rerender({ members: [member('h1', 'Ana'), member('h2', 'Bia', true)] })
    expect(result.current.member).toBeNull()
  })
})
