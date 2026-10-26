import { describe, expect, it } from 'vitest'
import type { Area, Bill, BillSeries, BillShare, FinanceData, SeriesKind, Today } from '../types'
import { HOME_AREA_ID, MY_ACCOUNTS_AREA_ID } from './areas'
import { MAX_BILLS, parseStoredData } from './backup'
import {
  END_CHOICE_MESSAGE,
  INACTIVE_IN_SHARES_MESSAGE,
  INSTALLMENT_NO_ACTIVE_MESSAGE,
  INSTALLMENT_PAYER_INACTIVE_MESSAGE,
  INSTALLMENT_PAYER_MISSING_MESSAGE,
  OCCURRENCE_LIMIT_MESSAGE,
  SERIES_ENDED_MESSAGE,
  applyEndSeries,
  applyInstallmentCount,
  applyMemberDeactivation,
  endMonthOptions,
  planMemberDeactivation,
  planEndSeries,
  planInstallmentCount,
  OVERRIDDEN_CHOICE_MESSAGE,
  PAID_OCCURRENCE_DELETE_MESSAGE,
  SERIES_EDIT_UNAVAILABLE_MESSAGE,
  applySeriesEdit,
  billsForMonth,
  planSeriesEdit,
  createSeries,
  deleteOccurrence,
  editOccurrence,
  findOccurrence,
  installmentNumberFor,
  isProjectedBill,
  isValidMonth,
  isWithinSeries,
  materializeDue,
  minInstallmentCount,
  monthFromIndex,
  monthIndex,
  payProjectedOccurrence,
  projectedBillId,
  projectedBillsForMonth,
  seriesDataAt,
  seriesEditStartMonth,
  seriesEndMonth,
  seriesLabelFor,
  stillPending,
  totalBills,
  validateInstallmentCount,
  versionForMonth,
  type OccurrenceInput,
  type SeriesChangeResult,
  type SeriesEditInput,
} from './series'

const OCTOBER: Today = { month: '2026-10', day: 22 }

/** Gerador de ids previsível para os testes. */
function idGenerator(prefix = 'id') {
  let next = 0
  return () => `${prefix}-${++next}`
}

const member = (id: string, name: string, inactive = false) => ({
  id,
  name,
  emoji: '🙂',
  color: '#d8ecff',
  ...(inactive ? { inactive: true } : {}),
})

function academia(overrides: Partial<BillSeries> = {}): BillSeries {
  return {
    id: 's-academia',
    kind: 'recurring',
    startMonth: '2026-10',
    versions: [
      {
        fromMonth: '2026-10',
        name: 'Academia',
        totalCents: 10000,
        dueDay: 10,
        shares: [
          { memberId: 'h1', amountCents: 5000 },
          { memberId: 'h2', amountCents: 5000 },
        ],
      },
      {
        fromMonth: '2027-01',
        name: 'Academia',
        totalCents: 12000,
        dueDay: 10,
        shares: [
          { memberId: 'h1', amountCents: 6000 },
          { memberId: 'h2', amountCents: 6000 },
        ],
      },
    ],
    skippedMonths: [],
    ...overrides,
  }
}

function notebook(overrides: Partial<BillSeries> = {}): BillSeries {
  return {
    id: 's-notebook',
    kind: 'installment',
    startMonth: '2026-10',
    installmentCount: 10,
    versions: [
      { fromMonth: '2026-10', name: 'Notebook', totalCents: 25000, dueDay: 15, shares: [] },
    ],
    skippedMonths: [],
    ...overrides,
  }
}

function occurrence(series: BillSeries, month: string, extra: Partial<Bill> = {}): Bill {
  const version = versionForMonth(series, month)
  if (!version) throw new Error('mês fora da série no teste')
  const number = installmentNumberFor(series, month)
  return {
    id: `o-${series.id}-${month}`,
    name: version.name,
    month,
    totalCents: version.totalCents,
    dueDay: version.dueDay,
    shares: version.shares.map((share) => ({ ...share })),
    paid: false,
    seriesId: series.id,
    ...(number !== null ? { installmentNumber: number } : {}),
    ...extra,
  }
}

function makeData(home: Partial<Area> = {}, mine: Partial<Area> = {}): FinanceData {
  return {
    version: 3,
    areas: [
      {
        id: HOME_AREA_ID,
        name: 'Gastos da casa',
        type: 'shared',
        members: [member('h1', 'Ana'), member('h2', 'Bia'), member('h3', 'Caio', true)],
        bills: [],
        series: [],
        ...home,
      },
      {
        id: MY_ACCOUNTS_AREA_ID,
        name: 'Minhas contas',
        type: 'individual',
        members: [],
        bills: [],
        series: [],
        ...mine,
      },
    ],
  }
}

const home = (data: FinanceData) => data.areas[0]
const mine = (data: FinanceData) => data.areas[1]

/** Os dados produzidos pelas funções de série precisam passar pelo validador do app. */
function expectValid(data: FinanceData) {
  const result = parseStoredData(JSON.stringify(data))
  if (!result.ok) throw new Error(result.error)
  expect(result.ok).toBe(true)
}

describe('meses', () => {
  it('converte meses em números e de volta, inclusive na virada do ano', () => {
    expect(monthFromIndex(monthIndex('2026-12') + 1)).toBe('2027-01')
    expect(monthFromIndex(monthIndex('2027-01') - 1)).toBe('2026-12')
    expect(monthIndex('2027-03') - monthIndex('2026-10')).toBe(5)
  })

  it('calcula o último mês e o período de cada tipo de série', () => {
    expect(seriesEndMonth(notebook())).toBe('2027-07')
    expect(seriesEndMonth(academia())).toBeNull()
    expect(seriesEndMonth(academia({ lastMonth: '2026-12' }))).toBe('2026-12')

    expect(isWithinSeries(notebook(), '2026-09')).toBe(false)
    expect(isWithinSeries(notebook(), '2027-07')).toBe(true)
    expect(isWithinSeries(notebook(), '2027-08')).toBe(false)
    expect(isWithinSeries(academia(), '2040-01')).toBe(true)
  })

  it('usa a versão vigente no mês e numera as parcelas pela posição', () => {
    expect(versionForMonth(academia(), '2026-09')).toBeNull()
    expect(versionForMonth(academia(), '2026-12')?.totalCents).toBe(10000)
    expect(versionForMonth(academia(), '2027-01')?.totalCents).toBe(12000)
    expect(versionForMonth(academia(), '2030-05')?.totalCents).toBe(12000)

    expect(installmentNumberFor(notebook(), '2026-10')).toBe(1)
    expect(installmentNumberFor(notebook(), '2027-07')).toBe(10)
    expect(installmentNumberFor(academia(), '2026-10')).toBeNull()
  })
})

describe('previsões', () => {
  it('prevê a conta com os dados vigentes do mês e id próprio', () => {
    const data = makeData({ series: [academia()] })
    const [december] = projectedBillsForMonth(home(data), '2026-12')
    const [january] = projectedBillsForMonth(home(data), '2027-01')
    expect(december).toMatchObject({
      id: projectedBillId('s-academia', '2026-12'),
      month: '2026-12',
      totalCents: 10000,
      paid: false,
      seriesId: 's-academia',
      projected: true,
    })
    expect(january.totalCents).toBe(12000)
    expect(isProjectedBill(december)).toBe(true)
  })

  it('não prevê mês já gravado, mês excluído nem fora do período', () => {
    const series = notebook({ skippedMonths: ['2027-01'] })
    const data = makeData({}, { series: [series], bills: [occurrence(series, '2026-10')] })
    expect(projectedBillsForMonth(mine(data), '2026-10')).toEqual([])
    expect(projectedBillsForMonth(mine(data), '2027-01')).toEqual([])
    expect(projectedBillsForMonth(mine(data), '2026-09')).toEqual([])
    expect(projectedBillsForMonth(mine(data), '2027-08')).toEqual([])
    expect(projectedBillsForMonth(mine(data), '2027-02')[0].installmentNumber).toBe(5)
  })

  it('para de prever depois do encerramento de uma recorrente', () => {
    const data = makeData({ series: [academia({ lastMonth: '2026-11', versions: [academia().versions[0]] })] })
    expect(projectedBillsForMonth(home(data), '2026-11')).toHaveLength(1)
    expect(projectedBillsForMonth(home(data), '2026-12')).toEqual([])
  })

  it('junta gravadas e previstas sem contar a mesma ocorrência duas vezes', () => {
    const series = academia()
    const paidDecember = occurrence(series, '2026-12', { paid: true })
    const normal: Bill = {
      id: 'c1', name: 'Luz', month: '2026-12', totalCents: 9000, dueDay: 5,
      shares: [{ memberId: 'h1', amountCents: 9000 }], paid: false,
    }
    const data = makeData({ series: [series], bills: [paidDecember, normal] })
    const december = billsForMonth(home(data), '2026-12')
    expect(december.map((bill) => bill.id)).toEqual([paidDecember.id, 'c1'])
    expect(december.some(isProjectedBill)).toBe(false)
    expect(billsForMonth(home(data), '2027-01').map((bill) => bill.id)).toEqual([
      projectedBillId('s-academia', '2027-01'),
    ])
  })
})

