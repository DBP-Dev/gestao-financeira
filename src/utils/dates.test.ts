import { describe, expect, it } from 'vitest'
import type { Bill } from '../types'
import { effectiveDueDay, formatMonthList, nextBusinessDay } from './dates'

describe('lista curta de meses (formatMonthList)', () => {
  it('até 3 meses, todos, sem o ano quando são do mesmo ano', () => {
    expect(formatMonthList([])).toBe('')
    expect(formatMonthList(['2026-01'])).toBe('jan')
    expect(formatMonthList(['2026-01', '2026-02', '2026-03'])).toBe('jan, fev, mar')
  })

  it('mais de 3 meses: os 3 primeiros, quantos faltam e o total', () => {
    const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']
    expect(formatMonthList(months)).toBe('jan, fev, mar e mais 4 (7 meses)')
  })

  it('com o ano só quando a lista atravessa anos diferentes', () => {
    const months = ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03']
    expect(formatMonthList(months)).toBe('nov 2026, dez 2026, jan 2027 e mais 2 (5 meses)')
    expect(formatMonthList(['2026-12', '2027-01'])).toBe('dez 2026, jan 2027')
    // Todos de um mesmo ano, mesmo que não seja o atual: sem o ano.
    expect(formatMonthList(['2027-04', '2027-05'])).toBe('abr, mai')
  })
})

describe('próximo dia útil (nextBusinessDay)', () => {
  it('de segunda a quinta é o dia seguinte', () => {
    expect(nextBusinessDay({ month: '2026-10', day: 26 })).toEqual({ month: '2026-10', day: 27 }) // segunda
    expect(nextBusinessDay({ month: '2026-10', day: 27 })).toEqual({ month: '2026-10', day: 28 }) // terça
    expect(nextBusinessDay({ month: '2026-10', day: 28 })).toEqual({ month: '2026-10', day: 29 }) // quarta
    expect(nextBusinessDay({ month: '2026-10', day: 29 })).toEqual({ month: '2026-10', day: 30 }) // quinta
  })

  it('na sexta, no sábado e no domingo é a segunda-feira (virando o mês)', () => {
    expect(nextBusinessDay({ month: '2026-10', day: 30 })).toEqual({ month: '2026-11', day: 2 }) // sexta
    expect(nextBusinessDay({ month: '2026-10', day: 31 })).toEqual({ month: '2026-11', day: 2 }) // sábado
    expect(nextBusinessDay({ month: '2026-11', day: 1 })).toEqual({ month: '2026-11', day: 2 }) // domingo
  })

  it('vira o ano e atravessa o fim de fevereiro', () => {
    expect(nextBusinessDay({ month: '2026-12', day: 31 })).toEqual({ month: '2027-01', day: 1 }) // quinta
    expect(nextBusinessDay({ month: '2027-01', day: 1 })).toEqual({ month: '2027-01', day: 4 }) // sexta
    expect(nextBusinessDay({ month: '2027-02', day: 26 })).toEqual({ month: '2027-03', day: 1 }) // sexta
  })
})

describe('dia de vencimento em meses com menos dias (effectiveDueDay)', () => {
  const due = (month: string, dueDay: number) =>
    effectiveDueDay({ id: 'x', name: 'x', month, totalCents: 1, dueDay, shares: [], paid: false } as Bill)

  it('ajusta ao último dia do mês; nos demais, mantém o dia', () => {
    expect(due('2027-02', 31)).toBe(28)
    expect(due('2028-02', 30)).toBe(29)
    expect(due('2026-04', 31)).toBe(30)
    expect(due('2026-10', 31)).toBe(31)
    expect(due('2026-10', 5)).toBe(5)
  })
})
