import { describe, expect, it } from 'vitest'
import type { Area, Bill, BillSeries } from './types'
import { HOME_AREA_ID, MY_ACCOUNTS_AREA_ID } from './areas'
import { getMemberShareTotals, getPersonalMonthSummary, type PersonalMonthSummary } from './personal'
import { billsForMonth } from './series'

const member = (id: string, name: string, inactive = false) => ({
  id,
  name,
  emoji: '🙂',
  color: '#d8ecff',
  ...(inactive ? { inactive: true } : {}),
})

let nextId = 0
function bill(totalCents: number, shares: Bill['shares'], paid = false, month = '2026-10'): Bill {
  nextId++
  return { id: `b${nextId}`, name: `Conta ${nextId}`, month, totalCents, dueDay: 10, shares, paid }
}

function area(id: string, type: Area['type'], bills: Bill[], members = [member('x', 'X')], series: BillSeries[] = []): Area {
  return { id, name: id, type, members: type === 'individual' ? [] : members, bills, series }
}

/** Confere a igualdade e devolve o resumo. */
function summarize(areas: Area[], selfIds: Record<string, string | null>, month = '2026-10') {
  const summary = getPersonalMonthSummary(
    areas.map((item) => ({ area: item, bills: billsForMonth(item, month) })),
    (item) => selfIds[item.id] ?? null,
  )
  expect(summary.paidCents + summary.pendingCents).toBe(summary.shareCents)
  return summary
}

describe('parte de uma pessoa nas contas (getMemberShareTotals)', () => {
  it('soma só as partes dela; o pendente vem das contas não pagas', () => {
    const bills = [
      bill(10000, [{ memberId: 'h1', amountCents: 6000 }, { memberId: 'h2', amountCents: 4000 }], true),
      bill(5001, [{ memberId: 'h1', amountCents: 2501 }, { memberId: 'h2', amountCents: 2500 }]),
      bill(3000, [{ memberId: 'h2', amountCents: 3000 }]),
    ]
    expect(getMemberShareTotals('h1', bills)).toEqual({ totalCents: 8501, pendingCents: 2501 })
    expect(getMemberShareTotals('h3', bills)).toEqual({ totalCents: 0, pendingCents: 0 })
  })
})

