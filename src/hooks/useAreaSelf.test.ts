// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Area, Member } from '../domain/types'
import { HOME_AREA_ID } from '../domain/areas'
import { useAreaSelf } from './useAreaSelf'

const AREA_SELF_KEY = 'gestao-financeira:perfil-areas:v1'

const member = (id: string, name: string, inactive = false): Member => ({
  id,
  name,
  emoji: '🙂',
  color: '#d8ecff',
  ...(inactive ? { inactive: true } : {}),
})

/** "Gastos da casa" e a área compartilhada "Viagem", com Dani e Edu. */
function areas(eduInactive = false): Area[] {
  return [
    { id: HOME_AREA_ID, name: 'Gastos da casa', type: 'shared', members: [member('h1', 'Ana')], bills: [], series: [] },
    {
      id: 'viagem',
      name: 'Viagem',
      type: 'shared',
      members: [member('v1', 'Dani'), member('v2', 'Edu', eduInactive)],
      bills: [],
      series: [],
    },
  ]
}

const saved = () => JSON.parse(localStorage.getItem(AREA_SELF_KEY) ?? 'null') as Record<string, string> | null

beforeEach(() => {
  localStorage.clear()
})

describe('"Sou eu" nas áreas compartilhadas (useAreaSelf)', () => {
  it('escolha de participante ativo vale e é gravada', () => {
    const { result } = renderHook(() => useAreaSelf(areas(), true))
    act(() => result.current.chooseSelf('viagem', 'v2'))
    expect(result.current.getSelfId('viagem')).toBe('v2')
    expect(saved()).toEqual({ viagem: 'v2' })
  })

  it('participante desativado não pode ser escolhido', () => {
    const { result } = renderHook(() => useAreaSelf(areas(true), true))
    act(() => result.current.chooseSelf('viagem', 'v2'))
    expect(result.current.getSelfId('viagem')).toBeNull()
    expect(saved()).toBeNull()
  })

  it('escolha salva que aponta para desativado é inválida e é limpa do aparelho', () => {
    localStorage.setItem(AREA_SELF_KEY, JSON.stringify({ viagem: 'v2' }))
    const { result } = renderHook(() => useAreaSelf(areas(true), true))
    expect(result.current.getSelfId('viagem')).toBeNull()
    expect(saved()).toEqual({})
  })

  it('em modo de recuperação (sem limpeza) é ignorada, mas não apagada', () => {
    localStorage.setItem(AREA_SELF_KEY, JSON.stringify({ viagem: 'v2' }))
    const { result } = renderHook(() => useAreaSelf(areas(true), false))
    expect(result.current.getSelfId('viagem')).toBeNull()
    expect(saved()).toEqual({ viagem: 'v2' })
  })

  it('desativação depois da escolha: deixa de valer e é limpa; ativos seguem normais', () => {
    localStorage.setItem(AREA_SELF_KEY, JSON.stringify({ viagem: 'v2' }))
    const { result, rerender } = renderHook(({ list }) => useAreaSelf(list, true), {
      initialProps: { list: areas() },
    })
    expect(result.current.getSelfId('viagem')).toBe('v2')
    expect(saved()).toEqual({ viagem: 'v2' })
    rerender({ list: areas(true) })
    expect(result.current.getSelfId('viagem')).toBeNull()
    expect(saved()).toEqual({})
    // Outro participante, ativo, pode ser escolhido normalmente.
    act(() => result.current.chooseSelf('viagem', 'v1'))
    expect(result.current.getSelfId('viagem')).toBe('v1')
    expect(saved()).toEqual({ viagem: 'v1' })
  })
})
