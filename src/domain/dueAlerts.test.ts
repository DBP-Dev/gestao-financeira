import { describe, expect, it } from 'vitest'
import type { Area, Bill, BillSeries, Today } from './types'
import { HOME_AREA_ID, MY_ACCOUNTS_AREA_ID } from './areas'
import { formatAlertDate, getDueAlerts, visibleAlerts, type DueAlert } from './dueAlerts'
import { projectedBillId } from './series'

const member = (id: string, name: string, inactive = false) => ({
  id,
  name,
  emoji: '🙂',
  color: '#d8ecff',
  ...(inactive ? { inactive: true } : {}),
})

const MONDAY: Today = { month: '2026-10', day: 26 }
const FRIDAY: Today = { month: '2026-10', day: 30 }

let nextId = 0
function bill(month: string, dueDay: number, extra: Partial<Bill> = {}): Bill {
  nextId++
  return {
    id: `b${nextId}`,
    name: `Conta ${nextId}`,
    month,
    totalCents: 10000,
    dueDay,
    shares: [{ memberId: 'eu', amountCents: 5000 }, { memberId: 'h2', amountCents: 5000 }],
    paid: false,
    ...extra,
  }
}

const home = (bills: Bill[], series: BillSeries[] = []): Area => ({
  id: HOME_AREA_ID, name: 'Gastos da casa', type: 'shared',
  members: [member('eu', 'Eu'), member('h2', 'Bia')], bills, series,
})
const mine = (bills: Bill[], series: BillSeries[] = []): Area => ({
  id: MY_ACCOUNTS_AREA_ID, name: 'Minhas contas', type: 'individual', members: [],
  bills: bills.map((item) => ({ ...item, shares: [] })), series,
})
const trip = (bills: Bill[], eduInactive = false): Area => ({
  id: 'viagem', name: 'Viagem', type: 'shared',
  members: [member('v1', 'Dani'), member('v2', 'Edu', eduInactive)], bills, series: [],
})

/** Perfil "eu" na casa e "Sou eu" informado por área (como o App passa). */
const selfIds = (ids: Record<string, string | null>) => (area: Area) => ids[area.id] ?? null
const names = (alerts: DueAlert[]) => alerts.map((alert) => `${alert.areaName}: ${alert.billName}`)
const dates = (alerts: DueAlert[]) => alerts.map((alert) => `${alert.month}-${alert.dueDay}`)