describe('resumo do mês no painel pessoal (getPersonalMonthSummary)', () => {
  const homeMembers = [member('eu', 'Eu'), member('h2', 'Bia')]
  const tripMembers = [member('v1', 'Dani'), member('v2', 'Edu')]

  // Casa: uma paga dividida e uma pendente com centavo ímpar.
  const home = () =>
    area(HOME_AREA_ID, 'shared', [
      bill(10000, [{ memberId: 'eu', amountCents: 5000 }, { memberId: 'h2', amountCents: 5000 }], true),
      bill(10001, [{ memberId: 'eu', amountCents: 5001 }, { memberId: 'h2', amountCents: 5000 }]),
    ], homeMembers)
  // Minhas contas: uma paga e uma pendente, sem divisão.
  const mine = () => area(MY_ACCOUNTS_AREA_ID, 'individual', [bill(12000, [], true), bill(3000, [])])
  // Viagem: "Sou eu" = Edu.
  const trip = () =>
    area('viagem', 'shared', [
      bill(9000, [{ memberId: 'v1', amountCents: 3000 }, { memberId: 'v2', amountCents: 6000 }]),
    ], tripMembers)
  // Outra área, sem "Sou eu".
  const other = () =>
    area('obra', 'shared', [bill(20000, [{ memberId: 'o1', amountCents: 20000 }], true)], [member('o1', 'Gil')])

  it('combina as três origens; área sem "Sou eu" só entra no total geral', () => {
    const summary = summarize([home(), mine(), trip(), other()], {
      [HOME_AREA_ID]: 'eu',
      viagem: 'v2',
      obra: null,
    })
    // Pago: 5000 (casa) + 12000 (minhas contas). Pendente: 5001 + 3000 + 6000.
    expect(summary).toEqual<PersonalMonthSummary>({
      shareCents: 31001,
      paidCents: 17000,
      pendingCents: 14001,
      // 10000 + 10001 + 12000 + 3000 + 9000 + 20000
      monthTotalCents: 64001,
    })
  })

  it('sem "Sou eu" na viagem, ela sai da sua parte e continua no total geral', () => {
    const summary = summarize([home(), mine(), trip()], { [HOME_AREA_ID]: 'eu', viagem: null })
    expect(summary).toEqual({ shareCents: 25001, paidCents: 17000, pendingCents: 8001, monthTotalCents: 44001 })
  })

  it('participante desativado como "Sou eu" não chega aqui: a área fica fora da sua parte', () => {
    // useAreaSelf devolve null para desativados; a função só soma quem recebe.
    const inactiveTrip = area('viagem', 'shared', trip().bills, [member('v1', 'Dani'), member('v2', 'Edu', true)])
    const summary = summarize([inactiveTrip], { viagem: null })
    expect(summary).toEqual({ shareCents: 0, paidCents: 0, pendingCents: 0, monthTotalCents: 9000 })
  })

  it('partes de outras pessoas não entram na sua parte', () => {
    const summary = summarize([home()], { [HOME_AREA_ID]: 'h2' })
    expect(summary).toEqual({ shareCents: 10000, paidCents: 5000, pendingCents: 5000, monthTotalCents: 20001 })
  })

  it('mês sem contas: tudo zerado', () => {
    const empty = [area(HOME_AREA_ID, 'shared', [], homeMembers), area(MY_ACCOUNTS_AREA_ID, 'individual', [])]
    expect(summarize(empty, { [HOME_AREA_ID]: 'eu' })).toEqual({
      shareCents: 0,
      paidCents: 0,
      pendingCents: 0,
      monthTotalCents: 0,
    })
  })

  it('recorrente e parcelada: a ocorrência gravada não é contada de novo como prevista', () => {
    const half = [{ memberId: 'eu', amountCents: 2500 }, { memberId: 'h2', amountCents: 2500 }]
    const academia: BillSeries = {
      id: 's-ac', kind: 'recurring', startMonth: '2026-10', skippedMonths: [],
      versions: [{ fromMonth: '2026-10', name: 'Academia', totalCents: 5000, dueDay: 10, shares: half }],
    }
    const notebook: BillSeries = {
      id: 's-nb', kind: 'installment', startMonth: '2026-10', installmentCount: 3, skippedMonths: [],
      versions: [{ fromMonth: '2026-10', name: 'Notebook', totalCents: 30000, dueDay: 15, shares: [] }],
    }
    // Outubro: academia gravada e paga; parcela 1 do notebook gravada e pendente.
    const academiaOct: Bill = { ...bill(5000, half, true), seriesId: 's-ac' }
    const notebookOct: Bill = { ...bill(30000, []), seriesId: 's-nb', installmentNumber: 1 }
    const areas = [
      area(HOME_AREA_ID, 'shared', [academiaOct], homeMembers, [academia]),
      area(MY_ACCOUNTS_AREA_ID, 'individual', [notebookOct], [], [notebook]),
    ]
    expect(billsForMonth(areas[0], '2026-10')).toHaveLength(1)
    expect(summarize(areas, { [HOME_AREA_ID]: 'eu' }, '2026-10')).toEqual({
      shareCents: 32500, paidCents: 2500, pendingCents: 30000, monthTotalCents: 35000,
    })
    // Novembro: nada gravado; as duas previstas entram, inteiras no pendente.
    expect(summarize(areas, { [HOME_AREA_ID]: 'eu' }, '2026-11')).toEqual({
      shareCents: 32500, paidCents: 0, pendingCents: 32500, monthTotalCents: 35000,
    })
    // Janeiro: a parcelada terminou; só a academia prevista.
    expect(summarize(areas, { [HOME_AREA_ID]: 'eu' }, '2027-01')).toEqual({
      shareCents: 2500, paidCents: 0, pendingCents: 2500, monthTotalCents: 5000,
    })
  })

  it('pago é a sua parte nas contas pagas, conferida conta a conta', () => {
    const areas = [home(), mine(), trip(), other()]
    const selfIds: Record<string, string | null> = { [HOME_AREA_ID]: 'eu', viagem: 'v2', obra: null }
    const summary = summarize(areas, selfIds)
    let paid = 0
    for (const item of areas) {
      for (const entry of item.bills) {
        if (!entry.paid) continue
        if (item.type === 'individual') paid += entry.totalCents
        else paid += entry.shares.find((share) => share.memberId === selfIds[item.id])?.amountCents ?? 0
      }
    }
    expect(summary.paidCents).toBe(paid)
  })
})
