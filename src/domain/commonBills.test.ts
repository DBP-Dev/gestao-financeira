import { describe, expect, it } from 'vitest'
import type { Bill, BillSeries, FinanceData } from './types'
import { HOME_AREA_ID, MY_ACCOUNTS_AREA_ID } from './areas'
import { MAX_BILLS, parseStoredData } from './backup'
import {
  ADD_BILL_LIMIT_MESSAGE,
  COPY_BILLS_LIMIT_MESSAGE,
  COPY_NO_ACTIVE_MESSAGE,
  COPY_PAYER_INACTIVE_MESSAGE,
  COPY_PAYER_MISSING_MESSAGE,
  COPY_SHARES_CHANGED_MESSAGE,
  COPY_SHARES_ERROR_MESSAGE,
  addCommonBill,
  confirmationFor,
  copyCommonBills,
  planCopyBills,
  type CommonBillInput,
  type CopyConfirmation,
} from './commonBills'
import { applyMemberDeactivation, totalBills } from './series'

const member = (id: string, name: string) => ({ id, name, emoji: '🙂', color: '#d8ecff' })

function idGenerator(prefix = 'id') {
  let next = 0
  return () => `${prefix}-${++next}`
}

const filler = (count: number): Bill[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `f-${index}`, name: 'Conta', month: '2026-01', totalCents: 100, dueDay: 1, shares: [], paid: true,
  }))

function makeData(homeBills: Bill[] = [], mineBills: Bill[] = []): FinanceData {
  return {
    version: 3,
    areas: [
      {
        id: HOME_AREA_ID,
        name: 'Gastos da casa',
        type: 'shared',
        members: [member('h1', 'Ana'), member('h2', 'Bia')],
        bills: homeBills,
        series: [],
      },
      {
        id: MY_ACCOUNTS_AREA_ID,
        name: 'Minhas contas',
        type: 'individual',
        members: [],
        bills: mineBills,
        series: [],
      },
    ],
  }
}

const luz: CommonBillInput = {
  name: 'Luz',
  month: '2026-10',
  totalCents: 8000,
  dueDay: 5,
  shares: [
    { memberId: 'h1', amountCents: 4000 },
    { memberId: 'h2', amountCents: 4000 },
  ],
  paid: false,
}

function okData(result: ReturnType<typeof addCommonBill>): FinanceData {
  if (!result.ok) throw new Error(result.error)
  return result.data
}

function expectValid(data: FinanceData) {
  const result = parseStoredData(JSON.stringify(data))
  if (!result.ok) throw new Error(result.error)
}

describe('adicionar conta comum (addCommonBill)', () => {
  it('acrescenta a conta; em área individual, sem divisão', () => {
    const data = makeData()
    const added = okData(addCommonBill(data, HOME_AREA_ID, luz, idGenerator()))
    expect(added.areas[0].bills).toEqual([{ ...luz, id: 'id-1' }])
    expect(added.areas[1]).toBe(data.areas[1])
    const mine = okData(addCommonBill(data, MY_ACCOUNTS_AREA_ID, luz, idGenerator()))
    expect(mine.areas[1].bills[0].shares).toEqual([])
    expectValid(added)
    expectValid(mine)
  })

  it('aceita exatamente até o limite global e recusa além dele, sem alterar nada', () => {
    const almost = makeData([], filler(MAX_BILLS - 1))
    const atLimit = okData(addCommonBill(almost, HOME_AREA_ID, luz))
    expect(totalBills(atLimit)).toBe(MAX_BILLS)
    expectValid(atLimit)

    const full = makeData([], filler(MAX_BILLS))
    const before = JSON.stringify(full)
    expect(addCommonBill(full, HOME_AREA_ID, luz)).toEqual({ ok: false, error: ADD_BILL_LIMIT_MESSAGE })
    expect(JSON.stringify(full)).toBe(before)
  })

  it('recusa área inexistente', () => {
    expect(addCommonBill(makeData(), 'outra', luz).ok).toBe(false)
  })
})