describe('alertas do painel pessoal (getDueAlerts)', () => {
  it('em atraso: meses anteriores e o mês atual, da mais antiga para a mais recente; pagas fora', () => {
    const areas = [home([
      bill('2026-10', 20, { name: 'Luz' }),
      bill('2026-08', 5, { name: 'Gás' }),
      bill('2026-09', 10, { name: 'Água paga', paid: true }),
      bill('2026-10', 26, { name: 'Vence hoje' }),
    ])]
    const alerts = getDueAlerts(areas, MONDAY, selfIds({ [HOME_AREA_ID]: 'eu' }))
    expect(names(alerts.overdue)).toEqual(['Gastos da casa: Gás', 'Gastos da casa: Luz'])
    expect(names(alerts.dueSoon)).toEqual(['Gastos da casa: Vence hoje'])
  })

  it('próximas: hoje e o próximo dia útil entram; depois do limite, não; pagas fora', () => {
    const areas = [home([
      bill('2026-10', 26, { name: 'Hoje' }),
      bill('2026-10', 27, { name: 'Terça' }),
      bill('2026-10', 28, { name: 'Quarta' }),
      bill('2026-10', 27, { name: 'Terça paga', paid: true }),
    ])]
    const alerts = getDueAlerts(areas, MONDAY, selfIds({ [HOME_AREA_ID]: 'eu' }))
    expect(names(alerts.dueSoon)).toEqual(['Gastos da casa: Hoje', 'Gastos da casa: Terça'])
    expect(alerts.overdue).toEqual([])
  })

  it('sexta-feira: sábado, domingo e segunda entram, virando o mês; terça não', () => {
    const areas = [home([
      bill('2026-10', 30, { name: 'Sexta' }),
      bill('2026-10', 31, { name: 'Sábado' }),
      bill('2026-11', 1, { name: 'Domingo' }),
      bill('2026-11', 2, { name: 'Segunda' }),
      bill('2026-11', 3, { name: 'Terça' }),
    ])]
    const alerts = getDueAlerts(areas, FRIDAY, selfIds({ [HOME_AREA_ID]: 'eu' }))
    expect(dates(alerts.dueSoon)).toEqual(['2026-10-30', '2026-10-31', '2026-11-1', '2026-11-2'])
  })

  it('sábado e domingo também vão até segunda; virada de ano', () => {
    const areas = [home([bill('2026-11', 1), bill('2026-11', 2), bill('2026-11', 3)])]
    const self = selfIds({ [HOME_AREA_ID]: 'eu' })
    expect(dates(getDueAlerts(areas, { month: '2026-10', day: 31 }, self).dueSoon)).toEqual(['2026-11-1', '2026-11-2'])
    expect(dates(getDueAlerts(areas, { month: '2026-11', day: 1 }, self).dueSoon)).toEqual(['2026-11-1', '2026-11-2'])
    const newYear = [home([bill('2026-12', 31), bill('2027-01', 1), bill('2027-01', 2)])]
    expect(dates(getDueAlerts(newYear, { month: '2026-12', day: 31 }, self).dueSoon)).toEqual(['2026-12-31', '2027-01-1'])
  })

  it('mês curto: vencimento no dia 31 em fevereiro conta como dia 28', () => {
    // Sexta, 26/02/2027: o limite é segunda, 01/03.
    const areas = [home([bill('2027-02', 31, { name: 'Aluguel' }), bill('2027-03', 2, { name: 'Depois' })])]
    const alerts = getDueAlerts(areas, { month: '2027-02', day: 26 }, selfIds({ [HOME_AREA_ID]: 'eu' }))
    expect(dates(alerts.dueSoon)).toEqual(['2027-02-28'])
  })

  it('casa pelo perfil, "Minhas contas" inteira e áreas com "Sou eu"; o resto fica de fora', () => {
    const areas = [
      home([
        bill('2026-10', 26, { name: 'Com o perfil' }),
        bill('2026-10', 26, { name: 'Só da Bia', shares: [{ memberId: 'h2', amountCents: 10000 }] }),
      ]),
      mine([bill('2026-10', 27, { name: 'Celular' })]),
      trip([
        bill('2026-10', 20, { name: 'Hotel', shares: [{ memberId: 'v2', amountCents: 10000 }] }),
        bill('2026-10', 21, { name: 'Passeio', shares: [{ memberId: 'v1', amountCents: 10000 }] }),
      ]),
    ]
    const alerts = getDueAlerts(areas, MONDAY, selfIds({ [HOME_AREA_ID]: 'eu', viagem: 'v2' }))
    expect(names(alerts.overdue)).toEqual(['Viagem: Hotel'])
    expect(names(alerts.dueSoon)).toEqual(['Gastos da casa: Com o perfil', 'Minhas contas: Celular'])
    // Sem "Sou eu" (ou com "Sou eu" desativado, que useAreaSelf devolve como null), a área sai.
    const withoutSelf = getDueAlerts(areas, MONDAY, selfIds({ [HOME_AREA_ID]: 'eu', viagem: null }))
    expect(withoutSelf.overdue).toEqual([])
  })

  it('não depende do mês selecionado: só da data de hoje', () => {
    const areas = [home([bill('2026-08', 5), bill('2026-10', 27)])]
    const self = selfIds({ [HOME_AREA_ID]: 'eu' })
    // A função nem recebe o mês selecionado; com a mesma data, o resultado é o mesmo.
    expect(getDueAlerts(areas, MONDAY, self)).toEqual(getDueAlerts(areas, MONDAY, self))
    expect(getDueAlerts(areas, MONDAY, self).overdue).toHaveLength(1)
    expect(getDueAlerts(areas, MONDAY, self).dueSoon).toHaveLength(1)
  })

  describe('séries: gravadas, previstas e exclusões', () => {
    const half = [{ memberId: 'eu', amountCents: 2500 }, { memberId: 'h2', amountCents: 2500 }]
    const academia: BillSeries = {
      id: 's-ac', kind: 'recurring', startMonth: '2026-08', skippedMonths: [],
      versions: [{ fromMonth: '2026-08', name: 'Academia', totalCents: 5000, dueDay: 2, shares: half }],
    }
    const occurrence = (month: string, extra: Partial<Bill> = {}): Bill => ({
      id: `ac-${month}`, name: 'Academia', month, totalCents: 5000, dueDay: 2, shares: half,
      paid: false, seriesId: 's-ac', ...extra,
    })

    it('atrasadas só das gravadas; a prevista do mês seguinte entra na virada, sem duplicar', () => {
      // Sexta, 30/10: agosto pago, setembro e outubro gravados e pendentes, novembro previsto.
      const area = home([occurrence('2026-08', { paid: true }), occurrence('2026-09'), occurrence('2026-10')], [academia])
      const alerts = getDueAlerts([area], FRIDAY, selfIds({ [HOME_AREA_ID]: 'eu' }))
      expect(dates(alerts.overdue)).toEqual(['2026-09-2', '2026-10-2'])
      expect(dates(alerts.dueSoon)).toEqual(['2026-11-2'])
      expect(alerts.dueSoon[0].billId).toBe(projectedBillId('s-ac', '2026-11'))
    })

    it('ocorrência gravada no mês da janela não aparece também como prevista', () => {
      const area = home([occurrence('2026-11')], [academia])
      const alerts = getDueAlerts([area], FRIDAY, selfIds({ [HOME_AREA_ID]: 'eu' }))
      expect(alerts.dueSoon.map((alert) => alert.billId)).toEqual(['ac-2026-11'])
    })

    it('mês excluído da série não gera alerta; parcelada terminada também não', () => {
      const skipped = home([], [{ ...academia, skippedMonths: ['2026-11'] }])
      expect(getDueAlerts([skipped], FRIDAY, selfIds({ [HOME_AREA_ID]: 'eu' })).dueSoon).toEqual([])
      const tv: BillSeries = {
        id: 's-tv', kind: 'installment', startMonth: '2026-08', installmentCount: 3, skippedMonths: [],
        versions: [{ fromMonth: '2026-08', name: 'TV', totalCents: 9000, dueDay: 2, shares: [] }],
      }
      // Parcelas de agosto a outubro; em novembro não há parcela prevista.
      expect(getDueAlerts([mine([], [tv])], FRIDAY, () => null).dueSoon).toEqual([])
    })
  })

  it('nenhuma conta aparece nas duas listas, e nenhuma se repete', () => {
    const areas = [home([bill('2026-10', 29), bill('2026-10', 30), bill('2026-11', 2), bill('2026-09', 1)])]
    const alerts = getDueAlerts(areas, FRIDAY, selfIds({ [HOME_AREA_ID]: 'eu' }))
    const ids = [...alerts.overdue, ...alerts.dueSoon].map((alert) => alert.billId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(alerts.overdue).toHaveLength(2)
    expect(alerts.dueSoon).toHaveLength(2)
  })

  it('sem contas para alertar: as duas listas vazias', () => {
    const alerts = getDueAlerts([home([]), mine([])], MONDAY, selfIds({ [HOME_AREA_ID]: 'eu' }))
    expect(alerts).toEqual({ overdue: [], dueSoon: [] })
  })
})

describe('apresentação dos alertas', () => {
  const alert = (month: string, dueDay: number): DueAlert => ({
    areaId: 'a', areaName: 'A', billId: `${month}-${dueDay}`, billName: 'Conta', month, dueDay,
  })

  it('data com o ano só quando não é o ano de hoje', () => {
    expect(formatAlertDate(alert('2026-10', 5), MONDAY)).toBe('5 de outubro')
    expect(formatAlertDate(alert('2025-12', 10), MONDAY)).toBe('10 de dezembro de 2025')
  })

  it('no máximo três visíveis; o restante vira a contagem de ocultos', () => {
    const list = [1, 2, 3, 4, 5, 6, 7].map((day) => alert('2026-10', day))
    expect(visibleAlerts(list)).toEqual({ shown: list.slice(0, 3), hidden: 4 })
    expect(visibleAlerts(list.slice(0, 3))).toEqual({ shown: list.slice(0, 3), hidden: 0 })
    expect(visibleAlerts([])).toEqual({ shown: [], hidden: 0 })
    // A lista completa não é alterada.
    expect(list).toHaveLength(7)
  })
})
