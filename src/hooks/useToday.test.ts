// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToday } from './useToday'

describe('data de hoje que acompanha a virada (useToday)', () => {
  beforeEach(() => {
    // Relógio falso: a hora real nunca é esperada.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('na meia-noite local do último dia do mês, passa para o dia 1 do mês seguinte', () => {
    vi.setSystemTime(new Date(2026, 9, 31, 23, 59, 58))
    const { result } = renderHook(() => useToday())
    expect(result.current).toEqual({ month: '2026-10', day: 31 })

    // Ainda antes da meia-noite (com a folga de 1 segundo): nada muda.
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(result.current).toEqual({ month: '2026-10', day: 31 })

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(result.current).toEqual({ month: '2026-11', day: 1 })

    // O temporizador é agendado de novo para a meia-noite seguinte.
    act(() => {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    })
    expect(result.current).toEqual({ month: '2026-11', day: 2 })
  })

  it('sem mudança de dia, mantém o mesmo objeto (nenhuma renderização a mais)', () => {
    vi.setSystemTime(new Date(2026, 9, 31, 10, 0, 0))
    const { result } = renderHook(() => useToday())
    const first = result.current
    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000)
      window.dispatchEvent(new Event('focus'))
    })
    expect(result.current).toBe(first)
  })

  it('temporizador atrasado: ao voltar o foco para a aba, a data é conferida de novo', () => {
    vi.setSystemTime(new Date(2026, 9, 31, 22, 0, 0))
    const { result } = renderHook(() => useToday())
    // O relógio pula para novembro sem o temporizador disparar (ex.: computador suspenso).
    vi.setSystemTime(new Date(2026, 10, 3, 9, 0, 0))
    expect(result.current).toEqual({ month: '2026-10', day: 31 })
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(result.current).toEqual({ month: '2026-11', day: 3 })
  })
})