describe('copiar contas comuns (copyCommonBills)', () => {
  const october: Bill[] = [
    { ...luz, id: 'c1', paid: true },
    { ...luz, id: 'c2', name: 'Água', totalCents: 6000, shares: [{ memberId: 'h1', amountCents: 6000 }] },
    // Ocorrência de série: nunca é copiada.
    { ...luz, id: 's1', name: 'Academia', seriesId: 's-academia' },
  ]

  it('copia só as comuns, pendentes, para o mês de destino', () => {
    const data = makeData(october)
    const copied = okData(copyCommonBills(data, HOME_AREA_ID, '2026-10', '2026-11', idGenerator()))
    const november = copied.areas[0].bills.filter((bill) => bill.month === '2026-11')
    expect(november).toEqual([
      { ...october[0], id: 'id-1', month: '2026-11', paid: false },
      { ...october[1], id: 'id-2', month: '2026-11', paid: false },
    ])
    expect(copied.areas[1]).toBe(data.areas[1])
  })

  it('sem contas comuns para copiar, devolve os mesmos dados', () => {
    const data = makeData([october[2]])
    expect(okData(copyCommonBills(data, HOME_AREA_ID, '2026-10', '2026-11'))).toBe(data)
  })

  it('é tudo ou nada: se uma cópia passar do limite, nenhuma é feita', () => {
    // Duas comuns para copiar.
    const fits = makeData(october, filler(MAX_BILLS - october.length - 2))
    const copied = okData(copyCommonBills(fits, HOME_AREA_ID, '2026-10', '2026-11'))
    expect(totalBills(copied)).toBe(MAX_BILLS)

    const tooMany = makeData(october, filler(MAX_BILLS - october.length - 1))
    const before = JSON.stringify(tooMany)
    expect(copyCommonBills(tooMany, HOME_AREA_ID, '2026-10', '2026-11')).toEqual({
      ok: false,
      error: COPY_BILLS_LIMIT_MESSAGE,
    })
    expect(JSON.stringify(tooMany)).toBe(before)
  })

  it('recusa área inexistente', () => {
    expect(copyCommonBills(makeData(), 'outra', '2026-10', '2026-11').ok).toBe(false)
  })
})

/* ---------- I3: participantes desativados nas cópias ---------- */

