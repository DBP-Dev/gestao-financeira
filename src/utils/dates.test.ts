import { describe, expect, it } from 'vitest'
import { formatMonthList } from './dates'

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