describe('gravação automática (materializeDue)', () => {
  it('grava as ocorrências que faltam até o mês atual e mais nenhuma', () => {
    const series = academia({ startMonth: '2026-07', versions: [{ ...academia().versions[0], fromMonth: '2026-07' }] })
    const data = makeData({ series: [series] })
    const result = materializeDue(data, OCTOBER, idGenerator())
    // App fechado por meses: julho a outubro gravados de uma vez, todos pendentes.
    expect(result.created).toBe(4)
    expect(result.limitExceeded).toBe(false)
    expect(home(result.data).bills.map((bill) => bill.month)).toEqual([
      '2026-07', '2026-08', '2026-09', '2026-10',
    ])
    expect(home(result.data).bills.every((bill) => !bill.paid && bill.seriesId === series.id)).toBe(true)
    expectValid(result.data)
  })

  it('é idempotente: rodar de novo devolve o mesmo objeto, sem criar nada', () => {
    const data = makeData({ series: [academia()] })
    const first = materializeDue(data, OCTOBER, idGenerator())
    const second = materializeDue(first.data, OCTOBER, idGenerator('outro'))
    expect(second.created).toBe(0)
    expect(second.data).toBe(first.data)
  })

  it('devolve o mesmo objeto quando não há séries ou nada a gravar', () => {
    const data = makeData()
    expect(materializeDue(data, OCTOBER).data).toBe(data)
    const future = makeData({ series: [academia({ startMonth: '2026-12', versions: [{ ...academia().versions[0], fromMonth: '2026-12' }] })] })
    expect(materializeDue(future, OCTOBER).data).toBe(future)
  })

  it('não recria meses excluídos e não altera a primeira ocorrência paga', () => {
    const series = academia({
      startMonth: '2026-08',
      versions: [{ ...academia().versions[0], fromMonth: '2026-08' }],
      skippedMonths: ['2026-09'],
    })
    const firstPaid = occurrence(series, '2026-08', { paid: true })
    const data = makeData({ series: [series], bills: [firstPaid] })
    const result = materializeDue(data, OCTOBER, idGenerator())
    expect(result.created).toBe(1)
    const bills = home(result.data).bills
    expect(bills[0]).toBe(firstPaid)
    expect(bills.map((bill) => bill.month)).toEqual(['2026-08', '2026-10'])
    expectValid(result.data)
  })

  it('respeita o fim das séries: encerramento e quantidade de parcelas', () => {
    const ended = academia({
      startMonth: '2026-07',
      lastMonth: '2026-08',
      versions: [{ ...academia().versions[0], fromMonth: '2026-07' }],
    })
    const installments = notebook({ startMonth: '2026-08', installmentCount: 2, versions: [{ ...notebook().versions[0], fromMonth: '2026-08' }] })
    const data = makeData({ series: [ended] }, { series: [installments] })
    const result = materializeDue(data, OCTOBER, idGenerator())
    expect(home(result.data).bills.map((bill) => bill.month)).toEqual(['2026-07', '2026-08'])
    expect(mine(result.data).bills.map((bill) => [bill.month, bill.installmentNumber])).toEqual([
      ['2026-08', 1],
      ['2026-09', 2],
    ])
    expectValid(result.data)
  })

  it('não grava nada se ultrapassar o limite de contas', () => {
    const filler: Bill[] = Array.from({ length: MAX_BILLS }, (_, index) => ({
      id: `f-${index}`, name: 'Conta', month: '2026-01', totalCents: 100, dueDay: 1, shares: [], paid: true,
    }))
    const data = makeData({ series: [academia()] }, { bills: filler })
    const result = materializeDue(data, OCTOBER, idGenerator())
    expect(result.limitExceeded).toBe(true)
    expect(result.created).toBe(0)
    expect(result.data).toBe(data)
  })

  it('não repete ids já usados', () => {
    const data = makeData({
      series: [academia()],
      bills: [{ id: 'id-1', name: 'Luz', month: '2026-10', totalCents: 100, dueDay: 1, shares: [{ memberId: 'h1', amountCents: 100 }], paid: false }],
    })
    const result = materializeDue(data, OCTOBER, idGenerator())
    const ids = home(result.data).bills.map((bill) => bill.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('criação de séries (createSeries)', () => {
  const recurringInput = {
    kind: 'recurring' as const,
    startMonth: '2026-10',
    name: '  Academia  ',
    totalCents: 10000,
    dueDay: 10,
    shares: [
      { memberId: 'h1', amountCents: 5000 },
      { memberId: 'h2', amountCents: 5000 },
    ],
    firstPaid: true,
  }

  it('cria a série e grava só a primeira ocorrência, com "já foi paga"', () => {
    const result = createSeries(makeData(), HOME_AREA_ID, recurringInput, OCTOBER, idGenerator())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const area = home(result.data)
    expect(area.series).toHaveLength(1)
    expect(area.series[0]).toMatchObject({
      kind: 'recurring',
      startMonth: '2026-10',
      skippedMonths: [],
      versions: [{ fromMonth: '2026-10', name: 'Academia', totalCents: 10000, dueDay: 10 }],
    })
    expect(area.bills).toHaveLength(1)
    expect(area.bills[0]).toMatchObject({ month: '2026-10', paid: true, seriesId: area.series[0].id })
    expect(area.bills[0].id).not.toBe(area.series[0].id)
    // O mês seguinte é só previsão, e pendente.
    expect(projectedBillsForMonth(area, '2026-11')[0].paid).toBe(false)
    expectValid(result.data)
  })

  it('aceita começar num mês futuro e recusa mês passado', () => {
    const future = createSeries(makeData(), HOME_AREA_ID, { ...recurringInput, startMonth: '2027-02' }, OCTOBER, idGenerator())
    expect(future.ok).toBe(true)
    if (future.ok) {
      expect(home(future.data).bills[0].month).toBe('2027-02')
      expectValid(future.data)
    }
    const past = createSeries(makeData(), HOME_AREA_ID, { ...recurringInput, startMonth: '2026-09' }, OCTOBER)
    expect(past).toEqual({
      ok: false,
      error: 'Contas recorrentes e parceladas só podem começar no mês atual ou em um mês futuro.',
    })
  })

  it('cria parcelada com numeração e respeita o limite de 2 a 120 parcelas', () => {
    const input = {
      kind: 'installment' as const,
      startMonth: '2026-10',
      installmentCount: 120,
      name: 'Notebook',
      totalCents: 25000,
      dueDay: 15,
      shares: [{ memberId: 'h1', amountCents: 25000 }],
      firstPaid: false,
    }
    const ok = createSeries(makeData(), MY_ACCOUNTS_AREA_ID, input, OCTOBER, idGenerator())
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      const area = mine(ok.data)
      // Área individual: a divisão é ignorada.
      expect(area.series[0].versions[0].shares).toEqual([])
      expect(area.bills[0]).toMatchObject({ installmentNumber: 1, shares: [] })
      expect(seriesEndMonth(area.series[0])).toBe('2036-09')
      expectValid(ok.data)
    }
    for (const installmentCount of [1, 121, 2.5]) {
      const result = createSeries(makeData(), MY_ACCOUNTS_AREA_ID, { ...input, installmentCount }, OCTOBER)
      expect(result).toEqual({ ok: false, error: 'A quantidade de parcelas precisa ser de 2 a 120.' })
    }
  })

  it('recusa divisão inválida ou com participante desativado', () => {
    const cases = [
      { shares: [], error: 'Escolha pelo menos uma pessoa' },
      { shares: [{ memberId: 'h1', amountCents: 9000 }], error: 'não somam exatamente' },
      // Etapa 9: desativado tem mensagem própria; quem é de fora continua com a antiga.
      { shares: [{ memberId: 'h3', amountCents: 10000 }], error: 'participante desativado' },
      { shares: [{ memberId: 'x', amountCents: 10000 }], error: 'não participa desta área' },
    ]
    for (const { shares, error } of cases) {
      const result = createSeries(makeData(), HOME_AREA_ID, { ...recurringInput, shares }, OCTOBER)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain(error)
    }
  })

  it('recusa nome, valor e vencimento inválidos e área inexistente', () => {
    const bad = [
      { name: '   ' },
      { name: 'x'.repeat(41) },
      { totalCents: 0 },
      { dueDay: 32 },
    ]
    for (const change of bad) {
      expect(createSeries(makeData(), HOME_AREA_ID, { ...recurringInput, ...change }, OCTOBER).ok).toBe(false)
    }
    expect(createSeries(makeData(), 'nao-existe', recurringInput, OCTOBER).ok).toBe(false)
  })

  it('não altera os dados recebidos', () => {
    const data = makeData()
    const snapshot = JSON.stringify(data)
    createSeries(data, HOME_AREA_ID, recurringInput, OCTOBER, idGenerator())
    materializeDue(data, OCTOBER, idGenerator())
    expect(JSON.stringify(data)).toBe(snapshot)
  })
})

describe('quantidade de parcelas', () => {
  it('aceita só inteiros de 2 a 120', () => {
    expect(validateInstallmentCount(2)).toBeNull()
    expect(validateInstallmentCount(120)).toBeNull()
    expect(validateInstallmentCount(1)).not.toBeNull()
    expect(validateInstallmentCount(121)).not.toBeNull()
    expect(validateInstallmentCount(3.5)).not.toBeNull()
  })

  it('o mínimo é a maior parcela paga, inclusive paga adiantada', () => {
    const series = notebook()
    const paid = (month: string) => occurrence(series, month, { paid: true })
    expect(minInstallmentCount(series, [])).toBe(2)
    const firstSix = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'].map(paid)
    expect(minInstallmentCount(series, firstSix)).toBe(6)
    // 1ª, 2ª e 8ª pagas: mínimo 8.
    expect(minInstallmentCount(series, [paid('2026-10'), paid('2026-11'), paid('2027-05')])).toBe(8)
    // Pendentes e parcelas de outra série não contam.
    const otherSeries = { ...paid('2027-07'), seriesId: 'outra' }
    expect(minInstallmentCount(series, [occurrence(series, '2027-07'), otherSeries])).toBe(2)
  })
})

describe('vigência de "esta e as seguintes"', () => {
  it('começa no mês da ocorrência pendente ou no seguinte se ela estiver paga', () => {
    expect(seriesEditStartMonth(academia(), { month: '2026-10', paid: false })).toBe('2026-10')
    expect(seriesEditStartMonth(academia(), { month: '2026-10', paid: true })).toBe('2026-11')
    expect(seriesEditStartMonth(academia(), { month: '2026-12', paid: true })).toBe('2027-01')
  })

  it('não existe depois do fim da série', () => {
    const ended = academia({ lastMonth: '2026-11', versions: [academia().versions[0]] })
    expect(seriesEditStartMonth(ended, { month: '2026-11', paid: false })).toBe('2026-11')
    expect(seriesEditStartMonth(ended, { month: '2026-11', paid: true })).toBeNull()
    // Ocorrência mantida depois do encerramento.
    expect(seriesEditStartMonth(ended, { month: '2026-12', paid: false })).toBeNull()
    // Última parcela paga: não há seguintes.
    expect(seriesEditStartMonth(notebook(), { month: '2027-07', paid: true })).toBeNull()
  })
})

describe('apoio', () => {
  it('encontra a ocorrência gravada de uma série no mês', () => {
    const series = academia()
    const bill = occurrence(series, '2026-10')
    const data = makeData({ series: [series], bills: [bill] })
    expect(findOccurrence(home(data), series.id, '2026-10')).toBe(bill)
    expect(findOccurrence(home(data), series.id, '2026-11')).toBeUndefined()
  })
})

describe('validação das entradas da criação', () => {
  const input = {
    kind: 'recurring' as SeriesKind,
    startMonth: '2026-10',
    name: 'Academia',
    totalCents: 10000,
    dueDay: 10,
    shares: [{ memberId: 'h1', amountCents: 10000 }],
    firstPaid: false,
  }

  it('reconhece só meses existentes no formato AAAA-MM', () => {
    for (const valid of ['2026-01', '2026-12', '2099-07']) expect(isValidMonth(valid)).toBe(true)
    for (const invalid of ['2027-13', '2027-00', '27-10', '2026-1', '2026/10', '', 202610, null]) {
      expect(isValidMonth(invalid)).toBe(false)
    }
  })

  it('recusa mês de início inexistente ou mal formatado, sem alterar os dados', () => {
    for (const startMonth of ['2027-13', '2027-00', '27-10', '2026-1', '']) {
      const data = makeData()
      const snapshot = JSON.stringify(data)
      expect(createSeries(data, HOME_AREA_ID, { ...input, startMonth }, OCTOBER)).toEqual({
        ok: false,
        error: 'O mês de início é inválido.',
      })
      expect(JSON.stringify(data)).toBe(snapshot)
    }
  })

  it('recusa data de referência inválida', () => {
    for (const month of ['2026-13', 'outubro', '']) {
      expect(createSeries(makeData(), HOME_AREA_ID, input, { month, day: 1 })).toEqual({
        ok: false,
        error: 'A data de referência é inválida.',
      })
    }
  })

  it('recusa tipo de série desconhecido em tempo de execução', () => {
    const kind = 'weekly' as SeriesKind
    expect(createSeries(makeData(), HOME_AREA_ID, { ...input, kind }, OCTOBER)).toEqual({
      ok: false,
      error: 'O tipo da conta é inválido.',
    })
  })

  it('aceita início futuro, inclusive no ano seguinte, e ignora parcelas numa recorrente', () => {
    for (const startMonth of ['2026-12', '2027-01']) {
      const result = createSeries(
        makeData(),
        HOME_AREA_ID,
        { ...input, startMonth, installmentCount: 5 },
        OCTOBER,
        idGenerator(),
      )
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(home(result.data).series[0].installmentCount).toBeUndefined()
      expect(home(result.data).bills[0].installmentNumber).toBeUndefined()
      expectValid(result.data)
    }
  })
})

describe('gravação automática: mudanças de mês e várias áreas', () => {
  it('não grava nada com data de referência inválida', () => {
    const data = makeData({ series: [academia()] })
    const result = materializeDue(data, { month: '2026-13', day: 1 })
    expect(result).toEqual({ data, created: 0, limitExceeded: false })
    expect(result.data).toBe(data)
  })

  it('grava outubro e, na virada para novembro, só a ocorrência de novembro', () => {
    const data = makeData({ series: [academia()] })
    const october = materializeDue(data, OCTOBER, idGenerator('out'))
    expect(october.created).toBe(1)
    const november = materializeDue(october.data, { month: '2026-11', day: 1 }, idGenerator('nov'))
    expect(november.created).toBe(1)
    const bills = home(november.data).bills
    expect(bills.map((bill) => bill.month)).toEqual(['2026-10', '2026-11'])
    // A de outubro continua sendo o mesmo registro.
    expect(bills[0]).toBe(home(october.data).bills[0])
    expect(new Set(bills.map((bill) => bill.id)).size).toBe(2)
    expect(materializeDue(november.data, { month: '2026-11', day: 30 }).data).toBe(november.data)
    expectValid(november.data)
  })

  it('não duplica a primeira ocorrência de uma série futura quando o mês chega', () => {
    const created = createSeries(
      makeData(),
      HOME_AREA_ID,
      {
        kind: 'recurring',
        startMonth: '2026-12',
        name: 'Seguro',
        totalCents: 7000,
        dueDay: 5,
        shares: [{ memberId: 'h2', amountCents: 7000 }],
        firstPaid: true,
      },
      OCTOBER,
      idGenerator('c'),
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const first = home(created.data).bills[0]

    // Antes do início: nada a gravar.
    expect(materializeDue(created.data, OCTOBER).data).toBe(created.data)
    // No mês de início: a primeira já existe.
    const december = materializeDue(created.data, { month: '2026-12', day: 1 }, idGenerator('d'))
    expect(december.created).toBe(0)
    expect(december.data).toBe(created.data)
    // Dois meses depois: só janeiro e fevereiro são criados.
    const february = materializeDue(created.data, { month: '2027-02', day: 1 }, idGenerator('f'))
    expect(february.created).toBe(2)
    const bills = home(february.data).bills
    expect(bills.map((bill) => [bill.month, bill.paid])).toEqual([
      ['2026-12', true],
      ['2027-01', false],
      ['2027-02', false],
    ])
    expect(bills[0]).toBe(first)
    expectValid(february.data)
  })

  it('processa várias áreas e séries no mesmo conjunto de dados', () => {
    const viagemSeries: BillSeries = {
      id: 's-hotel',
      kind: 'recurring',
      startMonth: '2026-08',
      lastMonth: '2026-09',
      versions: [
        {
          fromMonth: '2026-08',
          name: 'Hotel',
          totalCents: 30000,
          dueDay: 1,
          shares: [{ memberId: 'p1', amountCents: 30000 }],
        },
      ],
      skippedMonths: [],
    }
    const tv = notebook({
      id: 's-tv',
      startMonth: '2026-09',
      installmentCount: 3,
      versions: [{ fromMonth: '2026-09', name: 'TV', totalCents: 15000, dueDay: 20, shares: [] }],
      skippedMonths: ['2026-10'],
    })
    const academiaDesdeAgosto = academia({
      startMonth: '2026-08',
      versions: [{ ...academia().versions[0], fromMonth: '2026-08' }],
    })
    const base = makeData({ series: [academiaDesdeAgosto] }, { series: [tv] })
    const data: FinanceData = {
      ...base,
      areas: [
        ...base.areas,
        {
          id: 'area-v',
          name: 'Viagem',
          type: 'shared',
          members: [member('p1', 'Duda')],
          bills: [],
          series: [viagemSeries],
        },
        {
          id: 'area-r',
          name: 'República',
          type: 'shared',
          members: [member('r1', 'Gil')],
          bills: [],
          series: [],
        },
      ],
    }
    const snapshot = JSON.stringify(data)
    const result = materializeDue(data, OCTOBER, idGenerator())

    const months = (areaId: string) =>
      result.data.areas.find((item) => item.id === areaId)?.bills.map((bill) => bill.month)
    expect(months(HOME_AREA_ID)).toEqual(['2026-08', '2026-09', '2026-10'])
    // Parcelada com a 2ª (outubro) excluída: só a 1ª; a 3ª é de novembro.
    expect(months(MY_ACCOUNTS_AREA_ID)).toEqual(['2026-09'])
    // Encerrada em setembro: agosto e setembro.
    expect(months('area-v')).toEqual(['2026-08', '2026-09'])
    expect(result.created).toBe(6)
    // Área sem séries continua sendo o mesmo objeto.
    expect(result.data.areas[3]).toBe(data.areas[3])
    // Os dados recebidos não mudaram.
    expect(JSON.stringify(data)).toBe(snapshot)
    expectValid(result.data)
  })
})

describe('previsões com mês inválido', () => {
  it('não gera previsões para um mês inexistente ou mal formatado', () => {
    const data = makeData({ series: [academia()] })
    for (const month of ['2027-13', '2027-00', '2026-1', '', 'outubro']) {
      expect(projectedBillsForMonth(home(data), month)).toEqual([])
    }
    // Sem previsões, as contas do mês ficam só com as gravadas (nenhuma aqui).
    expect(billsForMonth(home(data), '2027-13')).toEqual([])
    // O mesmo mês, válido, continua gerando a previsão.
    expect(projectedBillsForMonth(home(data), '2027-12')).toHaveLength(1)
  })
})

describe('regressões depois da otimização', () => {
  it('ocorrência gravada em outro mês não esconde a previsão do mês consultado', () => {
    const series = academia()
    const data = makeData({ series: [series], bills: [occurrence(series, '2026-10')] })
    expect(projectedBillsForMonth(home(data), '2026-11')).toHaveLength(1)
    expect(projectedBillsForMonth(home(data), '2026-10')).toEqual([])
  })

  it('conta comum no mês não interfere na previsão da série', () => {
    const normal: Bill = {
      id: 'n', name: 'Luz', month: '2026-11', totalCents: 100, dueDay: 1,
      shares: [{ memberId: 'h1', amountCents: 100 }], paid: false,
    }
    const data = makeData({ series: [academia()], bills: [normal] })
    expect(projectedBillsForMonth(home(data), '2026-11')).toHaveLength(1)
  })

  it('limite global entre áreas: aceita exatamente no limite e não grava parcialmente além dele', () => {
    const filler = (count: number): Bill[] =>
      Array.from({ length: count }, (_, index) => ({
        id: `f-${index}`, name: 'Conta', month: '2026-01', totalCents: 100, dueDay: 1, shares: [], paid: true,
      }))
    const oneEach = makeData({ series: [academia()] }, { series: [notebook()] })
    const withFiller = (count: number): FinanceData => ({
      ...oneEach,
      areas: [oneEach.areas[0], { ...oneEach.areas[1], bills: filler(count) }],
    })
    // Faltam 2 ocorrências (uma por área). Com MAX_BILLS - 2 contas, cabe exatamente.
    const ok = materializeDue(withFiller(MAX_BILLS - 2), OCTOBER, idGenerator())
    expect(ok.created).toBe(2)
    expect(ok.limitExceeded).toBe(false)
    // Com uma conta a mais, nenhuma das duas é gravada.
    const over = withFiller(MAX_BILLS - 1)
    const blocked = materializeDue(over, OCTOBER, idGenerator())
    expect(blocked).toEqual({
      data: over,
      created: 0,
      limitExceeded: true,
      // Etapa 5: informa as ocorrências que ficaram pendentes.
      pending: [
        { areaId: HOME_AREA_ID, seriesId: 's-academia', month: '2026-10' },
        { areaId: MY_ACCOUNTS_AREA_ID, seriesId: 's-notebook', month: '2026-10' },
      ],
    })
    expect(blocked.data).toBe(over)
  })
})

/* ---------- Etapa 5: ocorrências individuais ---------- */

/** Resultado aceito: devolve os dados novos (falha o teste com a mensagem de erro). */
function okData(result: SeriesChangeResult): FinanceData {
  if (!result.ok) throw new Error(result.error)
  return result.data
}

const filler = (count: number): Bill[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `f-${index}`, name: 'Conta', month: '2026-01', totalCents: 100, dueDay: 1, shares: [], paid: true,
  }))

const NOT_AVAILABLE =
  'Esta conta não pode mais ser criada: ela foi excluída ou está fora do período da série.'

describe('pagar uma prevista (payProjectedOccurrence)', () => {
  it('grava a ocorrência do mês com os dados vigentes, já paga', () => {
    const data = makeData({ series: [academia()] }, { series: [notebook()] })
    const paid = okData(payProjectedOccurrence(data, HOME_AREA_ID, 's-academia', '2027-02', idGenerator()))
    expect(findOccurrence(home(paid), 's-academia', '2027-02')).toEqual({
      id: 'id-1',
      name: 'Academia',
      month: '2027-02',
      totalCents: 12000,
      dueDay: 10,
      shares: [
        { memberId: 'h1', amountCents: 6000 },
        { memberId: 'h2', amountCents: 6000 },
      ],
      paid: true,
      seriesId: 's-academia',
    })
    expect(projectedBillsForMonth(home(paid), '2027-02')).toEqual([])
    // A série não muda e a outra área continua a mesma.
    expect(home(paid).series).toBe(home(data).series)
    expect(mine(paid)).toBe(mine(data))
    expectValid(paid)

    const installment = okData(
      payProjectedOccurrence(data, MY_ACCOUNTS_AREA_ID, 's-notebook', '2026-12', idGenerator()),
    )
    const third = findOccurrence(mine(installment), 's-notebook', '2026-12')
    expect(third?.installmentNumber).toBe(3)
    expect(third?.paid).toBe(true)
    expect(third?.shares).toEqual([])
    expectValid(installment)
  })

  it('não duplica: pagar de novo uma ocorrência já gravada não muda nada', () => {
    const data = makeData({ series: [academia()] })
    const once = okData(payProjectedOccurrence(data, HOME_AREA_ID, 's-academia', '2026-11', idGenerator()))
    const twice = payProjectedOccurrence(once, HOME_AREA_ID, 's-academia', '2026-11', idGenerator('x'))
    expect(okData(twice)).toBe(once)
    expect(home(once).bills.filter((bill) => bill.month === '2026-11')).toHaveLength(1)
  })

  it('a gravação automática não cria de novo o mês pago adiantado', () => {
    const data = makeData({ series: [academia()] })
    const paid = okData(payProjectedOccurrence(data, HOME_AREA_ID, 's-academia', '2026-10', idGenerator()))
    expect(materializeDue(paid, OCTOBER).data).toBe(paid)
    const november = materializeDue(paid, { month: '2026-11', day: 1 }, idGenerator('n'))
    expect(home(november.data).bills.map((bill) => [bill.month, bill.paid])).toEqual([
      ['2026-10', true],
      ['2026-11', false],
    ])
  })

  it('recusa mês excluído, antes do início, depois do fim e dados inexistentes', () => {
    const data = makeData(
      {
        series: [
          academia({ skippedMonths: ['2026-11'] }),
          academia({ id: 's-fim', lastMonth: '2026-12', versions: [academia().versions[0]] }),
        ],
      },
      { series: [notebook()] },
    )
    const refused = (areaId: string, seriesId: string, month: string) =>
      payProjectedOccurrence(data, areaId, seriesId, month, idGenerator())
    expect(refused(HOME_AREA_ID, 's-academia', '2026-11')).toEqual({ ok: false, error: NOT_AVAILABLE })
    expect(refused(HOME_AREA_ID, 's-academia', '2026-09')).toEqual({ ok: false, error: NOT_AVAILABLE })
    expect(refused(HOME_AREA_ID, 's-fim', '2027-01')).toEqual({ ok: false, error: NOT_AVAILABLE })
    // 11ª parcela de uma compra em 10.
    expect(refused(MY_ACCOUNTS_AREA_ID, 's-notebook', '2027-08')).toEqual({ ok: false, error: NOT_AVAILABLE })
    expect(refused('outra', 's-academia', '2026-11')).toEqual({
      ok: false,
      error: 'A área desta conta não foi encontrada.',
    })
    expect(refused(HOME_AREA_ID, 's-nada', '2026-11')).toEqual({
      ok: false,
      error: 'A conta recorrente ou parcelada não foi encontrada.',
    })
    expect(refused(HOME_AREA_ID, 's-academia', '2026-13')).toEqual({
      ok: false,
      error: 'O mês da conta é inválido.',
    })
  })

  it('respeita o limite global de contas sem gravar nada', () => {
    const data = makeData({ series: [academia()] }, { bills: filler(MAX_BILLS) })
    expect(payProjectedOccurrence(data, HOME_AREA_ID, 's-academia', '2026-11')).toEqual({
      ok: false,
      error: OCCURRENCE_LIMIT_MESSAGE,
    })
    const almost = makeData({ series: [academia()] }, { bills: filler(MAX_BILLS - 1) })
    expect(totalBills(okData(payProjectedOccurrence(almost, HOME_AREA_ID, 's-academia', '2026-11')))).toBe(
      MAX_BILLS,
    )
  })
})

describe('excluir uma ocorrência (deleteOccurrence)', () => {
  it('gravada pendente: remove o registro e grava a exclusão; o mês não volta', () => {
    const series = academia()
    const data = makeData({ series: [series], bills: [occurrence(series, '2026-10')] })
    const deleted = okData(deleteOccurrence(data, HOME_AREA_ID, 's-academia', '2026-10'))
    expect(home(deleted).bills).toEqual([])
    expect(home(deleted).series[0].skippedMonths).toEqual(['2026-10'])
    expect(home(deleted).series[0].versions).toBe(series.versions)
    expect(projectedBillsForMonth(home(deleted), '2026-10')).toEqual([])
    expect(materializeDue(deleted, OCTOBER).data).toBe(deleted)
    expect(materializeDue(deleted, { month: '2027-01', day: 1 }).created).toBe(3)
    expectValid(deleted)
  })

  it('prevista: só grava a exclusão, e ela não é criada quando o mês chega', () => {
    const data = makeData({ series: [academia()] })
    const deleted = okData(deleteOccurrence(data, HOME_AREA_ID, 's-academia', '2026-12'))
    expect(home(deleted).bills).toEqual([])
    expect(home(deleted).series[0].skippedMonths).toEqual(['2026-12'])
    expect(projectedBillsForMonth(home(deleted), '2026-12')).toEqual([])
    const december = materializeDue(deleted, { month: '2026-12', day: 1 }, idGenerator())
    expect(home(december.data).bills.map((bill) => bill.month)).toEqual(['2026-10', '2026-11'])
    expectValid(deleted)
  })

  it('não exclui ocorrência paga; depois de marcada como pendente, exclui', () => {
    const series = academia()
    const paid = occurrence(series, '2026-10', { paid: true })
    const data = makeData({ series: [series], bills: [paid] })
    const before = JSON.stringify(data)
    expect(deleteOccurrence(data, HOME_AREA_ID, 's-academia', '2026-10')).toEqual({
      ok: false,
      error: PAID_OCCURRENCE_DELETE_MESSAGE,
    })
    expect(JSON.stringify(data)).toBe(before)

    const pending = makeData({ series: [series], bills: [{ ...paid, paid: false }] })
    const deleted = okData(deleteOccurrence(pending, HOME_AREA_ID, 's-academia', '2026-10'))
    expect(home(deleted).bills).toEqual([])
  })

  it('excluir de novo o mesmo mês não muda nada', () => {
    const data = makeData({ series: [academia()] })
    const once = okData(deleteOccurrence(data, HOME_AREA_ID, 's-academia', '2026-12'))
    expect(okData(deleteOccurrence(once, HOME_AREA_ID, 's-academia', '2026-12'))).toBe(once)
  })

  it('parcela 4 de 10: as outras mantêm a numeração original', () => {
    const series = notebook()
    const data = makeData(
      {},
      {
        series: [series],
        bills: ['2026-10', '2026-11', '2026-12'].map((month) => occurrence(series, month, { paid: true })),
      },
    )
    const deleted = okData(deleteOccurrence(data, MY_ACCOUNTS_AREA_ID, 's-notebook', '2027-01'))
    expect(projectedBillsForMonth(mine(deleted), '2027-01')).toEqual([])
    const fifth = projectedBillsForMonth(mine(deleted), '2027-02')[0]
    expect(fifth.installmentNumber).toBe(5)
    expect(seriesLabelFor(fifth, mine(deleted).series)).toBe('Parcela 5/10')
    // A quantidade não muda: a 10ª continua prevista e não há 11ª.
    expect(projectedBillsForMonth(mine(deleted), '2027-07')[0].installmentNumber).toBe(10)
    expect(projectedBillsForMonth(mine(deleted), '2027-08')).toEqual([])
    const march = materializeDue(deleted, { month: '2027-03', day: 1 }, idGenerator())
    expect(mine(march.data).bills.map((bill) => bill.installmentNumber)).toEqual([1, 2, 3, 5, 6])
    expectValid(march.data)
  })

  it('recorrente encerrada: ocorrência mantida depois do fim só tem o registro removido', () => {
    const series = academia({ lastMonth: '2026-11', versions: [academia().versions[0]] })
    const kept = occurrence(series, '2027-01')
    const data = makeData({ series: [series], bills: [kept] })
    expectValid(data)
    const deleted = okData(deleteOccurrence(data, HOME_AREA_ID, 's-academia', '2027-01'))
    expect(home(deleted).bills).toEqual([])
    expect(home(deleted).series[0]).toBe(series)
    expectValid(deleted)
    // Depois do fim não há prevista para excluir.
    expect(deleteOccurrence(data, HOME_AREA_ID, 's-academia', '2027-02')).toEqual({
      ok: false,
      error: 'Esta conta não faz parte da série neste mês.',
    })
    // Até o último mês, a exclusão é gravada normalmente.
    const lastMonth = okData(deleteOccurrence(data, HOME_AREA_ID, 's-academia', '2026-11'))
    expect(home(lastMonth).series[0].skippedMonths).toEqual(['2026-11'])
    expectValid(lastMonth)
  })

  it('aceita excluir a primeira ocorrência e parcela gravada além da quantidade', () => {
    const series = notebook({ installmentCount: 2 })
    const first = occurrence(series, '2026-10')
    // 3ª parcela gravada, mas a compra tem 2: válida (ex.: dados de um backup).
    const extra = { ...occurrence(notebook(), '2026-12'), id: 'extra' }
    const data = makeData({}, { series: [series], bills: [first, extra] })
    expectValid(data)
    const withoutFirst = okData(deleteOccurrence(data, MY_ACCOUNTS_AREA_ID, 's-notebook', '2026-10'))
    expect(mine(withoutFirst).series[0].skippedMonths).toEqual(['2026-10'])
    expectValid(withoutFirst)
    // A parcela além da quantidade também ganha a exclusão, para não voltar se a compra aumentar.
    const withoutExtra = okData(deleteOccurrence(withoutFirst, MY_ACCOUNTS_AREA_ID, 's-notebook', '2026-12'))
    expect(mine(withoutExtra).series[0].skippedMonths).toEqual(['2026-10', '2026-12'])
    expect(mine(withoutExtra).bills).toEqual([])
    expectValid(withoutExtra)
    // Prevista além da quantidade não existe.
    expect(deleteOccurrence(data, MY_ACCOUNTS_AREA_ID, 's-notebook', '2027-01').ok).toBe(false)
  })

  it('recusa dados inexistentes', () => {
    const data = makeData({ series: [academia()] })
    expect(deleteOccurrence(data, 'outra', 's-academia', '2026-11').ok).toBe(false)
    expect(deleteOccurrence(data, HOME_AREA_ID, 's-nada', '2026-11').ok).toBe(false)
    expect(deleteOccurrence(data, HOME_AREA_ID, 's-academia', '2026-1').ok).toBe(false)
    expect(deleteOccurrence(data, HOME_AREA_ID, 's-academia', '2026-09').ok).toBe(false)
  })
})

describe('editar "só esta" ocorrência (editOccurrence)', () => {
  const input = (changes: Partial<OccurrenceInput> = {}): OccurrenceInput => ({
    name: 'Academia',
    totalCents: 10000,
    dueDay: 10,
    shares: [
      { memberId: 'h1', amountCents: 5000 },
      { memberId: 'h2', amountCents: 5000 },
    ],
    paid: false,
    ...changes,
  })

  it('gravada pendente: só ela muda e fica marcada como editada', () => {
    const series = academia()
    const october = occurrence(series, '2026-10')
    const data = makeData({ series: [series], bills: [october] })
    const shares = [
      { memberId: 'h1', amountCents: 9000 },
      { memberId: 'h2', amountCents: 6000 },
    ]
    const edited = okData(
      editOccurrence(data, HOME_AREA_ID, 's-academia', '2026-10', input({ totalCents: 15000, shares })),
    )
    expect(home(edited).bills).toEqual([{ ...october, totalCents: 15000, shares, overridden: true }])
    expect(home(edited).series).toBe(home(data).series)
    expect(projectedBillsForMonth(home(edited), '2026-11')[0].totalCents).toBe(10000)
    expectValid(edited)
  })

  it('paga: corrige os dados sem mexer no pagamento nem na série', () => {
    const series = academia()
    const paid = occurrence(series, '2026-10', { paid: true })
    const data = makeData({ series: [series], bills: [paid] })
    const edited = okData(
      editOccurrence(
        data,
        HOME_AREA_ID,
        's-academia',
        '2026-10',
        input({ name: 'Academia (ajuste)', dueDay: 12, paid: true }),
      ),
    )
    expect(home(edited).bills[0]).toEqual({
      ...paid,
      name: 'Academia (ajuste)',
      dueDay: 12,
      overridden: true,
    })
    expect(home(edited).series).toBe(home(data).series)
  })

  it('prevista: grava a ocorrência editada, com a numeração da parcela', () => {
    const data = makeData({}, { series: [notebook()] })
    const edited = okData(
      editOccurrence(
        data,
        MY_ACCOUNTS_AREA_ID,
        's-notebook',
        '2027-01',
        {
          name: 'Notebook',
          totalCents: 30000,
          dueDay: 15,
          shares: [{ memberId: 'h1', amountCents: 30000 }],
          paid: false,
        },
        idGenerator(),
      ),
    )
    expect(mine(edited).bills).toEqual([
      {
        id: 'id-1',
        name: 'Notebook',
        month: '2027-01',
        totalCents: 30000,
        dueDay: 15,
        // Área individual: sem divisão.
        shares: [],
        paid: false,
        seriesId: 's-notebook',
        installmentNumber: 4,
        overridden: true,
      },
    ])
    expect(projectedBillsForMonth(mine(edited), '2027-01')).toEqual([])
    expect(materializeDue(edited, { month: '2027-01', day: 1 }).created).toBe(3)
    expectValid(edited)
  })

  it('mudar só o pagamento não marca como editada; sem mudança, nada muda', () => {
    const series = academia()
    const october = occurrence(series, '2026-10')
    const data = makeData({ series: [series], bills: [october] })
    const paidOnly = okData(
      editOccurrence(data, HOME_AREA_ID, 's-academia', '2026-10', input({ paid: true })),
    )
    expect(home(paidOnly).bills).toEqual([{ ...october, paid: true }])
    expect(okData(editOccurrence(data, HOME_AREA_ID, 's-academia', '2026-10', input()))).toBe(data)
    // Prevista sem mudança continua prevista.
    expect(okData(editOccurrence(data, HOME_AREA_ID, 's-academia', '2026-11', input()))).toBe(data)
    // Prevista paga pelo formulário, sem outra mudança: igual a pagar a prevista.
    const paidProjected = okData(
      editOccurrence(data, HOME_AREA_ID, 's-academia', '2026-11', input({ paid: true }), idGenerator()),
    )
    const november = findOccurrence(home(paidProjected), 's-academia', '2026-11')
    expect(november?.paid).toBe(true)
    expect(november?.overridden).toBeUndefined()
    // Já editada antes: continua marcada mesmo quando muda só o pagamento.
    const overridden = makeData({ series: [series], bills: [{ ...october, overridden: true }] })
    const again = okData(
      editOccurrence(overridden, HOME_AREA_ID, 's-academia', '2026-10', input({ paid: true })),
    )
    expect(home(again).bills[0].overridden).toBe(true)
  })

  it('valida nome, valor, vencimento e divisão com as regras do validador', () => {
    const series = academia()
    const data = makeData({ series: [series], bills: [occurrence(series, '2026-10')] })
    const edit = (changes: Partial<OccurrenceInput>) =>
      editOccurrence(data, HOME_AREA_ID, 's-academia', '2026-10', input(changes))
    expect(edit({ name: '  ' })).toEqual({ ok: false, error: 'Escreva o nome da conta.' })
    expect(edit({ name: 'x'.repeat(41) })).toEqual({
      ok: false,
      error: 'O nome pode ter no máximo 40 letras.',
    })
    expect(edit({ totalCents: 0 })).toEqual({ ok: false, error: 'O valor precisa ser maior que zero.' })
    expect(edit({ dueDay: 32 })).toEqual({
      ok: false,
      error: 'Escolha um dia de vencimento entre 1 e 31.',
    })
    expect(edit({ shares: [] })).toEqual({
      ok: false,
      error: 'Escolha pelo menos uma pessoa para pagar esta conta.',
    })
    expect(edit({ shares: [{ memberId: 'h1', amountCents: 9000 }] })).toEqual({
      ok: false,
      error: 'As partes não somam exatamente o valor da conta.',
    })
    expect(
      edit({
        shares: [
          { memberId: 'h1', amountCents: 5000 },
          { memberId: 'h1', amountCents: 5000 },
        ],
      }),
    ).toEqual({ ok: false, error: 'A divisão repete a mesma pessoa.' })
    // Pessoa de fora e desativada que não estava na conta.
    expect(edit({ shares: [{ memberId: 'zz', amountCents: 10000 }] })).toEqual({
      ok: false,
      error: 'A divisão inclui alguém que não participa desta área.',
    })
    expect(edit({ shares: [{ memberId: 'h3', amountCents: 10000 }] })).toEqual({
      ok: false,
      error: INACTIVE_IN_SHARES_MESSAGE,
    })
  })

  it('aceita participante desativado que já estava na ocorrência', () => {
    const series = academia()
    const withInactive = occurrence(series, '2026-10', {
      shares: [
        { memberId: 'h1', amountCents: 5000 },
        { memberId: 'h3', amountCents: 5000 },
      ],
    })
    const data = makeData({ series: [series], bills: [withInactive] })
    expectValid(data)
    const edited = okData(
      editOccurrence(data, HOME_AREA_ID, 's-academia', '2026-10', {
        name: 'Academia',
        totalCents: 10000,
        dueDay: 20,
        shares: withInactive.shares,
        paid: false,
      }),
    )
    expect(home(edited).bills[0].dueDay).toBe(20)
    expectValid(edited)
  })

  it('não grava prevista editada além do limite nem fora da série', () => {
    const data = makeData(
      { series: [academia({ skippedMonths: ['2026-12'] })] },
      { bills: filler(MAX_BILLS) },
    )
    const changed = input({ totalCents: 9000, shares: [{ memberId: 'h1', amountCents: 9000 }] })
    expect(editOccurrence(data, HOME_AREA_ID, 's-academia', '2026-11', changed)).toEqual({
      ok: false,
      error: OCCURRENCE_LIMIT_MESSAGE,
    })
    expect(editOccurrence(data, HOME_AREA_ID, 's-academia', '2026-12', input())).toEqual({
      ok: false,
      error: NOT_AVAILABLE,
    })
  })
})

describe('pendências do aviso de limite (stillPending)', () => {
  const august = academia({
    startMonth: '2026-08',
    versions: [{ ...academia().versions[0], fromMonth: '2026-08' }],
  })

  it('a gravação recusada lista exatamente as ocorrências que faltavam', () => {
    const data = makeData({ series: [august] }, { bills: filler(MAX_BILLS - 1) })
    const result = materializeDue(data, OCTOBER, idGenerator())
    expect(result.limitExceeded).toBe(true)
    expect(result.pending).toEqual(
      ['2026-08', '2026-09', '2026-10'].map((month) => ({
        areaId: HOME_AREA_ID,
        seriesId: 's-academia',
        month,
      })),
    )
    // Sem limite atingido, não há lista.
    expect(materializeDue(makeData({ series: [august] }), OCTOBER).pending).toBeUndefined()
  })

  it('desconta as gravadas (pagas ou editadas) e as excluídas, sem nova tentativa', () => {
    const data = makeData({ series: [august] }, { bills: filler(MAX_BILLS - 1) })
    const pending = materializeDue(data, OCTOBER).pending ?? []
    expect(stillPending(data, pending)).toHaveLength(3)

    // Agosto excluído; setembro pago (o limite deixa gravar uma conta).
    const deleted = okData(deleteOccurrence(data, HOME_AREA_ID, 's-academia', '2026-08'))
    const paid = okData(payProjectedOccurrence(deleted, HOME_AREA_ID, 's-academia', '2026-09'))
    expect(totalBills(paid)).toBe(MAX_BILLS)
    expect(stillPending(paid, pending)).toEqual([
      { areaId: HOME_AREA_ID, seriesId: 's-academia', month: '2026-10' },
    ])
    // Liberar uma conta basta: total + pendentes chega exatamente ao limite.
    const freed: FinanceData = {
      ...paid,
      areas: [paid.areas[0], { ...paid.areas[1], bills: paid.areas[1].bills.slice(1) }],
    }
    expect(totalBills(freed) + stillPending(freed, pending).length).toBe(MAX_BILLS)
    const materialized = materializeDue(freed, OCTOBER, idGenerator())
    expect(materialized.created).toBe(1)
    expect(materialized.limitExceeded).toBe(false)
  })

  it('desconta ocorrências cuja série, área ou período mudaram', () => {
    const data = makeData({ series: [august] })
    const pending = ['2026-08', '2026-09', '2026-10'].map((month) => ({
      areaId: HOME_AREA_ID,
      seriesId: 's-academia',
      month,
    }))
    const ended = makeData({ series: [{ ...august, lastMonth: '2026-08' }] })
    expect(stillPending(ended, pending).map((item) => item.month)).toEqual(['2026-08'])
    expect(stillPending(makeData(), pending)).toEqual([])
    expect(stillPending({ ...data, areas: [data.areas[1]] }, pending)).toEqual([])
    expect(stillPending(data, [])).toEqual([])
  })
})

describe('exclusões permanentes: casos-limite da regra especial', () => {
  it('parcela gravada além da 120ª posição: só remove o registro, sem exclusão permanente', () => {
    // Defensivo: o validador já recusa esse dado (parcela acima de 120), então ele só
    // existiria em memória. A função não pode gravar uma exclusão que o validador recusa.
    const series = notebook({ installmentCount: 2 })
    const beyond: Bill = {
      ...occurrence(series, '2026-10'),
      id: 'alem',
      month: monthFromIndex(monthIndex('2026-10') + 120),
      installmentNumber: 121,
    }
    const data = makeData({}, { series: [series], bills: [beyond] })
    expect(parseStoredData(JSON.stringify(data)).ok).toBe(false)

    const deleted = okData(deleteOccurrence(data, MY_ACCOUNTS_AREA_ID, 's-notebook', beyond.month))
    expect(mine(deleted).bills).toEqual([])
    expect(mine(deleted).series[0]).toBe(series)
    expect(mine(deleted).series[0].skippedMonths).toEqual([])
    expectValid(deleted)

    // Na 120ª posição a exclusão ainda é gravada (é o limite aceito pelo validador).
    const at120 = { ...beyond, id: 'p120', month: monthFromIndex(monthIndex('2026-10') + 119), installmentNumber: 120 }
    const valid120 = makeData({}, { series: [series], bills: [at120] })
    expectValid(valid120)
    const deleted120 = okData(deleteOccurrence(valid120, MY_ACCOUNTS_AREA_ID, 's-notebook', at120.month))
    expect(mine(deleted120).series[0].skippedMonths).toEqual([at120.month])
    expectValid(deleted120)

    // Sem registro, além da 120ª posição não há o que excluir.
    expect(deleteOccurrence(valid120, MY_ACCOUNTS_AREA_ID, 's-notebook', beyond.month)).toEqual({
      ok: false,
      error: 'Esta conta não faz parte da série neste mês.',
    })
  })

  it('não exclui ocorrência paga mantida depois do fim de uma recorrente encerrada', () => {
    const series = academia({ lastMonth: '2026-11', versions: [academia().versions[0]] })
    const paidAfterEnd = occurrence(series, '2027-01', { paid: true })
    const data = makeData({ series: [series], bills: [paidAfterEnd] })
    expectValid(data)
    const before = JSON.stringify(data)
    expect(deleteOccurrence(data, HOME_AREA_ID, 's-academia', '2027-01')).toEqual({
      ok: false,
      error: PAID_OCCURRENCE_DELETE_MESSAGE,
    })
    expect(JSON.stringify(data)).toBe(before)
  })
})

/* ---------- Etapa 6: "esta e as seguintes" ---------- */

describe('"esta e as seguintes" (planSeriesEdit / applySeriesEdit)', () => {
  /** Academia só com a primeira versão (R$ 100,00, 50/50). */
  const simple = () => academia({ versions: [academia().versions[0]] })
  const to120: SeriesEditInput = {
    name: 'Academia',
    totalCents: 12000,
    dueDay: 10,
    shares: [
      { memberId: 'h1', amountCents: 6000 },
      { memberId: 'h2', amountCents: 6000 },
    ],
  }
  const plan = (data: FinanceData, month: string, input = to120, areaId = HOME_AREA_ID, id = 's-academia') => {
    const result = planSeriesEdit(data, areaId, id, month, input)
    if (!result.ok) throw new Error(result.error)
    return result.plan
  }

  it('ocorrência pendente: vale do próprio mês; no início, a nova versão vira a primeira', () => {
    const series = simple()
    const october = occurrence(series, '2026-10')
    const data = makeData({ series: [series], bills: [october] })
    expect(plan(data, '2026-10')).toEqual({
      effectiveMonth: '2026-10',
      selectedPaid: false,
      replacedVersionMonths: [],
      updatedCount: 1,
      overriddenCount: 0,
      paidKeptCount: 0,
      hasChanges: true,
      baseline: seriesDataAt(series, '2026-10'),
      selectedOverridden: false,
      selectedOutcome: 'follows',
      updatedMonths: [],
      overriddenMonths: [],
      paidKeptMonths: [],
      projectedChangedMonths: [],
      projectedChangesFrom: '2026-11',
    })
    const edited = okData(applySeriesEdit(data, HOME_AREA_ID, 's-academia', '2026-10', to120, null))
    expect(home(edited).series[0].versions).toEqual([{ fromMonth: '2026-10', ...to120 }])
    expect(home(edited).bills).toEqual([{ ...october, totalCents: 12000, shares: to120.shares }])
    expect(projectedBillsForMonth(home(edited), '2026-11')[0].totalCents).toBe(12000)
    expectValid(edited)
  })

  it('exemplo da academia: outubro pago fica igual, vale de novembro, dezembro pago adiantado fica', () => {
    const series = simple()
    const october = occurrence(series, '2026-10', { paid: true })
    const november = occurrence(series, '2026-11')
    const december = occurrence(series, '2026-12', { paid: true })
    const data = makeData({ series: [series], bills: [october, november, december] })
    expect(plan(data, '2026-10')).toEqual({
      effectiveMonth: '2026-11',
      selectedPaid: true,
      replacedVersionMonths: [],
      updatedCount: 1,
      overriddenCount: 0,
      paidKeptCount: 1,
      hasChanges: true,
      baseline: seriesDataAt(series, '2026-11'),
      selectedOverridden: false,
      selectedOutcome: 'paid',
      updatedMonths: ['2026-11'],
      overriddenMonths: [],
      paidKeptMonths: ['2026-12'],
      projectedChangedMonths: [],
      projectedChangesFrom: '2027-01',
    })
    const edited = okData(applySeriesEdit(data, HOME_AREA_ID, 's-academia', '2026-10', to120, null))
    expect(home(edited).series[0].versions).toEqual([series.versions[0], { fromMonth: '2026-11', ...to120 }])
    const [oct, nov, dec] = home(edited).bills
    expect(oct).toBe(october)
    expect(nov).toEqual({ ...november, totalCents: 12000, shares: to120.shares })
    expect(dec).toBe(december)
    expect(projectedBillsForMonth(home(edited), '2027-01')[0].totalCents).toBe(12000)
    const january = materializeDue(edited, { month: '2027-01', day: 1 }, idGenerator())
    expect(findOccurrence(home(january.data), 's-academia', '2027-01')?.totalCents).toBe(12000)
    expectValid(edited)
  })

  it('a partir de uma prevista: substitui as alterações programadas depois e avisa os meses', () => {
    // academia(): R$ 100,00 desde outubro e R$ 120,00 programado para janeiro.
    const data = makeData({ series: [academia()] })
    const input = { ...to120, totalCents: 11000, shares: [{ memberId: 'h1', amountCents: 11000 }] }
    expect(plan(data, '2026-12', input)).toMatchObject({
      effectiveMonth: '2026-12',
      replacedVersionMonths: ['2027-01'],
      updatedCount: 0,
      hasChanges: true,
    })
    const edited = okData(applySeriesEdit(data, HOME_AREA_ID, 's-academia', '2026-12', input, null))
    expect(home(edited).series[0].versions).toEqual([
      academia().versions[0],
      { fromMonth: '2026-12', ...input },
    ])
    // Nenhum registro é criado: a prevista só passa a mostrar os novos dados.
    expect(home(edited).bills).toEqual([])
    expect(projectedBillsForMonth(home(edited), '2027-02')[0].totalCents).toBe(11000)
    expectValid(edited)
  })

  it('vigência igual a uma alteração já programada: ela é trocada pela nova', () => {
    const data = makeData({ series: [academia()] })
    const input = { ...to120, dueDay: 20 }
    expect(plan(data, '2027-01', input).replacedVersionMonths).toEqual([])
    const edited = okData(applySeriesEdit(data, HOME_AREA_ID, 's-academia', '2027-01', input, null))
    expect(home(edited).series[0].versions).toEqual([
      academia().versions[0],
      { fromMonth: '2027-01', ...input },
    ])
    expectValid(edited)
  })

  it('fica indisponível quando não há contas seguintes', () => {
    // Última parcela paga.
    const installments = notebook({ installmentCount: 2 })
    const last = occurrence(installments, '2026-11', { paid: true })
    const parcel = makeData({}, { series: [installments], bills: [last] })
    const input = { ...to120, shares: [] }
    expect(planSeriesEdit(parcel, MY_ACCOUNTS_AREA_ID, 's-notebook', '2026-11', input)).toEqual({
      ok: false,
      error: SERIES_EDIT_UNAVAILABLE_MESSAGE,
    })
    // Ocorrência mantida depois do encerramento.
    const ended = academia({ lastMonth: '2026-11', versions: [academia().versions[0]] })
    const kept = makeData({ series: [ended], bills: [occurrence(ended, '2027-01')] })
    expect(applySeriesEdit(kept, HOME_AREA_ID, 's-academia', '2027-01', to120, null)).toEqual({
      ok: false,
      error: SERIES_EDIT_UNAVAILABLE_MESSAGE,
    })
    // Prevista de um mês excluído não existe.
    const skipped = makeData({ series: [simple()] })
    const withSkip = okData(deleteOccurrence(skipped, HOME_AREA_ID, 's-academia', '2026-12'))
    expect(planSeriesEdit(withSkip, HOME_AREA_ID, 's-academia', '2026-12', to120)).toEqual({
      ok: false,
      error: NOT_AVAILABLE,
    })
  })

  it('recorrente encerrada: nenhuma versão depois do fim e as mantidas depois do fim não mudam', () => {
    const ended = academia({ lastMonth: '2026-12', versions: [academia().versions[0]] })
    const keptAfterEnd = occurrence(ended, '2027-01')
    const november = occurrence(ended, '2026-11')
    const data = makeData({ series: [ended], bills: [november, keptAfterEnd] })
    expectValid(data)
    const edited = okData(applySeriesEdit(data, HOME_AREA_ID, 's-academia', '2026-11', to120, null))
    expect(home(edited).series[0].versions.map((version) => version.fromMonth)).toEqual([
      '2026-10',
      '2026-11',
    ])
    expect(home(edited).series[0].lastMonth).toBe('2026-12')
    expect(home(edited).bills[1]).toBe(keptAfterEnd)
    expectValid(edited)
  })

  it('editadas individualmente: escolha explícita para as outras; a escolhida é atualizada', () => {
    const series = simple()
    const october = occurrence(series, '2026-10', { name: 'Academia (out)', overridden: true })
    const november = occurrence(series, '2026-11', { totalCents: 9000, shares: [{ memberId: 'h1', amountCents: 9000 }], overridden: true })
    const december = occurrence(series, '2026-12', { dueDay: 25, overridden: true })
    const data = makeData({ series: [series], bills: [october, november, december] })
    expect(plan(data, '2026-10')).toMatchObject({ updatedCount: 1, overriddenCount: 2 })
    expect(applySeriesEdit(data, HOME_AREA_ID, 's-academia', '2026-10', to120, null)).toEqual({
      ok: false,
      error: OVERRIDDEN_CHOICE_MESSAGE,
    })

    const preserved = okData(applySeriesEdit(data, HOME_AREA_ID, 's-academia', '2026-10', to120, 'preserve'))
    const expectedOctober = { ...october, name: 'Academia', totalCents: 12000, shares: to120.shares }
    delete (expectedOctober as Partial<Bill>).overridden
    expect(home(preserved).bills).toEqual([expectedOctober, november, december])
    expect(home(preserved).bills[1]).toBe(november)
    expectValid(preserved)

    const replaced = okData(applySeriesEdit(data, HOME_AREA_ID, 's-academia', '2026-10', to120, 'replace'))
    for (const bill of home(replaced).bills) {
      expect(bill).toMatchObject({ name: 'Academia', totalCents: 12000, dueDay: 10, shares: to120.shares })
      expect(bill.overridden).toBeUndefined()
    }
    expectValid(replaced)
  })

  it('parcelada: novo valor nas próximas, sem mudar numeração, exclusões, início ou quantidade', () => {
    const series = notebook({ skippedMonths: ['2027-01'] })
    const first = occurrence(series, '2026-10', { paid: true })
    const second = occurrence(series, '2026-11')
    const data = makeData({}, { series: [series], bills: [first, second] })
    const input: SeriesEditInput = { name: 'Notebook', totalCents: 30000, dueDay: 15, shares: [] }
    const edited = okData(applySeriesEdit(data, MY_ACCOUNTS_AREA_ID, 's-notebook', '2026-11', input, null))
    const editedSeries = mine(edited).series[0]
    expect(editedSeries.startMonth).toBe(series.startMonth)
    expect(editedSeries.installmentCount).toBe(10)
    expect(editedSeries.skippedMonths).toEqual(['2027-01'])
    expect(mine(edited).bills[0]).toBe(first)
    expect(mine(edited).bills[1]).toEqual({ ...second, totalCents: 30000 })
    expect(projectedBillsForMonth(mine(edited), '2027-01')).toEqual([])
    const fifth = projectedBillsForMonth(mine(edited), '2027-02')[0]
    expect([fifth.installmentNumber, fifth.totalCents]).toEqual([5, 30000])
    expect(totalBills(edited)).toBe(totalBills(data))
    expectValid(edited)
  })

  it('valida os dados; a divisão da nova versão usa só participantes ativos', () => {
    const series = simple()
    // Caio (desativado) já está nesta ocorrência: no "só esta" seria aceito, aqui não.
    const october = occurrence(series, '2026-10', {
      shares: [
        { memberId: 'h1', amountCents: 5000 },
        { memberId: 'h3', amountCents: 5000 },
      ],
    })
    const data = makeData({ series: [series], bills: [october] })
    const edit = (changes: Partial<SeriesEditInput>) =>
      applySeriesEdit(data, HOME_AREA_ID, 's-academia', '2026-10', { ...to120, ...changes }, null)
    expect(edit({ shares: october.shares, totalCents: 10000 })).toEqual({
      ok: false,
      error: INACTIVE_IN_SHARES_MESSAGE,
    })
    expect(edit({ name: '' })).toEqual({ ok: false, error: 'Escreva o nome da conta.' })
    expect(edit({ totalCents: 0 })).toEqual({ ok: false, error: 'O valor precisa ser maior que zero.' })
    expect(edit({ dueDay: 0 })).toEqual({ ok: false, error: 'Escolha um dia de vencimento entre 1 e 31.' })
    expect(edit({ shares: [{ memberId: 'h1', amountCents: 100 }] })).toEqual({
      ok: false,
      error: 'As partes não somam exatamente o valor da conta.',
    })
    expect(applySeriesEdit(data, 'outra', 's-academia', '2026-10', to120, null).ok).toBe(false)
    expect(applySeriesEdit(data, HOME_AREA_ID, 's-nada', '2026-10', to120, null).ok).toBe(false)
    // Área individual: a divisão enviada é ignorada.
    const individual = makeData({}, { series: [notebook()] })
    const edited = okData(
      applySeriesEdit(individual, MY_ACCOUNTS_AREA_ID, 's-notebook', '2026-12', { ...to120, shares: to120.shares }, null),
    )
    expect(mine(edited).series[0].versions[1].shares).toEqual([])
    expectValid(edited)
  })

  it('sem mudança: o resumo indica e os dados ficam os mesmos', () => {
    const series = simple()
    const data = makeData({ series: [series], bills: [occurrence(series, '2026-10')] })
    const same: SeriesEditInput = {
      name: 'Academia',
      totalCents: 10000,
      dueDay: 10,
      shares: series.versions[0].shares,
    }
    expect(plan(data, '2026-10', same).hasChanges).toBe(false)
    expect(okData(applySeriesEdit(data, HOME_AREA_ID, 's-academia', '2026-10', same, null))).toBe(data)
  })

  it('o resumo não altera os dados e a aplicação revalida com os dados atuais', () => {
    const series = simple()
    const november = occurrence(series, '2026-11')
    const data = makeData({ series: [series], bills: [occurrence(series, '2026-10'), november] })
    const before = JSON.stringify(data)
    expect(plan(data, '2026-10').updatedCount).toBe(2)
    expect(JSON.stringify(data)).toBe(before)
    // Entre a confirmação e a aplicação, novembro foi pago: continua intacto.
    const changed = makeData({ series: [series], bills: [occurrence(series, '2026-10'), { ...november, paid: true }] })
    const edited = okData(applySeriesEdit(changed, HOME_AREA_ID, 's-academia', '2026-10', to120, null))
    expect(home(edited).bills[1]).toBe(home(changed).bills[1])
    // E se a série não existir mais, nada é aplicado.
    expect(applySeriesEdit(makeData(), HOME_AREA_ID, 's-academia', '2026-10', to120, null)).toEqual({
      ok: false,
      error: 'A conta recorrente ou parcelada não foi encontrada.',
    })
  })
})

/* ---------- Etapa 7: encerramento de recorrência ---------- */

describe('encerramento de recorrência (planEndSeries / applyEndSeries)', () => {
  /** Academia desde agosto, com R$ 120,00 programado para janeiro. */
  const fromAugust = () =>
    academia({
      startMonth: '2026-08',
      versions: [{ ...academia().versions[0], fromMonth: '2026-08' }, academia().versions[1]],
    })
  const endPlan = (data: FinanceData, lastMonth: string) => {
    const result = planEndSeries(data, HOME_AREA_ID, 's-academia', lastMonth, OCTOBER)
    if (!result.ok) throw new Error(result.error)
    return result.plan
  }
  const end = (data: FinanceData, lastMonth: string, choice: 'keep' | 'delete' | null) =>
    applyEndSeries(data, HOME_AREA_ID, 's-academia', lastMonth, OCTOBER, choice)

  it('exemplo: em outubro, encerrar em agosto lista setembro e outubro pendentes', () => {
    const series = fromAugust()
    const august = occurrence(series, '2026-08', { paid: true })
    const september = occurrence(series, '2026-09')
    const october = occurrence(series, '2026-10')
    const data = makeData({ series: [series], bills: [august, september, october] })
    expect(endPlan(data, '2026-08')).toEqual({
      lastMonth: '2026-08',
      pendingAfter: [
        { month: '2026-09', totalCents: 10000 },
        { month: '2026-10', totalCents: 10000 },
      ],
      paidAfterCount: 0,
      discardedVersionMonths: ['2027-01'],
      discardedSkippedMonths: [],
    })
    expect(end(data, '2026-08', null)).toEqual({ ok: false, error: END_CHOICE_MESSAGE })

    const deleted = okData(end(data, '2026-08', 'delete'))
    expect(home(deleted).bills).toEqual([august])
    expect(home(deleted).series[0]).toEqual({
      ...series,
      lastMonth: '2026-08',
      versions: [series.versions[0]],
      skippedMonths: [],
    })
    expect(projectedBillsForMonth(home(deleted), '2026-11')).toEqual([])
    expect(materializeDue(deleted, { month: '2027-03', day: 1 }).data).toBe(deleted)
    expect(seriesLabelFor(august, home(deleted).series)).toBe('Recorrente até agosto de 2026')
    expectValid(deleted)

    const kept = okData(end(data, '2026-08', 'keep'))
    expect(home(kept).bills).toEqual([august, september, october])
    expectValid(kept)
  })

  it('contas pagas depois do último mês nunca são excluídas', () => {
    const series = fromAugust()
    const september = occurrence(series, '2026-09', { paid: true })
    const october = occurrence(series, '2026-10')
    const data = makeData({ series: [series], bills: [september, october] })
    expect(endPlan(data, '2026-08')).toMatchObject({
      pendingAfter: [{ month: '2026-10', totalCents: 10000 }],
      paidAfterCount: 1,
    })
    const deleted = okData(end(data, '2026-08', 'delete'))
    expect(home(deleted).bills).toEqual([september])
    expectValid(deleted)
  })

  it('fim num mês futuro: previstas até ele e nenhuma depois; sem pendentes, sem escolha', () => {
    const series = fromAugust()
    const data = makeData({ series: [series] })
    const plan = endPlan(data, '2026-12')
    expect(plan.pendingAfter).toEqual([])
    const ended = okData(end(data, '2026-12', null))
    expect(projectedBillsForMonth(home(ended), '2026-12')).toHaveLength(1)
    expect(projectedBillsForMonth(home(ended), '2027-01')).toEqual([])
    const later = materializeDue(ended, { month: '2027-02', day: 1 }, idGenerator())
    expect(home(later.data).bills.map((bill) => bill.month)).toEqual([
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ])
    expectValid(later.data)
  })

  it('descarta as exclusões depois do fim e mantém as anteriores', () => {
    const series = academia({ skippedMonths: ['2026-11', '2027-02'] })
    const data = makeData({ series: [series] })
    expect(endPlan(data, '2026-12')).toMatchObject({
      discardedSkippedMonths: ['2027-02'],
      discardedVersionMonths: ['2027-01'],
    })
    const ended = okData(end(data, '2026-12', null))
    expect(home(ended).series[0].skippedMonths).toEqual(['2026-11'])
    expect(home(ended).series[0].versions).toEqual([academia().versions[0]])
    expectValid(ended)
  })

  it('recusa parcelada, série já encerrada (sem reabertura), mês fora do intervalo e dados inexistentes', () => {
    const installment = makeData({}, { series: [notebook()] })
    expect(applyEndSeries(installment, MY_ACCOUNTS_AREA_ID, 's-notebook', '2026-12', OCTOBER, null)).toEqual({
      ok: false,
      error: 'Só contas recorrentes podem ser encerradas.',
    })
    const ended = makeData({ series: [academia({ lastMonth: '2027-03' })] })
    expect(end(ended, '2026-12', null)).toEqual({ ok: false, error: SERIES_ENDED_MESSAGE })
    expect(end(ended, '2027-06', null)).toEqual({ ok: false, error: SERIES_ENDED_MESSAGE })

    const open = makeData({ series: [academia()] })
    const outOfRange = {
      ok: false,
      error: 'Escolha um último mês entre o início da recorrência e cinco anos depois do mês atual.',
    }
    expect(end(open, '2026-09', null)).toEqual(outOfRange)
    expect(end(open, '2031-11', null)).toEqual(outOfRange)
    expect(end(open, '2026-13', null)).toEqual(outOfRange)
    // Exatamente cinco anos depois do mês atual é aceito.
    expectValid(okData(end(open, '2031-10', null)))
    expect(applyEndSeries(open, 'outra', 's-academia', '2026-12', OCTOBER, null).ok).toBe(false)
    expect(applyEndSeries(open, HOME_AREA_ID, 's-nada', '2026-12', OCTOBER, null).ok).toBe(false)
  })

  it('oferece do início da série até cinco anos depois do mês atual', () => {
    const options = endMonthOptions(fromAugust(), OCTOBER)
    expect(options[0]).toBe('2026-08')
    expect(options[options.length - 1]).toBe('2031-10')
    expect(options).toHaveLength(63)
    // Série que começa depois do limite: só o próprio início.
    expect(endMonthOptions(academia({ startMonth: '2032-01' }), OCTOBER)).toEqual(['2032-01'])
  })

  it('o resumo não altera nada e a aplicação revalida com os dados atuais', () => {
    const series = fromAugust()
    const september = occurrence(series, '2026-09')
    const data = makeData({ series: [series], bills: [september] })
    const before = JSON.stringify(data)
    expect(endPlan(data, '2026-08').pendingAfter).toHaveLength(1)
    expect(JSON.stringify(data)).toBe(before)
    // Setembro foi pago entre o resumo e a confirmação: continua guardado.
    const paidMeanwhile = makeData({ series: [series], bills: [{ ...september, paid: true }] })
    const ended = okData(end(paidMeanwhile, '2026-08', 'delete'))
    expect(home(ended).bills).toEqual([{ ...september, paid: true }])
  })

  it('as pendentes do aviso de limite deixam de contar depois do fim', () => {
    const data = makeData({ series: [fromAugust()] })
    const pending = ['2026-08', '2026-09', '2026-10'].map((month) => ({
      areaId: HOME_AREA_ID,
      seriesId: 's-academia',
      month,
    }))
    const ended = okData(end(data, '2026-08', null))
    expect(stillPending(ended, pending).map((item) => item.month)).toEqual(['2026-08'])
  })
})

/* ---------- Etapa 8: quantidade de parcelas ---------- */

describe('quantidade de parcelas (planInstallmentCount / applyInstallmentCount)', () => {
  /** Mês da posição `n` de uma compra que começa em `start`. */
  const at = (start: string, n: number) => monthFromIndex(monthIndex(start) + n - 1)
  const countPlan = (data: FinanceData, count: number, today: Today = OCTOBER) => {
    const result = planInstallmentCount(data, MY_ACCOUNTS_AREA_ID, 's-notebook', count, today)
    if (!result.ok) throw new Error(result.error)
    return result.plan
  }
  const change = (data: FinanceData, count: number, today: Today = OCTOBER) =>
    applyInstallmentCount(data, MY_ACCOUNTS_AREA_ID, 's-notebook', count, today)

  it('não reduz abaixo da maior parcela paga, inclusive paga adiantada, e explica o motivo', () => {
    const series = notebook()
    const paid = [1, 2, 8].map((n) => occurrence(series, at('2026-10', n), { paid: true }))
    const data = makeData({}, { series: [series], bills: paid })
    expect(change(data, 7)).toEqual({
      ok: false,
      error: 'A quantidade mínima é 8, porque a parcela 8 já está paga.',
    })
    expect(countPlan(data, 8).minCount).toBe(8)
    expectValid(okData(change(data, 8)))

    const free = makeData({}, { series: [series] })
    expect(countPlan(free, 2).minCount).toBe(2)
    for (const count of [1, 121, 2.5, Number.NaN]) {
      expect(change(free, count)).toEqual({
        ok: false,
        error: 'A quantidade de parcelas precisa ser de 2 a 120.',
      })
    }
    expectValid(okData(change(free, 120)))
  })

  it('aumentar: meses novos no fim, numeração preservada e exclusões continuam excluídas', () => {
    const series = notebook({ skippedMonths: [at('2026-10', 12)] })
    const data = makeData({}, { series: [series] })
    expect(countPlan(data, 13)).toMatchObject({
      currentCount: 10,
      newCount: 13,
      newLastMonth: at('2026-10', 13),
      addedCount: 2,
      pastCreatedCount: 0,
      removed: [],
      hasChanges: true,
    })
    const increased = okData(change(data, 13))
    expect(mine(increased).series[0].installmentCount).toBe(13)
    expect(mine(increased).series[0].skippedMonths).toEqual([at('2026-10', 12)])
    expect(projectedBillsForMonth(mine(increased), at('2026-10', 11))[0].installmentNumber).toBe(11)
    expect(projectedBillsForMonth(mine(increased), at('2026-10', 12))).toEqual([])
    const last = projectedBillsForMonth(mine(increased), at('2026-10', 13))[0]
    expect(seriesLabelFor(last, mine(increased).series)).toBe('Parcela 13/13')
    expectValid(increased)
  })

  it('aumento que alcança meses passados: informa quantas e a gravação automática as cria uma vez', () => {
    const series = notebook({
      startMonth: '2026-01',
      installmentCount: 3,
      versions: [{ ...notebook().versions[0], fromMonth: '2026-01' }],
    })
    const paid = [1, 2, 3].map((n) => occurrence(series, at('2026-01', n), { paid: true }))
    const data = makeData({}, { series: [series], bills: paid })
    expect(countPlan(data, 12)).toMatchObject({ addedCount: 9, pastCreatedCount: 7 })
    const increased = okData(change(data, 12))
    // A função só muda a quantidade; quem cria as atrasadas é a gravação automática.
    expect(mine(increased).bills).toHaveLength(3)
    const materialized = materializeDue(increased, OCTOBER, idGenerator())
    expect(materialized.created).toBe(7)
    expect(mine(materialized.data).bills.map((bill) => bill.installmentNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ])
    expect(mine(materialized.data).bills.slice(3).every((bill) => !bill.paid)).toBe(true)
    expect(materializeDue(materialized.data, OCTOBER).data).toBe(materialized.data)
    expectValid(materialized.data)
  })

  it('reduzir: remove as pendentes acima do total, mantém pagas e exclusões, descarta versões', () => {
    const base = notebook({
      skippedMonths: [at('2026-10', 7)],
      versions: [
        notebook().versions[0],
        { fromMonth: at('2026-10', 8), name: 'Notebook', totalCents: 30000, dueDay: 15, shares: [] },
      ],
    })
    const first = occurrence(base, at('2026-10', 1), { paid: true })
    const second = occurrence(base, at('2026-10', 2))
    const sixth = occurrence(base, at('2026-10', 6), { overridden: true, totalCents: 20000 })
    const ninth = occurrence(base, at('2026-10', 9))
    const data = makeData({}, { series: [base], bills: [first, second, sixth, ninth] })
    expectValid(data)
    expect(countPlan(data, 5)).toEqual({
      currentCount: 10,
      newCount: 5,
      minCount: 2,
      newLastMonth: at('2026-10', 5),
      addedCount: 0,
      pastCreatedCount: 0,
      removed: [
        { month: at('2026-10', 6), installmentNumber: 6, totalCents: 20000 },
        { month: at('2026-10', 9), installmentNumber: 9, totalCents: 30000 },
      ],
      removedProjectedCount: 2,
      discardedVersionMonths: [at('2026-10', 8)],
      hasChanges: true,
      // I2: só se aplicam ao aumento; na redução ficam vazios (área individual, sem divisão).
      inactiveMemberIds: [],
      needsPayer: false,
      fixesNewInstallments: false,
      redistributesAmongActive: false,
      payerCandidates: [],
      recalculated: [],
    })
    const reduced = okData(change(data, 5))
    expect(mine(reduced).bills).toEqual([first, second])
    expect(mine(reduced).series[0]).toEqual({
      ...base,
      installmentCount: 5,
      versions: [base.versions[0]],
    })
    // A exclusão acima do novo total fica guardada (até a 120ª posição é válida).
    expect(mine(reduced).series[0].skippedMonths).toEqual([at('2026-10', 7)])
    expect(projectedBillsForMonth(mine(reduced), at('2026-10', 6))).toEqual([])
    expectValid(reduced)
  })

  it('reduzir e aumentar de novo: as removidas pela redução voltam; as excluídas, não', () => {
    const series = notebook({ skippedMonths: [at('2026-10', 7)] })
    const sixth = occurrence(series, at('2026-10', 6))
    const data = makeData({}, { series: [series], bills: [sixth] })
    const reduced = okData(change(data, 5))
    expect(countPlan(reduced, 10)).toMatchObject({ addedCount: 4 })
    const increased = okData(change(reduced, 10))
    expect(projectedBillsForMonth(mine(increased), at('2026-10', 6))[0].installmentNumber).toBe(6)
    expect(projectedBillsForMonth(mine(increased), at('2026-10', 7))).toEqual([])
    expectValid(increased)
  })

  it('mesma quantidade não muda nada; recusa recorrente e dados inexistentes', () => {
    const data = makeData({ series: [academia()] }, { series: [notebook()] })
    expect(countPlan(data, 10).hasChanges).toBe(false)
    expect(okData(change(data, 10))).toBe(data)
    expect(applyInstallmentCount(data, HOME_AREA_ID, 's-academia', 5, OCTOBER)).toEqual({
      ok: false,
      error: 'Só contas parceladas têm quantidade de parcelas.',
    })
    expect(applyInstallmentCount(data, 'outra', 's-notebook', 5, OCTOBER).ok).toBe(false)
    expect(applyInstallmentCount(data, MY_ACCOUNTS_AREA_ID, 's-nada', 5, OCTOBER).ok).toBe(false)
  })

  it('o resumo não altera nada e a aplicação revalida o mínimo com os dados atuais', () => {
    const series = notebook()
    const data = makeData({}, { series: [series] })
    const before = JSON.stringify(data)
    expect(countPlan(data, 7).hasChanges).toBe(true)
    expect(JSON.stringify(data)).toBe(before)
    // A parcela 8 foi paga adiantada entre o resumo e a confirmação.
    const paidMeanwhile = makeData({}, { series: [series], bills: [occurrence(series, at('2026-10', 8), { paid: true })] })
    expect(change(paidMeanwhile, 7)).toEqual({
      ok: false,
      error: 'A quantidade mínima é 8, porque a parcela 8 já está paga.',
    })
  })

  it('as pendentes do aviso de limite acima do novo total deixam de contar', () => {
    const series = notebook({
      startMonth: '2026-08',
      installmentCount: 3,
      versions: [{ ...notebook().versions[0], fromMonth: '2026-08' }],
    })
    const data = makeData({}, { series: [series] })
    const pending = ['2026-08', '2026-09', '2026-10'].map((month) => ({
      areaId: MY_ACCOUNTS_AREA_ID,
      seriesId: 's-notebook',
      month,
    }))
    const reduced = okData(change(data, 2))
    expect(stillPending(reduced, pending).map((item) => item.month)).toEqual(['2026-08', '2026-09'])
  })
})

/* ---------- Etapa 9: desativação de participantes ---------- */

describe('desativação de participantes (planMemberDeactivation / applyMemberDeactivation)', () => {
  // Ana, Bia e Duda ativas; Caio já desativado. Hoje: outubro; efeito: novembro.
  const people = [member('h1', 'Ana'), member('h2', 'Bia'), member('h4', 'Duda'), member('h3', 'Caio', true)]
  const recurring = (shares: BillShare[], overrides: Partial<BillSeries> = {}): BillSeries => ({
    id: 's-academia',
    kind: 'recurring',
    startMonth: '2026-10',
    versions: [{ fromMonth: '2026-10', name: 'Academia', totalCents: 10000, dueDay: 10, shares }],
    skippedMonths: [],
    ...overrides,
  })
  const withPeople = (home: Partial<Area>) => makeData({ members: people, ...home })
  const deactivationPlan = (data: FinanceData, memberId = 'h1', protectedId: string | null = null) => {
    const result = planMemberDeactivation(data, HOME_AREA_ID, memberId, OCTOBER, protectedId)
    if (!result.ok) throw new Error(result.error)
    return result.plan
  }
  const deactivate = (data: FinanceData, payers: Record<string, string> = {}, memberId = 'h1') =>
    applyMemberDeactivation(data, HOME_AREA_ID, memberId, OCTOBER, null, payers)
  const sum = (shares: BillShare[]) => shares.reduce((total, share) => total + share.amountCents, 0)

  it('redistribui só entre ativos, com soma exata e centavos na ordem da área', () => {
    const series = recurring([
      { memberId: 'h1', amountCents: 3333 },
      { memberId: 'h4', amountCents: 3333 },
      { memberId: 'h2', amountCents: 3334 },
    ])
    const data = withPeople({ series: [series], bills: [occurrence(series, '2026-10')] })
    const result = okData(deactivate(data))
    const versions = home(result).series[0].versions
    // Outubro (mês atual) fica igual; a nova divisão entra em novembro.
    expect(versions[0]).toBe(series.versions[0])
    expect(versions[1].fromMonth).toBe('2026-11')
    // 3333 centavos para dois: 1666 cada e 1 centavo para Bia, que vem antes de Duda na área.
    expect(versions[1].shares).toEqual([
      { memberId: 'h4', amountCents: 4999 },
      { memberId: 'h2', amountCents: 5001 },
    ])
    expect(sum(versions[1].shares)).toBe(10000)
    expect(home(result).members.find((item) => item.id === 'h1')).toEqual({ ...people[0], inactive: true })
    expectValid(result)
  })

  it('participante já desativado na divisão não recebe a parte', () => {
    const installment: BillSeries = {
      id: 's-tv',
      kind: 'installment',
      startMonth: '2026-10',
      installmentCount: 6,
      versions: [
        {
          fromMonth: '2026-10',
          name: 'TV',
          totalCents: 10000,
          dueDay: 5,
          shares: [
            { memberId: 'h1', amountCents: 5000 },
            { memberId: 'h2', amountCents: 3000 },
            { memberId: 'h3', amountCents: 2000 },
          ],
        },
      ],
      skippedMonths: [],
    }
    const data = withPeople({ series: [installment] })
    expectValid(data)
    const result = okData(deactivate(data))
    expect(home(result).series[0].versions[1].shares).toEqual([
      { memberId: 'h2', amountCents: 8000 },
      { memberId: 'h3', amountCents: 2000 },
    ])
    expectValid(result)
  })

  it('único pagador: a escolha é obrigatória, por série, e precisa ser de um ativo', () => {
    const series = recurring([{ memberId: 'h1', amountCents: 10000 }])
    const data = withPeople({ series: [series] })
    expect(deactivationPlan(data)).toMatchObject({
      effectiveMonth: '2026-11',
      affectedSeries: [{ seriesId: 's-academia', name: 'Academia', needsPayer: true }],
      payerCandidates: ['h2', 'h4'],
    })
    expect(deactivate(data)).toEqual({ ok: false, error: 'Escolha quem assume a conta “Academia”.' })
    expect(deactivate(data, { 's-academia': 'h3' })).toEqual({
      ok: false,
      error: 'O participante escolhido para assumir “Academia” não está mais ativo nesta área.',
    })
    const result = okData(deactivate(data, { 's-academia': 'h4' }))
    expect(home(result).series[0].versions[1].shares).toEqual([{ memberId: 'h4', amountCents: 10000 }])
    expectValid(result)
  })

  it('versões: no mês de efeito e depois são alteradas no lugar; anteriores ficam', () => {
    const shares = (a: number, b: number) => [
      { memberId: 'h1', amountCents: a },
      { memberId: 'h2', amountCents: b },
    ]
    const series = recurring(shares(5000, 5000), {
      startMonth: '2026-09',
      versions: [
        { fromMonth: '2026-09', name: 'Academia', totalCents: 10000, dueDay: 10, shares: shares(5000, 5000) },
        { fromMonth: '2026-11', name: 'Academia', totalCents: 12000, dueDay: 10, shares: shares(6000, 6000) },
        { fromMonth: '2027-02', name: 'Academia', totalCents: 14000, dueDay: 10, shares: shares(7000, 7000) },
      ],
    })
    const data = withPeople({ series: [series] })
    const versions = home(okData(deactivate(data))).series[0].versions
    expect(versions.map((version) => version.fromMonth)).toEqual(['2026-09', '2026-11', '2027-02'])
    expect(versions[0]).toBe(series.versions[0])
    expect(versions[1].shares).toEqual([{ memberId: 'h2', amountCents: 12000 }])
    expect(versions[2].shares).toEqual([{ memberId: 'h2', amountCents: 14000 }])
  })

  it('série que começa depois do mês de efeito: altera no lugar, sem versão antes do início', () => {
    const series = recurring(
      [
        { memberId: 'h1', amountCents: 5000 },
        { memberId: 'h2', amountCents: 5000 },
      ],
      { startMonth: '2027-01' },
    )
    series.versions[0].fromMonth = '2027-01'
    const data = withPeople({ series: [series] })
    const result = okData(deactivate(data))
    expect(home(result).series[0].versions).toEqual([
      { ...series.versions[0], shares: [{ memberId: 'h2', amountCents: 10000 }] },
    ])
    expectValid(result)
  })

  it('séries que já terminaram não mudam', () => {
    const ended = recurring([{ memberId: 'h1', amountCents: 10000 }], { lastMonth: '2026-10' })
    const finished: BillSeries = {
      id: 's-tv',
      kind: 'installment',
      startMonth: '2026-09',
      installmentCount: 2,
      versions: [{ fromMonth: '2026-09', name: 'TV', totalCents: 5000, dueDay: 5, shares: [{ memberId: 'h1', amountCents: 5000 }] }],
      skippedMonths: [],
    }
    const data = withPeople({ series: [ended, finished] })
    expect(deactivationPlan(data).affectedSeries).toEqual([])
    const result = okData(deactivate(data))
    expect(home(result).series[0]).toBe(ended)
    expect(home(result).series[1]).toBe(finished)
    expectValid(result)
  })

  it('contas: recalcula só as pendentes de séries a partir do efeito; comuns só listadas', () => {
    const series = recurring([
      { memberId: 'h1', amountCents: 5000 },
      { memberId: 'h2', amountCents: 5000 },
    ])
    const october = occurrence(series, '2026-10')
    const november = occurrence(series, '2026-11', { overridden: true, dueDay: 20 })
    const decemberPaid = occurrence(series, '2026-12', { paid: true })
    const commonFuture: Bill = {
      id: 'c-nov',
      name: 'Luz',
      month: '2026-11',
      totalCents: 8000,
      dueDay: 5,
      shares: [
        { memberId: 'h1', amountCents: 4000 },
        { memberId: 'h2', amountCents: 4000 },
      ],
      paid: false,
    }
    const commonPast = { ...commonFuture, id: 'c-out', month: '2026-10' }
    const data = withPeople({
      series: [series],
      bills: [october, november, decemberPaid, commonFuture, commonPast],
    })
    expect(deactivationPlan(data)).toMatchObject({
      recalculated: [{ billId: november.id, name: 'Academia', month: '2026-11', totalCents: 10000 }],
      commonBillsKept: [{ billId: 'c-nov', name: 'Luz', month: '2026-11', totalCents: 8000 }],
    })
    const result = okData(deactivate(data))
    const bills = home(result).bills
    expect(bills[0]).toBe(october)
    expect(bills[1]).toEqual({ ...november, shares: [{ memberId: 'h2', amountCents: 10000 }] })
    expect(bills[1].overridden).toBe(true)
    expect(bills[2]).toBe(decemberPaid)
    expect(bills[3]).toBe(commonFuture)
    expect(bills[4]).toBe(commonPast)
    // Previstas passam a mostrar a nova divisão.
    expect(projectedBillsForMonth(home(result), '2027-01')[0].shares).toEqual([
      { memberId: 'h2', amountCents: 10000 },
    ])
    expectValid(result)
  })

  it('recusa bloqueios, participante sem histórico e dados inexistentes', () => {
    const series = recurring([
      { memberId: 'h1', amountCents: 5000 },
      { memberId: 'h2', amountCents: 5000 },
    ])
    const data = withPeople({ series: [series] })
    expect(planMemberDeactivation(data, HOME_AREA_ID, 'h1', OCTOBER, 'h1')).toEqual({
      ok: false,
      error: 'Não é possível excluir nem desativar o membro que está selecionado no painel pessoal.',
    })
    expect(planMemberDeactivation(data, HOME_AREA_ID, 'h4', OCTOBER, null)).toEqual({
      ok: false,
      error: 'Este participante não tem histórico: ele pode ser excluído.',
    })
    const lastActive = makeData({ members: [member('h1', 'Ana'), member('h3', 'Caio', true)], series: [recurring([{ memberId: 'h1', amountCents: 10000 }])] })
    expect(planMemberDeactivation(lastActive, HOME_AREA_ID, 'h1', OCTOBER, null)).toEqual({
      ok: false,
      error: 'A área “Gastos da casa” precisa de pelo menos um membro ativo.',
    })
    expect(planMemberDeactivation(data, 'outra', 'h1', OCTOBER, null).ok).toBe(false)
    expect(planMemberDeactivation(data, HOME_AREA_ID, 'zz', OCTOBER, null).ok).toBe(false)
  })

  it('em outra área, o último ativo só é bloqueado se uma série ficar sem pagador ativo', () => {
    const trip = (series: BillSeries[], bills: Bill[] = []): FinanceData => {
      const base = makeData()
      return {
        ...base,
        areas: [
          ...base.areas,
          {
            id: 'area-v',
            name: 'Viagem',
            type: 'shared',
            members: [member('p1', 'Caio'), member('p2', 'Lia', true)],
            bills,
            series,
          },
        ],
      }
    }
    const hotel: BillSeries = {
      id: 's-hotel',
      kind: 'recurring',
      startMonth: '2026-10',
      versions: [{ fromMonth: '2026-10', name: 'Hotel', totalCents: 20000, dueDay: 12, shares: [{ memberId: 'p1', amountCents: 20000 }] }],
      skippedMonths: [],
    }
    expect(planMemberDeactivation(trip([hotel]), 'area-v', 'p1', OCTOBER, null)).toEqual({
      ok: false,
      error: 'Não é possível desativar: não há outro participante ativo para assumir “Hotel”.',
    })
    // Sem série que precise de pagador, a área pode ficar sem participantes ativos.
    const common: Bill = {
      id: 'c1', name: 'Passeio', month: '2026-11', totalCents: 5000, dueDay: 5,
      shares: [{ memberId: 'p1', amountCents: 5000 }], paid: false,
    }
    const data = trip([], [common])
    const result = okData(applyMemberDeactivation(data, 'area-v', 'p1', OCTOBER, null, {}))
    expect(result.areas[2].members.every((item) => item.inactive)).toBe(true)
    expect(result.areas[2].bills[0]).toBe(common)
    expectValid(result)
  })

  it('o resumo não altera nada e a aplicação revalida o pagador com os dados atuais', () => {
    const series = recurring([{ memberId: 'h1', amountCents: 10000 }])
    const data = withPeople({ series: [series] })
    const before = JSON.stringify(data)
    expect(deactivationPlan(data).affectedSeries).toHaveLength(1)
    expect(JSON.stringify(data)).toBe(before)
    // Duda foi desativada entre o resumo e a confirmação.
    const changed = withPeople({ series: [series] })
    changed.areas[0] = {
      ...changed.areas[0],
      members: changed.areas[0].members.map((item) => (item.id === 'h4' ? { ...item, inactive: true } : item)),
    }
    expect(deactivate(changed, { 's-academia': 'h4' })).toEqual({
      ok: false,
      error: 'O participante escolhido para assumir “Academia” não está mais ativo nesta área.',
    })
  })
})

/* ---------- I2: aumento de parcelas com participante desativado ---------- */

describe('I2: aumentar parcelas sem incluir participantes desativados', () => {
  // Ana foi desativada depois da compra; Edu é ativo, mas não estava na divisão.
  const people = [
    member('h1', 'Ana', true),
    member('h2', 'Bia'),
    member('h4', 'Duda'),
    member('h5', 'Edu'),
    member('h3', 'Caio', true),
  ]
  const at = (n: number) => monthFromIndex(monthIndex('2026-08') + n - 1)
  const tv = (shares: BillShare[], overrides: Partial<BillSeries> = {}): BillSeries => ({
    id: 's-tv',
    kind: 'installment',
    startMonth: '2026-08',
    installmentCount: 3,
    versions: [{ fromMonth: '2026-08', name: 'TV', totalCents: sum(shares), dueDay: 15, shares }],
    skippedMonths: [],
    ...overrides,
  })
  function sum(shares: BillShare[]) {
    return shares.reduce((total, share) => total + share.amountCents, 0)
  }
  const anaDudaBia = [
    { memberId: 'h1', amountCents: 3333 },
    { memberId: 'h4', amountCents: 3333 },
    { memberId: 'h2', amountCents: 3334 },
  ]
  const withPeople = (home: Partial<Area>) => makeData({ members: people, ...home })
  const increase = (data: FinanceData, count: number, payer?: string) =>
    applyInstallmentCount(data, HOME_AREA_ID, 's-tv', count, OCTOBER, payer)
  const countPlan = (data: FinanceData, count: number) => {
    const result = planInstallmentCount(data, HOME_AREA_ID, 's-tv', count, OCTOBER)
    if (!result.ok) throw new Error(result.error)
    return result.plan
  }

  it('parcelas novas: versão no primeiro mês acrescentado, só com os ativos da divisão', () => {
    const series = tv(anaDudaBia)
    const paidAug = occurrence(series, at(1), { paid: true })
    const paidSep = occurrence(series, at(2), { paid: true })
    const pendingOct = occurrence(series, at(3))
    const data = withPeople({ series: [series], bills: [paidAug, paidSep, pendingOct] })
    expectValid(data)
    expect(countPlan(data, 6)).toMatchObject({
      inactiveMemberIds: ['h1'],
      needsPayer: false,
      payerCandidates: ['h2', 'h4', 'h5'],
      recalculated: [],
    })
    const increased = okData(increase(data, 6))
    const versions = home(increased).series[0].versions
    expect(versions[0]).toBe(series.versions[0])
    // 33,33 de Ana para Duda e Bia: 16,66 cada e 1 centavo para Bia, que vem antes na área.
    expect(versions[1]).toEqual({
      ...series.versions[0],
      fromMonth: at(4),
      shares: [
        { memberId: 'h4', amountCents: 4999 },
        { memberId: 'h2', amountCents: 5001 },
      ],
    })
    // Parcelas anteriores, pagas ou não, ficam exatamente iguais (mesmo objeto).
    expect(home(increased).bills).toEqual([paidAug, paidSep, pendingOct])
    home(increased).bills.forEach((bill, index) => expect(bill).toBe(home(data).bills[index]))
    // Previstas: novas sem Ana e sem Edu; a de outubro continua gravada como estava.
    for (const n of [4, 5, 6]) {
      const projected = projectedBillsForMonth(home(increased), at(n))[0]
      expect(projected.shares.map((share) => share.memberId).sort()).toEqual(['h2', 'h4'])
      expect(sum(projected.shares)).toBe(10000)
    }
    expectValid(increased)
  })

  it('parcelas gravadas automaticamente (meses passados) não incluem o desativado', () => {
    const series = tv(anaDudaBia, { startMonth: '2026-01', versions: [{ fromMonth: '2026-01', name: 'TV', totalCents: 10000, dueDay: 15, shares: anaDudaBia }] })
    const data = withPeople({ series: [series], bills: [] })
    // Antes da correção: só janeiro a março; aumentar até dezembro cria abril a outubro.
    const increased = okData(increase(data, 12))
    const materialized = materializeDue(increased, OCTOBER, idGenerator())
    const created = home(materialized.data).bills
    // Janeiro a março usam a divisão antiga (histórico); de abril em diante, sem Ana.
    expect(created.filter((bill) => bill.month <= '2026-03').every((bill) => bill.shares.some((s) => s.memberId === 'h1'))).toBe(true)
    const newOnes = created.filter((bill) => bill.month >= '2026-04')
    expect(newOnes.map((bill) => bill.installmentNumber)).toEqual([4, 5, 6, 7, 8, 9, 10])
    for (const bill of newOnes) {
      expect(bill.shares.some((share) => share.memberId === 'h1')).toBe(false)
      expect(sum(bill.shares)).toBe(10000)
    }
    expectValid(materialized.data)
  })

  it('centavos: partes de vários desativados somadas e repartidas de uma vez (D1)', () => {
    const shares = [
      { memberId: 'h1', amountCents: 3334 },
      { memberId: 'h3', amountCents: 3333 },
      { memberId: 'h2', amountCents: 2000 },
      { memberId: 'h4', amountCents: 1334 },
    ]
    const data = withPeople({ series: [tv(shares)] })
    const increased = okData(increase(data, 4))
    const fixed = home(increased).series[0].versions[1].shares
    // 66,67 para Bia e Duda: 33,33 cada e 1 centavo para Bia.
    expect(fixed).toEqual([
      { memberId: 'h2', amountCents: 5334 },
      { memberId: 'h4', amountCents: 4667 },
    ])
    expect(sum(fixed)).toBe(10001)
    expectValid(increased)
  })

  it('sem ativo na divisão: o pagador escolhido assume 100%, revalidado na confirmação', () => {
    const data = withPeople({ series: [tv([{ memberId: 'h1', amountCents: 10000 }])] })
    expect(countPlan(data, 4)).toMatchObject({ needsPayer: true, payerCandidates: ['h2', 'h4', 'h5'] })
    expect(increase(data, 4)).toEqual({ ok: false, error: INSTALLMENT_PAYER_MISSING_MESSAGE })
    for (const payer of ['h1', 'h3', 'zz']) {
      expect(increase(data, 4, payer)).toEqual({ ok: false, error: INSTALLMENT_PAYER_INACTIVE_MESSAGE })
    }
    // Edu não estava na divisão, mas pode ser escolhido como pagador.
    const increased = okData(increase(data, 4, 'h5'))
    expect(home(increased).series[0].versions[1].shares).toEqual([{ memberId: 'h5', amountCents: 10000 }])
    expectValid(increased)

    // O pagador foi desativado entre o resumo e a confirmação: nada é aplicado.
    const changed = makeData({
      members: people.map((item) => (item.id === 'h5' ? { ...item, inactive: true } : item)),
      series: [tv([{ memberId: 'h1', amountCents: 10000 }])],
    })
    expect(increase(changed, 4, 'h5')).toEqual({ ok: false, error: INSTALLMENT_PAYER_INACTIVE_MESSAGE })
  })

  it('área sem nenhum participante ativo: o aumento é recusado', () => {
    const data = makeData({
      members: [member('h1', 'Ana', true), member('h3', 'Caio', true)],
      series: [tv([{ memberId: 'h1', amountCents: 10000 }])],
    })
    expect(increase(data, 4, 'h1')).toEqual({ ok: false, error: INSTALLMENT_NO_ACTIVE_MESSAGE })
  })

  it('só os ativos da divisão original recebem: Edu, fora dela, não entra', () => {
    const data = withPeople({ series: [tv(anaDudaBia)] })
    const increased = okData(increase(data, 4, 'h5'))
    expect(home(increased).series[0].versions[1].shares.some((s) => s.memberId === 'h5')).toBe(false)
  })

  it('primeiro mês acrescentado excluído: a versão vale para os seguintes e ele não volta', () => {
    const data = withPeople({ series: [tv(anaDudaBia, { skippedMonths: [at(4)] })] })
    const increased = okData(increase(data, 6))
    expect(home(increased).series[0].versions[1].fromMonth).toBe(at(4))
    expect(projectedBillsForMonth(home(increased), at(4))).toEqual([])
    for (const n of [5, 6]) {
      const projected = projectedBillsForMonth(home(increased), at(n))[0]
      expect(projected.installmentNumber).toBe(n)
      expect(projected.shares.some((s) => s.memberId === 'h1')).toBe(false)
    }
    const later = materializeDue(increased, { month: at(6), day: 1 }, idGenerator())
    expect(home(later.data).bills.map((bill) => bill.month)).toEqual([at(1), at(2), at(3), at(5), at(6)])
    expectValid(later.data)
  })

  it('nenhuma parcela nova gerada: não cria versão (D2)', () => {
    const series = tv(anaDudaBia, { skippedMonths: [at(4), at(5)] })
    const data = withPeople({ series: [series] })
    const increased = okData(increase(data, 5))
    expect(home(increased).series[0].versions).toEqual(series.versions)
    expect(home(increased).series[0].installmentCount).toBe(5)
  })

  it('aumento sem desativado na divisão: igual ao comportamento anterior', () => {
    const series = tv([
      { memberId: 'h2', amountCents: 5000 },
      { memberId: 'h4', amountCents: 5000 },
    ])
    const data = withPeople({ series: [series] })
    expect(countPlan(data, 6)).toMatchObject({ inactiveMemberIds: [], needsPayer: false, recalculated: [] })
    const increased = okData(increase(data, 6))
    expect(home(increased).series[0]).toEqual({ ...series, installmentCount: 6 })
    expect(home(increased).series[0].versions).toEqual(series.versions)
  })

  describe('D3: parcelas pendentes já gravadas no novo trecho', () => {
    // Compra em 3, com parcelas gravadas além do fim (dados de histórico aceitos pelo validador).
    const series = tv(anaDudaBia)
    const pendingOct = occurrence(series, at(3))
    const paidNov = occurrence(series, at(4), { paid: true })
    const editedDec = occurrence(series, at(5), {
      name: 'TV (ajuste)',
      totalCents: 12000,
      dueDay: 20,
      shares: [
        { memberId: 'h1', amountCents: 6000 },
        { memberId: 'h2', amountCents: 6000 },
      ],
      overridden: true,
    })
    const plainJan = occurrence(series, at(6))
    const onlyAnaFeb = occurrence(series, at(7), { shares: [{ memberId: 'h1', amountCents: 10000 }] })
    const base = () =>
      withPeople({ series: [series], bills: [pendingOct, paidNov, editedDec, plainJan] })

    it('recalcula só a divisão da própria conta e preserva todo o resto', () => {
      const data = base()
      expectValid(data)
      expect(countPlan(data, 8).recalculated.map((item) => item.installmentNumber)).toEqual([5, 6])
      const increased = okData(increase(data, 8))
      const [oct, nov, dec, jan] = home(increased).bills
      // Até o fim anterior e pagas: mesmo objeto.
      expect(oct).toBe(pendingOct)
      expect(nov).toBe(paidNov)
      // Editada: só a divisão muda; a parte de Ana vai só a Bia (a única ativa da conta).
      expect(dec).toEqual({ ...editedDec, shares: [{ memberId: 'h2', amountCents: 12000 }] })
      expect(dec.overridden).toBe(true)
      // Não editada: continua sem a marca, com a mesma divisão da versão nova.
      expect(jan).toEqual({ ...plainJan, shares: jan.shares })
      expect(jan.overridden).toBeUndefined()
      expect(jan.shares).toEqual(home(increased).series[0].versions[1].shares)
      expectValid(increased)
    })

    it('a etapa "esta e as seguintes" continua reconhecendo a conta editada', () => {
      const increased = okData(increase(base(), 8))
      const input = {
        name: 'TV',
        totalCents: 10000,
        dueDay: 15,
        shares: [
          { memberId: 'h2', amountCents: 5000 },
          { memberId: 'h4', amountCents: 5000 },
        ],
      }
      const planned = planSeriesEdit(increased, HOME_AREA_ID, 's-tv', at(3), input)
      if (!planned.ok) throw new Error(planned.error)
      expect(planned.plan.overriddenCount).toBe(1)
    })

    it('materializeDue não reescreve as contas recalculadas', () => {
      const increased = okData(increase(base(), 8))
      const later = materializeDue(increased, { month: at(8), day: 1 }, idGenerator())
      const before = home(increased).bills
      const after = home(later.data).bills
      for (let index = 0; index < before.length; index++) expect(after[index]).toBe(before[index])
      // Novas: agosto e setembro (não estavam gravadas) e as parcelas 7 e 8.
      expect(after.slice(before.length).map((bill) => bill.installmentNumber)).toEqual([1, 2, 7, 8])
    })

    it('conta só com desativados: o pagador assume 100% do valor dela', () => {
      const data = withPeople({ series: [series], bills: [pendingOct, onlyAnaFeb] })
      expect(countPlan(data, 7)).toMatchObject({ needsPayer: true })
      expect(increase(data, 7)).toEqual({ ok: false, error: INSTALLMENT_PAYER_MISSING_MESSAGE })
      const increased = okData(increase(data, 7, 'h4'))
      const feb = home(increased).bills[1]
      expect(feb).toEqual({ ...onlyAnaFeb, shares: [{ memberId: 'h4', amountCents: 10000 }] })
      expectValid(increased)
    })

    it('recalcula mesmo sem parcela nova gerada (sem criar versão)', () => {
      const data = base()
      const increased = okData(increase(data, 6))
      expect(home(increased).series[0].versions).toEqual(series.versions)
      expect(home(increased).bills[2].shares).toEqual([{ memberId: 'h2', amountCents: 12000 }])
      expectValid(increased)
    })

    it('conta pendente depois do novo fim segue a regra da etapa 8 (removida), sem recálculo', () => {
      const data = base()
      // Aumenta só até 5: a parcela 6 (janeiro) fica acima do novo total.
      const planned = countPlan(data, 5)
      expect(planned.recalculated.map((item) => item.installmentNumber)).toEqual([5])
      expect(planned.removed.map((item) => item.installmentNumber)).toEqual([6])
      const increased = okData(increase(data, 5))
      expect(home(increased).bills.map((bill) => bill.installmentNumber)).toEqual([3, 4, 5])
      expectValid(increased)
    })
  })

  it('redução depois do aumento descarta a versão corrigida', () => {
    const data = withPeople({ series: [tv(anaDudaBia)] })
    const increased = okData(increase(data, 6))
    const reduced = okData(increase(increased, 3))
    expect(home(reduced).series[0].versions).toEqual(tv(anaDudaBia).versions)
    expectValid(reduced)
  })
})

/* ---------- Correção pontual pós-I2 ---------- */

describe('quantidade de parcelas: remoções e indicadores do diálogo', () => {
  const at = (n: number) => monthFromIndex(monthIndex('2026-07') + n - 1)
  const both = [
    { memberId: 'h1', amountCents: 5000 },
    { memberId: 'h2', amountCents: 5000 },
  ]
  const purchase = (shares = both, installmentCount = 5): BillSeries => ({
    id: 's-tv',
    kind: 'installment',
    startMonth: '2026-07',
    installmentCount,
    versions: [{ fromMonth: '2026-07', name: 'TV', totalCents: 10000, dueDay: 15, shares }],
    skippedMonths: [],
  })
  const planFor = (data: FinanceData, count: number) => {
    const result = planInstallmentCount(data, HOME_AREA_ID, 's-tv', count, OCTOBER)
    if (!result.ok) throw new Error(result.error)
    return result.plan
  }

  it('mesma quantidade: nada listado como removido; redução e aumento continuam listando', () => {
    const series = purchase()
    // Parcela 8 gravada além do fim (histórico aceito pelo validador).
    const data = makeData({
      series: [series],
      bills: [
        occurrence(series, at(1), { paid: true }),
        occurrence(series, at(4)),
        { ...occurrence(purchase(both, 8), at(8)), id: 'p8' },
      ],
    })
    expectValid(data)
    const same = planFor(data, 5)
    expect(same.hasChanges).toBe(false)
    expect(same.removed).toEqual([])
    expect(okData(applyInstallmentCount(data, HOME_AREA_ID, 's-tv', 5, OCTOBER))).toBe(data)
    expect(planFor(data, 3).removed.map((item) => item.installmentNumber)).toEqual([4, 8])
    expect(planFor(data, 6).removed.map((item) => item.installmentNumber)).toEqual([8])
  })

  it('indicadores: parcelas novas, repartição entre ativos, pagador e só recalculadas', () => {
    // Caio (h3) está desativado em makeData.
    const mixed = makeData({
      series: [purchase([
        { memberId: 'h3', amountCents: 5000 },
        { memberId: 'h2', amountCents: 5000 },
      ], 3)],
    })
    expect(planFor(mixed, 4)).toMatchObject({
      fixesNewInstallments: true,
      redistributesAmongActive: true,
      needsPayer: false,
    })
    const onlyInactive = makeData({ series: [purchase([{ memberId: 'h3', amountCents: 10000 }], 3)] })
    expect(planFor(onlyInactive, 4)).toMatchObject({
      fixesNewInstallments: true,
      redistributesAmongActive: false,
      needsPayer: true,
    })
    // A parcela nova (4) já está gravada: nenhuma parcela nova é gerada, só o recálculo.
    const series = purchase([
      { memberId: 'h3', amountCents: 5000 },
      { memberId: 'h2', amountCents: 5000 },
    ], 3)
    const onlyRecorded = makeData({ series: [series], bills: [occurrence(purchase(series.versions[0].shares, 4), at(4))] })
    expect(planFor(onlyRecorded, 4)).toMatchObject({
      fixesNewInstallments: false,
      redistributesAmongActive: true,
      needsPayer: false,
    })
    expect(planFor(onlyRecorded, 4).recalculated.map((item) => item.installmentNumber)).toEqual([4])
  })
})

/* ---------- M6: base da nova versão em "esta e as seguintes" ---------- */

describe('M6: dados da série e resumo de "esta e as seguintes"', () => {
  const simple = () => academia({ versions: [academia().versions[0]] })
  const seriesShares = academia().versions[0].shares
  const to120: SeriesEditInput = {
    name: 'Academia',
    totalCents: 12000,
    dueDay: 10,
    shares: [
      { memberId: 'h1', amountCents: 6000 },
      { memberId: 'h2', amountCents: 6000 },
    ],
  }
  const planOf = (data: FinanceData, month: string, input: SeriesEditInput, id = 's-academia') => {
    const result = planSeriesEdit(data, HOME_AREA_ID, id, month, input)
    if (!result.ok) throw new Error(result.error)
    return result.plan
  }
  /** Outubro editado individualmente (R$ 90,00, só Ana). */
  const overriddenOctober = (series: BillSeries) =>
    occurrence(series, '2026-10', {
      totalCents: 9000,
      shares: [{ memberId: 'h1', amountCents: 9000 }],
      overridden: true,
    })

  it('seriesDataAt: dados da versão em vigor no mês; null fora da série', () => {
    const series = academia()
    expect(seriesDataAt(series, '2026-12')).toEqual({
      name: 'Academia',
      totalCents: 10000,
      dueDay: 10,
      shares: seriesShares,
    })
    expect(seriesDataAt(series, '2027-02')?.totalCents).toBe(12000)
    expect(seriesDataAt(series, '2026-09')).toBeNull()
    expect(seriesDataAt(academia({ lastMonth: '2026-11' }), '2026-12')).toBeNull()
  })

  it('seriesDataAt devolve a divisão exatamente como está, mesmo com desativado', () => {
    const withCaio = academia({
      versions: [{
        ...academia().versions[0],
        shares: [
          { memberId: 'h1', amountCents: 5000 },
          { memberId: 'h3', amountCents: 5000 },
        ],
      }],
    })
    expect(seriesDataAt(withCaio, '2026-11')?.shares).toEqual([
      { memberId: 'h1', amountCents: 5000 },
      { memberId: 'h3', amountCents: 5000 },
    ])
  })

  it('resumo: conta escolhida marcada, outras atualizadas, marcadas e pagas por mês', () => {
    const series = simple()
    const bills = [
      overriddenOctober(series),
      occurrence(series, '2026-11'),
      occurrence(series, '2026-12', { totalCents: 7000, shares: [{ memberId: 'h2', amountCents: 7000 }], overridden: true }),
      occurrence(series, '2027-01', { paid: true }),
      occurrence(series, '2027-02'),
    ]
    const plan = planOf(makeData({ series: [series], bills }), '2026-10', to120)
    expect(plan).toMatchObject({
      effectiveMonth: '2026-10',
      baseline: { name: 'Academia', totalCents: 10000, dueDay: 10, shares: seriesShares },
      selectedOverridden: true,
      selectedOutcome: 'follows',
      updatedMonths: ['2026-11', '2027-02'],
      overriddenMonths: ['2026-12'],
      paidKeptMonths: ['2027-01'],
      projectedChangedMonths: [],
      projectedChangesFrom: '2027-03',
    })
    // A contagem antiga continua igual (inclui a escolhida).
    expect(plan.updatedCount).toBe(3)
    const ended = planOf(
      makeData({ series: [academia({ lastMonth: '2027-03', versions: [series.versions[0]] })] }),
      '2026-10',
      to120,
    )
    expect(ended).toMatchObject({
      projectedChangedMonths: ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'],
      projectedChangesFrom: null,
    })
  })

  it('previstas afetadas: só os meses previstos cujos dados realmente mudam', () => {
    const series = simple()
    // Mesmos dados da série: nenhuma prevista muda (só a marca da escolhida sai).
    const sameData = planOf(
      makeData({ series: [series], bills: [overriddenOctober(series)] }),
      '2026-10',
      seriesDataAt(series, '2026-10')!,
    )
    expect(sameData).toMatchObject({ projectedChangedMonths: [], projectedChangesFrom: null })
    // Parcelada já toda gravada: não há previstas.
    const tv: BillSeries = {
      id: 's-tv', kind: 'installment', startMonth: '2026-10', installmentCount: 2, skippedMonths: [],
      versions: [{ fromMonth: '2026-10', name: 'TV', totalCents: 10000, dueDay: 15, shares: seriesShares }],
    }
    const allRecorded = makeData({ series: [tv], bills: [occurrence(tv, '2026-10'), occurrence(tv, '2026-11')] })
    expect(planOf(allRecorded, '2026-10', { ...to120, name: 'TV', dueDay: 15 }, 's-tv')).toMatchObject({
      projectedChangedMonths: [],
      projectedChangesFrom: null,
    })
    // Exclusão e conta gravada não contam como previstas.
    const withSkip = makeData({
      series: [{ ...tv, installmentCount: 4, skippedMonths: ['2026-12'] }],
      bills: [occurrence(tv, '2026-10')],
    })
    expect(planOf(withSkip, '2026-10', { ...to120, name: 'TV', dueDay: 15 }, 's-tv')).toMatchObject({
      projectedChangedMonths: ['2026-11', '2027-01'],
      projectedChangesFrom: null,
    })
  })

  it('previstas afetadas com versão programada: só os meses em que os dados mudam', () => {
    // academia(): R$ 100,00 desde outubro e R$ 120,00 programado para janeiro.
    const data = makeData({ series: [academia()], bills: [occurrence(academia(), '2026-10')] })
    const back100 = seriesDataAt(academia(), '2026-10')!
    // Voltar a R$ 100,00 a partir de outubro: só as previstas de janeiro em diante mudam.
    expect(planOf(data, '2026-10', back100)).toMatchObject({
      replacedVersionMonths: ['2027-01'],
      projectedChangedMonths: [],
      projectedChangesFrom: '2027-01',
    })
    // R$ 120,00 a partir de outubro: mudam novembro e dezembro; janeiro em diante já era 120.
    expect(planOf(data, '2026-10', to120)).toMatchObject({
      projectedChangedMonths: ['2026-11', '2026-12'],
      projectedChangesFrom: null,
    })
    // Volta a R$ 100,00 programada para março: janeiro e fevereiro não mudam, março em diante sim.
    const backInMarch = academia({
      versions: [...academia().versions, { ...academia().versions[0], fromMonth: '2027-03' }],
    })
    const mixed = makeData({ series: [backInMarch], bills: [occurrence(backInMarch, '2026-10')] })
    expect(planOf(mixed, '2026-10', to120)).toMatchObject({
      projectedChangedMonths: ['2026-11', '2026-12'],
      projectedChangesFrom: '2027-03',
    })
  })

  it('conta escolhida paga e marcada: continua igual; a base é a série no mês seguinte', () => {
    const series = academia()
    const paidOctober = { ...overriddenOctober(series), paid: true }
    const data = makeData({ series: [series], bills: [paidOctober] })
    // Vigência em janeiro: a base é a versão de R$ 120,00 programada para janeiro.
    const december = occurrence(series, '2026-12', { paid: true, overridden: true })
    const fromDecember = makeData({ series: [series], bills: [december] })
    expect(planOf(fromDecember, '2026-12', to120)).toMatchObject({
      effectiveMonth: '2027-01',
      selectedOutcome: 'paid',
      selectedOverridden: true,
      baseline: { totalCents: 12000 },
    })
    const plan = planOf(data, '2026-10', to120)
    expect(plan).toMatchObject({ effectiveMonth: '2026-11', selectedOutcome: 'paid', selectedOverridden: true })
    const edited = okData(applySeriesEdit(data, HOME_AREA_ID, 's-academia', '2026-10', to120, null))
    expect(home(edited).bills[0]).toBe(paidOctober)
  })

  it('regressão: com os dados da série, a escolhida marcada só volta a seguir a série', () => {
    const series = simple()
    const october = overriddenOctober(series)
    const november = occurrence(series, '2026-11', { totalCents: 7000, shares: [{ memberId: 'h2', amountCents: 7000 }], overridden: true })
    const data = makeData({ series: [series], bills: [october, november] })
    const sameAsSeries = seriesDataAt(series, '2026-10')!
    const plan = planOf(data, '2026-10', sameAsSeries)
    expect(plan).toMatchObject({ hasChanges: true, updatedCount: 1, updatedMonths: [], overriddenMonths: ['2026-11'] })
    const preserved = okData(applySeriesEdit(data, HOME_AREA_ID, 's-academia', '2026-10', sameAsSeries, 'preserve'))
    const expectedOctober: Bill = { ...october, totalCents: 10000, shares: seriesShares }
    delete expectedOctober.overridden
    expect(home(preserved).bills).toEqual([expectedOctober, november])
    // Versões iguais às de antes: a série não muda.
    expect(home(preserved).series).toBe(home(data).series)
    const replaced = okData(applySeriesEdit(data, HOME_AREA_ID, 's-academia', '2026-10', sameAsSeries, 'replace'))
    expect(home(replaced).bills[1].overridden).toBeUndefined()
    expect(home(replaced).bills[1].totalCents).toBe(10000)
    expectValid(preserved)
    expectValid(replaced)
  })

  it('D4: conta paga e marcada de outro mês fica igual mesmo com "substituir"', () => {
    const series = simple()
    const october = occurrence(series, '2026-10')
    const november = occurrence(series, '2026-11', { totalCents: 7000, shares: [{ memberId: 'h2', amountCents: 7000 }], overridden: true })
    const paidDecember = occurrence(series, '2026-12', {
      totalCents: 8000,
      shares: [{ memberId: 'h1', amountCents: 8000 }],
      paid: true,
      overridden: true,
    })
    const data = makeData({ series: [series], bills: [october, november, paidDecember] })
    const replaced = okData(applySeriesEdit(data, HOME_AREA_ID, 's-academia', '2026-10', to120, 'replace'))
    // A pendente marcada segue a nova versão; a paga e marcada não muda em nada.
    expect(home(replaced).bills[1]).toMatchObject({ totalCents: 12000, shares: to120.shares })
    expect(home(replaced).bills[1].overridden).toBeUndefined()
    expect(home(replaced).bills[2]).toBe(paidDecember)
    expect(home(replaced).bills[2]).toEqual({ ...paidDecember, totalCents: 8000, paid: true, overridden: true })
    expectValid(replaced)
  })

  it('D4: conta pendente em atraso antes da vigência fica igual', () => {
    const series = academia({
      startMonth: '2026-09',
      versions: [{ ...academia().versions[0], fromMonth: '2026-09' }],
    })
    const overdueSeptember = occurrence(series, '2026-09')
    const october = occurrence(series, '2026-10')
    const data = makeData({ series: [series], bills: [overdueSeptember, october] })
    const edited = okData(applySeriesEdit(data, HOME_AREA_ID, 's-academia', '2026-10', to120, null))
    expect(home(edited).bills[0]).toBe(overdueSeptember)
    expect(home(edited).bills[0]).toMatchObject({ totalCents: 10000, paid: false })
    expect(home(edited).bills[1]).toMatchObject({ totalCents: 12000, shares: to120.shares })
    expect(home(edited).series[0].versions).toEqual([series.versions[0], { fromMonth: '2026-10', ...to120 }])
    expectValid(edited)
  })

  it('regressão da etapa 8: depois da edição a partir de conta marcada, aumento e redução', () => {
    const tv: BillSeries = {
      id: 's-tv',
      kind: 'installment',
      startMonth: '2026-10',
      installmentCount: 5,
      skippedMonths: [],
      versions: [{ fromMonth: '2026-10', name: 'TV', totalCents: 10000, dueDay: 15, shares: seriesShares }],
    }
    const october = occurrence(tv, '2026-10', { totalCents: 9000, shares: [{ memberId: 'h1', amountCents: 9000 }], overridden: true })
    const data = makeData({ series: [tv], bills: [october] })
    const edited = okData(applySeriesEdit(data, HOME_AREA_ID, 's-tv', '2026-10', { ...to120, name: 'TV', dueDay: 15 }, null))
    expect(home(edited).series[0].versions).toEqual([{ fromMonth: '2026-10', ...to120, name: 'TV', dueDay: 15 }])
    expect(home(edited).bills[0].overridden).toBeUndefined()

    // Bia é desativada depois: o aumento cria parcelas só com quem está ativo (I2).
    const biaInactive: FinanceData = {
      ...edited,
      areas: [
        { ...home(edited), members: home(edited).members.map((m) => (m.id === 'h2' ? { ...m, inactive: true } : m)) },
        edited.areas[1],
      ],
    }
    const increased = okData(applyInstallmentCount(biaInactive, HOME_AREA_ID, 's-tv', 7, OCTOBER))
    const versions = home(increased).series[0].versions
    expect(versions[versions.length - 1]).toMatchObject({ fromMonth: '2027-03', shares: [{ memberId: 'h1', amountCents: 12000 }] })

    // Uma alteração programada para fevereiro some quando a compra passa a acabar antes.
    const programmed = okData(applySeriesEdit(edited, HOME_AREA_ID, 's-tv', '2027-02', { ...to120, name: 'TV', dueDay: 20 }, null))
    expect(home(programmed).series[0].versions.map((version) => version.fromMonth)).toEqual(['2026-10', '2027-02'])
    const reduced = okData(applyInstallmentCount(programmed, HOME_AREA_ID, 's-tv', 3, OCTOBER))
    expect(home(reduced).series[0].versions.map((version) => version.fromMonth)).toEqual(['2026-10'])
    expectValid(increased)
    expectValid(reduced)
  })

  it('regressão da etapa 9: desativação depois da edição; desativado continua recusado', () => {
    const series = simple()
    const data = makeData({ series: [series], bills: [overriddenOctober(series)] })
    const edited = okData(applySeriesEdit(data, HOME_AREA_ID, 's-academia', '2026-10', to120, null))
    const deactivated = okData(applyMemberDeactivation(edited, HOME_AREA_ID, 'h2', OCTOBER, null, {}))
    expect(home(deactivated).series[0].versions).toEqual([
      { fromMonth: '2026-10', ...to120 },
      { fromMonth: '2026-11', ...to120, shares: [{ memberId: 'h1', amountCents: 12000 }] },
    ])
    const withCaio: SeriesEditInput = {
      ...to120,
      shares: [
        { memberId: 'h1', amountCents: 6000 },
        { memberId: 'h3', amountCents: 6000 },
      ],
    }
    expect(planSeriesEdit(edited, HOME_AREA_ID, 's-academia', '2026-10', withCaio)).toEqual({
      ok: false,
      error: INACTIVE_IN_SHARES_MESSAGE,
    })
    expectValid(deactivated)
  })
})