describe('copiar contas comuns sem participantes desativados (I3)', () => {
  const OCTOBER = { month: '2026-10', day: 15 }

  /** Casa com Ana e Cris ativos e Bia desativada (opções mudam quem está ativo). */
  function makeTeam(
    homeBills: Bill[],
    options: { biaActive?: boolean; crisInactive?: boolean } = {},
  ): FinanceData {
    const data = makeData(homeBills)
    const bia = member('h2', 'Bia')
    const cris = member('h3', 'Cris')
    data.areas[0] = {
      ...data.areas[0],
      members: [
        member('h1', 'Ana'),
        options.biaActive ? bia : { ...bia, inactive: true },
        options.crisInactive ? { ...cris, inactive: true } : cris,
      ],
    }
    return data
  }

  // Origem em outubro: uma paga com ativos e a desativada, uma só da desativada, uma sem ela.
  const luzMista: Bill = {
    id: 'luz', name: 'Luz', month: '2026-10', totalCents: 10001, dueDay: 5, paid: true,
    shares: [
      { memberId: 'h1', amountCents: 3000 },
      { memberId: 'h2', amountCents: 4001 },
      { memberId: 'h3', amountCents: 3000 },
    ],
  }
  const aguaSoBia: Bill = {
    id: 'agua', name: 'Água', month: '2026-10', totalCents: 6000, dueDay: 8, paid: false,
    shares: [{ memberId: 'h2', amountCents: 6000 }],
  }
  const gasAtivos: Bill = {
    id: 'gas', name: 'Gás', month: '2026-10', totalCents: 5000, dueDay: 10, paid: false,
    shares: [
      { memberId: 'h1', amountCents: 2500 },
      { memberId: 'h3', amountCents: 2500 },
    ],
  }
  const sources = [luzMista, aguaSoBia, gasAtivos]

  function plan(data: FinanceData, areaId = HOME_AREA_ID, from = '2026-10') {
    const result = planCopyBills(data, areaId, from)
    if (!result.ok) throw new Error(result.error)
    return result.plan
  }

  const copyWith = (data: FinanceData, confirmation?: CopyConfirmation) =>
    copyCommonBills(data, HOME_AREA_ID, '2026-10', '2026-11', idGenerator(), confirmation)

  const novemberOf = (data: FinanceData) =>
    data.areas[0].bills.filter((bill) => bill.month === '2026-11')

  it('o resumo lista as contas ajustadas, o tipo de ajuste, os desativados e quem pode pagar', () => {
    expect(plan(makeTeam(sources))).toEqual({
      copyCount: 3,
      adjusted: [
        { billId: 'luz', name: 'Luz', totalCents: 10001, kind: 'redistribute' },
        { billId: 'agua', name: 'Água', totalCents: 6000, kind: 'payer' },
      ],
      inactiveMemberIds: ['h2'],
      needsPayer: true,
      redistributesAmongActive: true,
      payerCandidates: ['h1', 'h3'],
    })
  })

  it('sem desativados nas divisões, nada a ajustar e a cópia é a mesma de antes', () => {
    const data = makeTeam(sources, { biaActive: true })
    const summary = plan(data)
    expect(summary.adjusted).toEqual([])
    expect(summary.needsPayer).toBe(false)
    expect(novemberOf(okData(copyWith(data)))).toEqual(
      sources.map((bill, index) => ({ ...bill, id: `id-${index + 1}`, month: '2026-11', paid: false })),
    )
  })

  it('reparte a parte dos desativados entre os ativos da conta e o pagador assume as sem ativos', () => {
    const data = makeTeam(sources)
    const before = JSON.stringify(data)
    const copied = okData(copyWith(data, confirmationFor(plan(data), 'h3')))
    const november = novemberOf(copied)
    // 4001 centavos de Bia: 2001 para Ana (primeira na ordem da área) e 2000 para Cris.
    expect(november).toEqual([
      {
        ...luzMista, id: 'id-1', month: '2026-11', paid: false,
        shares: [
          { memberId: 'h1', amountCents: 5001 },
          { memberId: 'h3', amountCents: 5000 },
        ],
      },
      { ...aguaSoBia, id: 'id-2', month: '2026-11', shares: [{ memberId: 'h3', amountCents: 6000 }] },
      { ...gasAtivos, id: 'id-3', month: '2026-11' },
    ])
    for (const bill of november) {
      expect(bill.shares.reduce((sum, share) => sum + share.amountCents, 0)).toBe(bill.totalCents)
      expect(bill.shares.some((share) => share.memberId === 'h2')).toBe(false)
    }
    // Origem intacta: os mesmos objetos, inclusive a conta paga.
    sources.forEach((_, index) => {
      expect(copied.areas[0].bills[index]).toBe(data.areas[0].bills[index])
    })
    expect(copied.areas[0].bills[0].paid).toBe(true)
    expect(copied.areas[0].members).toBe(data.areas[0].members)
    expect(copied.areas[1]).toBe(data.areas[1])
    expect(JSON.stringify(data)).toBe(before)
    expectValid(copied)
  })

  it('recusa sem alterar nada: ajuste não aceito, pagador ausente, desativado ou de fora', () => {
    const data = makeTeam(sources)
    const before = JSON.stringify(data)
    const { adjustments } = confirmationFor(plan(data), 'h1')
    expect(copyWith(data)).toEqual({ ok: false, error: COPY_SHARES_CHANGED_MESSAGE })
    expect(copyWith(data, { adjustments })).toEqual({ ok: false, error: COPY_PAYER_MISSING_MESSAGE })
    expect(copyWith(data, { adjustments, payer: 'h2' })).toEqual({
      ok: false,
      error: COPY_PAYER_INACTIVE_MESSAGE,
    })
    expect(copyWith(data, { adjustments, payer: 'zz' })).toEqual({
      ok: false,
      error: COPY_PAYER_INACTIVE_MESSAGE,
    })
    expect(JSON.stringify(data)).toBe(before)
  })

  it('pagador informado sem ser necessário é ignorado', () => {
    const data = makeTeam([luzMista, gasAtivos])
    const summary = plan(data)
    expect(summary.needsPayer).toBe(false)
    expect(confirmationFor(summary, 'h3').payer).toBeUndefined()
    const withPayer = okData(copyWith(data, { adjustments: { luz: 'redistribute' }, payer: 'h3' }))
    expect(withPayer).toEqual(okData(copyWith(data, confirmationFor(summary))))
  })

  describe('dados que mudaram entre o resumo e a confirmação', () => {
    it('clique direto que encontra ajuste é recusado (alguém foi desativado)', () => {
      const seen = plan(makeTeam(sources, { biaActive: true }))
      expect(seen.adjusted).toEqual([])
      expect(copyWith(makeTeam(sources), confirmationFor(seen))).toEqual({
        ok: false,
        error: COPY_SHARES_CHANGED_MESSAGE,
      })
    })

    it('ajuste que mudou de tipo (repartir passou a pagador assumir) é recusado', () => {
      const conta: Bill = {
        ...gasAtivos,
        shares: [
          { memberId: 'h2', amountCents: 2500 },
          { memberId: 'h3', amountCents: 2500 },
        ],
      }
      const seen = plan(makeTeam([conta]))
      expect(seen.adjusted.map((item) => item.kind)).toEqual(['redistribute'])
      expect(copyWith(makeTeam([conta], { crisInactive: true }), confirmationFor(seen, 'h1'))).toEqual({
        ok: false,
        error: COPY_SHARES_CHANGED_MESSAGE,
      })
    })

    it('pagador escolhido que foi desativado é recusado', () => {
      // Só a conta de Bia: desativar Cris não muda os ajustes, só o pagador escolhido.
      const seen = plan(makeTeam([aguaSoBia]))
      expect(copyWith(makeTeam([aguaSoBia], { crisInactive: true }), confirmationFor(seen, 'h3'))).toEqual({
        ok: false,
        error: COPY_PAYER_INACTIVE_MESSAGE,
      })
    })

    it('ajuste que deixou de ser necessário: copia com a divisão atual, que é válida', () => {
      const seen = plan(makeTeam(sources))
      const copied = okData(copyWith(makeTeam(sources, { biaActive: true }), confirmationFor(seen, 'h3')))
      expect(novemberOf(copied).map((bill) => bill.shares)).toEqual(sources.map((bill) => bill.shares))
      expectValid(copied)
    })

    it('conta nova na origem: sem ajuste é copiada; com ajuste, a cópia é recusada', () => {
      const seen = plan(makeTeam([luzMista]))
      const copied = okData(copyWith(makeTeam([luzMista, gasAtivos]), confirmationFor(seen)))
      expect(novemberOf(copied).map((bill) => bill.name)).toEqual(['Luz', 'Gás'])
      expect(copyWith(makeTeam([luzMista, aguaSoBia]), confirmationFor(seen, 'h1'))).toEqual({
        ok: false,
        error: COPY_SHARES_CHANGED_MESSAGE,
      })
    })
  })

  it('divisão final inválida é um erro explícito, sem alterar nada', () => {
    const broken: Bill = { ...gasAtivos, shares: [{ memberId: 'h1', amountCents: 100 }] }
    const data = makeTeam([broken])
    const before = JSON.stringify(data)
    expect(copyWith(data)).toEqual({ ok: false, error: COPY_SHARES_ERROR_MESSAGE })
    expect(JSON.stringify(data)).toBe(before)
  })

  it('vale para qualquer mês de destino, inclusive passado', () => {
    const data = makeTeam(sources.map((bill) => ({ ...bill, month: '2025-01' })))
    const confirmation = confirmationFor(plan(data, HOME_AREA_ID, '2025-01'), 'h1')
    const copied = okData(
      copyCommonBills(data, HOME_AREA_ID, '2025-01', '2025-02', idGenerator(), confirmation),
    )
    const february = copied.areas[0].bills.filter((bill) => bill.month === '2025-02')
    expect(february).toHaveLength(3)
    expect(february.some((bill) => bill.shares.some((share) => share.memberId === 'h2'))).toBe(false)
    expectValid(copied)
  })

  it('área compartilhada sem ativos: sem contas comuns, nada muda; com contas, recusa', () => {
    const data = makeTeam([])
    const conta: Bill = { ...gasAtivos, id: 'x', shares: [{ memberId: 'x1', amountCents: 5000 }] }
    const area = (bills: Bill[]) => ({
      id: 'area-x',
      name: 'Viagem',
      type: 'shared' as const,
      members: [{ ...member('x1', 'Dani'), inactive: true }],
      bills,
      series: [],
    })
    // Só uma ocorrência de série no mês de origem: nada a copiar.
    const empty: FinanceData = {
      ...data,
      areas: [...data.areas, area([{ ...conta, id: 'xs', seriesId: 's-x' }])],
    }
    expect(okData(copyCommonBills(empty, 'area-x', '2026-10', '2026-11'))).toBe(empty)
    expect(planCopyBills(empty, 'area-x', '2026-10').ok).toBe(true)

    const withBills: FinanceData = { ...data, areas: [...data.areas, area([conta])] }
    const before = JSON.stringify(withBills)
    expect(copyCommonBills(withBills, 'area-x', '2026-10', '2026-11')).toEqual({
      ok: false,
      error: COPY_NO_ACTIVE_MESSAGE,
    })
    expect(planCopyBills(withBills, 'area-x', '2026-10')).toEqual({
      ok: false,
      error: COPY_NO_ACTIVE_MESSAGE,
    })
    expect(JSON.stringify(withBills)).toBe(before)
  })

  it('área individual: sem participantes, sem ajuste e cópia como antes', () => {
    const mine: Bill = { ...gasAtivos, id: 'm1', shares: [] }
    const data = makeData([], [mine])
    expect(plan(data, MY_ACCOUNTS_AREA_ID)).toEqual({
      copyCount: 1,
      adjusted: [],
      inactiveMemberIds: [],
      needsPayer: false,
      redistributesAmongActive: false,
      payerCandidates: [],
    })
    const copied = okData(
      copyCommonBills(data, MY_ACCOUNTS_AREA_ID, '2026-10', '2026-11', idGenerator()),
    )
    expect(copied.areas[1].bills[1]).toEqual({ ...mine, id: 'id-1', month: '2026-11' })
    expectValid(copied)
  })

  it('a marca de exemplo segue como hoje (copiada junto)', () => {
    const copied = okData(copyWith(makeTeam([{ ...gasAtivos, isExample: true }])))
    expect(novemberOf(copied)[0].isExample).toBe(true)
  })

  it('regressão da etapa 9: conta comum mantida na desativação sai sem a pessoa na cópia', () => {
    const data = makeTeam([{ ...luzMista, paid: false }], { biaActive: true })
    const deactivated = okData(applyMemberDeactivation(data, HOME_AREA_ID, 'h2', OCTOBER, null, {}))
    // A etapa 9 mantém a conta comum do mês atual como estava.
    expect(deactivated.areas[0].bills[0]).toBe(data.areas[0].bills[0])
    const summary = plan(deactivated)
    expect(summary.adjusted.map((item) => item.billId)).toEqual(['luz'])
    const copied = okData(copyWith(deactivated, confirmationFor(summary)))
    expect(copied.areas[0].bills[0]).toBe(deactivated.areas[0].bills[0])
    expect(novemberOf(copied)[0].shares).toEqual([
      { memberId: 'h1', amountCents: 5001 },
      { memberId: 'h3', amountCents: 5000 },
    ])
    expectValid(copied)
  })

  it('regressão da etapa 8: a cópia não mexe em séries nem na quantidade de parcelas', () => {
    const installment: BillSeries = {
      id: 's-tv',
      kind: 'installment',
      startMonth: '2026-09',
      installmentCount: 5,
      skippedMonths: [],
      versions: [
        {
          fromMonth: '2026-09', name: 'TV', totalCents: 10000, dueDay: 10,
          shares: [{ memberId: 'h1', amountCents: 10000 }],
        },
      ],
    }
    const occurrence: Bill = {
      id: 'tv2', name: 'TV', month: '2026-10', totalCents: 10000, dueDay: 10, paid: false,
      shares: [{ memberId: 'h1', amountCents: 10000 }], seriesId: 's-tv', installmentNumber: 2,
    }
    const base = makeTeam([luzMista, occurrence])
    const data: FinanceData = {
      ...base,
      areas: [{ ...base.areas[0], series: [installment] }, base.areas[1]],
    }
    const copied = okData(copyWith(data, confirmationFor(plan(data))))
    expect(copied.areas[0].series).toBe(data.areas[0].series)
    expect(copied.areas[0].series[0].installmentCount).toBe(5)
    expect(copied.areas[0].bills.filter((bill) => bill.seriesId !== undefined)).toEqual([occurrence])
    expect(novemberOf(copied).map((bill) => bill.name)).toEqual(['Luz'])
    expectValid(copied)
  })
})
