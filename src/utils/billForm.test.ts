import { describe, expect, it } from 'vitest'
import type { Bill } from '../domain/types'
import {
  analyzeDraft,
  billDataFromDraft,
  createDraft,
  describeSeriesEditOrigin,
  diffBillData,
  draftFromSeriesData,
  draftMatchesSeriesData,
  hasDifferences,
  sameBillData,
  type BillData,
  type BillDraft,
} from './billForm'

function draft(changes: Partial<BillDraft> = {}): BillDraft {
  return {
    ...createDraft(),
    name: 'Academia',
    total: '100,00',
    dueDay: '10',
    memberIds: ['a', 'b'],
    ...changes,
  }
}

describe('tipo da conta no formulário', () => {
  it('começa como conta normal, sem quantidade de parcelas', () => {
    const empty = createDraft()
    expect(empty.kind).toBe('normal')
    expect(empty.installmentCount).toBe('')
  })

  it('edita sempre como conta normal', () => {
    const bill: Bill = {
      id: 'x',
      name: 'Luz',
      month: '2026-10',
      totalCents: 10000,
      dueDay: 5,
      shares: [{ memberId: 'a', amountCents: 10000 }],
      paid: true,
      seriesId: 's1',
    }
    expect(createDraft(bill).kind).toBe('normal')
  })

  it('não pede quantidade de parcelas em contas normais e recorrentes', () => {
    for (const kind of ['normal', 'recurring'] as const) {
      const analysis = analyzeDraft(draft({ kind, installmentCount: 'abc' }))
      expect(analysis.isValid).toBe(true)
      expect(analysis.errors.installmentCount).toBeUndefined()
      expect(analysis.installmentCount).toBeNull()
    }
  })

  it('exige quantidade inteira de 2 a 120 na parcelada', () => {
    for (const installmentCount of ['', '1', '121', '2,5', '3.0', '-4', 'dez']) {
      const analysis = analyzeDraft(draft({ kind: 'installment', installmentCount }))
      expect(analysis.isValid).toBe(false)
      expect(analysis.errors.installmentCount).toBeDefined()
    }
    for (const [text, value] of [['2', 2], ['12', 12], [' 120 ', 120]] as const) {
      const analysis = analyzeDraft(draft({ kind: 'installment', installmentCount: text }))
      expect(analysis.isValid).toBe(true)
      expect(analysis.installmentCount).toBe(value)
    }
  })

  it('valida a quantidade de parcelas também em áreas individuais', () => {
    const invalid = analyzeDraft(draft({ kind: 'installment', installmentCount: '0' }), true)
    expect(invalid.isValid).toBe(false)
    const valid = analyzeDraft(draft({ kind: 'installment', installmentCount: '10' }), true)
    expect(valid.isValid).toBe(true)
    expect(valid.shares).toEqual([])
  })
})

describe('validações existentes da conta normal (regressão)', () => {
  it('mantém as mensagens de nome, valor e pessoas', () => {
    const analysis = analyzeDraft(draft({ name: ' ', total: '0', memberIds: [] }))
    expect(analysis.isValid).toBe(false)
    expect(analysis.errors.name).toBe('Escreva o nome da conta, por exemplo "Água".')
    expect(analysis.errors.total).toBe('O valor precisa ser maior que zero.')
    expect(analysis.errors.members).toBe('Escolha pelo menos uma pessoa para pagar esta conta.')
  })

  it('divide igualmente e confere a soma dos valores escolhidos', () => {
    const equal = analyzeDraft(draft({ total: '100,01' }))
    expect(equal.shares).toEqual([
      { memberId: 'a', amountCents: 5001 },
      { memberId: 'b', amountCents: 5000 },
    ])
    const custom = analyzeDraft(
      draft({ splitMode: 'custom', customAmounts: { a: '30,00', b: '60,00' } }),
    )
    expect(custom.isValid).toBe(false)
    expect(custom.errors.sum).toContain('Ainda faltam')
  })
})

/* ---------- M6: base da nova versão em "esta e as seguintes" ---------- */

describe('dados do formulário em centavos (billDataFromDraft)', () => {
  it('divisão igual e personalizada viram os mesmos centavos do salvamento', () => {
    expect(billDataFromDraft(draft({ name: '  Academia ', total: '100,01' }))).toEqual({
      name: 'Academia',
      totalCents: 10001,
      dueDay: 10,
      shares: [
        { memberId: 'a', amountCents: 5001 },
        { memberId: 'b', amountCents: 5000 },
      ],
    })
    const custom = draft({ splitMode: 'custom', customAmounts: { a: '60', b: '40,00' } })
    expect(billDataFromDraft(custom)?.shares).toEqual([
      { memberId: 'a', amountCents: 6000 },
      { memberId: 'b', amountCents: 4000 },
    ])
    expect(billDataFromDraft(draft({ memberIds: [] }), true)?.shares).toEqual([])
  })

  it('rascunho inválido devolve null', () => {
    const invalid: Partial<BillDraft>[] = [
      { name: '   ' },
      { total: '' },
      { total: '0' },
      { total: 'abc' },
      { dueDay: '0' },
      { dueDay: '32' },
      { memberIds: [] },
      { splitMode: 'custom', customAmounts: { a: '', b: '100' } },
      { splitMode: 'custom', customAmounts: { a: '0', b: '100' } },
      { splitMode: 'custom', customAmounts: { a: '50', b: '40' } },
    ]
    for (const changes of invalid) expect(billDataFromDraft(draft(changes))).toBeNull()
  })
})

describe('comparação com os dados da série (sameBillData / draftMatchesSeriesData)', () => {
  const series: BillData = {
    name: 'Academia',
    totalCents: 10000,
    dueDay: 10,
    shares: [
      { memberId: 'a', amountCents: 5000 },
      { memberId: 'b', amountCents: 5000 },
    ],
  }
  const withShares = (shares: BillData['shares']): BillData => ({ ...series, shares })
  const custom = (a: string, b: string) => draft({ splitMode: 'custom', customAmounts: { a, b } })

  it('ignora só a ordem, o modo da divisão, a digitação do valor e espaços nas pontas', () => {
    expect(draftMatchesSeriesData(draft(), series)).toBe(true)
    expect(draftMatchesSeriesData(draft({ memberIds: ['b', 'a'] }), series)).toBe(true)
    expect(draftMatchesSeriesData(custom('50', '50,00'), series)).toBe(true)
    expect(draftMatchesSeriesData(draft({ total: '100' }), series)).toBe(true)
    expect(draftMatchesSeriesData(draft({ name: ' Academia  ' }), series)).toBe(true)
    expect(sameBillData(series, withShares([...series.shares].reverse()))).toBe(true)
  })

  it('detecta participante ausente ou a mais e valor individual diferente', () => {
    expect(sameBillData(series, withShares([{ memberId: 'a', amountCents: 10000 }]))).toBe(false)
    const three = withShares([
      { memberId: 'a', amountCents: 3400 },
      { memberId: 'b', amountCents: 3300 },
      { memberId: 'c', amountCents: 3300 },
    ])
    expect(sameBillData(series, three)).toBe(false)
    // Mesma soma, valores individuais diferentes.
    expect(draftMatchesSeriesData(custom('60', '40'), series)).toBe(false)
  })

  it('a sobra de centavos com outro participante é diferença real', () => {
    const odd: BillData = {
      ...series,
      totalCents: 10001,
      shares: [
        { memberId: 'a', amountCents: 5001 },
        { memberId: 'b', amountCents: 5000 },
      ],
    }
    expect(draftMatchesSeriesData(draft({ total: '100,01' }), odd)).toBe(true)
    // Ordem invertida no formulário: a sobra vai para "b".
    expect(draftMatchesSeriesData(draft({ total: '100,01', memberIds: ['b', 'a'] }), odd)).toBe(false)
  })

  it('detecta nome (maiúsculas e espaço interno), valor e vencimento diferentes', () => {
    expect(draftMatchesSeriesData(draft({ name: 'academia' }), series)).toBe(false)
    expect(draftMatchesSeriesData(draft({ name: 'Acade mia' }), series)).toBe(false)
    expect(draftMatchesSeriesData(draft({ total: '100,02' }), series)).toBe(false)
    expect(draftMatchesSeriesData(draft({ dueDay: '11' }), series)).toBe(false)
  })

  it('dados inválidos e participante repetido nunca são iguais', () => {
    expect(draftMatchesSeriesData(draft({ total: '' }), series)).toBe(false)
    expect(sameBillData(null, series)).toBe(false)
    expect(sameBillData(null, null)).toBe(false)
    const repeated = withShares([
      { memberId: 'a', amountCents: 5000 },
      { memberId: 'a', amountCents: 5000 },
    ])
    expect(sameBillData(repeated, repeated)).toBe(false)
  })

  it('área individual: divisões vazias são iguais', () => {
    expect(draftMatchesSeriesData(draft({ memberIds: [] }), withShares([]), true)).toBe(true)
  })
})

describe('diferenças campo a campo (diffBillData)', () => {
  const from: BillData = {
    name: 'Academia',
    totalCents: 10000,
    dueDay: 10,
    shares: [
      { memberId: 'a', amountCents: 5000 },
      { memberId: 'b', amountCents: 5000 },
    ],
  }

  it('sem diferenças quando só a ordem muda', () => {
    expect(hasDifferences(diffBillData(from, { ...from, shares: [...from.shares].reverse() }))).toBe(false)
  })

  it('nome, valor, vencimento e divisão por participante (saiu, mudou, entrou)', () => {
    const to: BillData = {
      name: 'Academia nova',
      totalCents: 12000,
      dueDay: 15,
      shares: [
        { memberId: 'b', amountCents: 6000 },
        { memberId: 'c', amountCents: 6000 },
      ],
    }
    expect(diffBillData(from, to)).toEqual({
      name: { from: 'Academia', to: 'Academia nova' },
      totalCents: { from: 10000, to: 12000 },
      dueDay: { from: 10, to: 15 },
      shares: [
        { memberId: 'a', from: 5000, to: null },
        { memberId: 'b', from: 5000, to: 6000 },
        { memberId: 'c', from: null, to: 6000 },
      ],
    })
  })
})

describe('rascunho com os dados da série (draftFromSeriesData)', () => {
  const data = (totalCents: number, shares: BillData['shares']): BillData => ({
    name: 'Academia',
    totalCents,
    dueDay: 1,
    shares,
  })
  const roundTrip = (value: BillData) => {
    const result = draftFromSeriesData(value)
    expect(draftMatchesSeriesData(result, value)).toBe(true)
    expect(billDataFromDraft(result)?.shares).toEqual(value.shares)
    return result
  }

  it('ida e volta exata: divisão igual, com sobra e personalizada', () => {
    const equal = [
      { memberId: 'a', amountCents: 5000 },
      { memberId: 'b', amountCents: 5000 },
    ]
    expect(roundTrip(data(10000, equal)).splitMode).toBe('equal')
    const odd = [
      { memberId: 'a', amountCents: 5001 },
      { memberId: 'b', amountCents: 5000 },
    ]
    expect(roundTrip(data(10001, odd)).splitMode).toBe('equal')
    // Sobra no segundo participante: só a divisão personalizada reproduz os centavos.
    const oddSecond = [
      { memberId: 'a', amountCents: 5000 },
      { memberId: 'b', amountCents: 5001 },
    ]
    expect(roundTrip(data(10001, oddSecond)).splitMode).toBe('custom')
  })

  it('participante desativado continua na divisão, exatamente como na série', () => {
    const shares = [
      { memberId: 'desativado', amountCents: 3000 },
      { memberId: 'b', amountCents: 6000 },
    ]
    expect(roundTrip(data(9000, shares)).memberIds).toEqual(['desativado', 'b'])
  })
})

describe('origem dos valores na confirmação (describeSeriesEditOrigin)', () => {
  const series: BillData = {
    name: 'Academia',
    totalCents: 10000,
    dueDay: 10,
    shares: [
      { memberId: 'a', amountCents: 5000 },
      { memberId: 'b', amountCents: 5000 },
    ],
  }
  const account: BillData = {
    ...series,
    totalCents: 8000,
    shares: [
      { memberId: 'a', amountCents: 4000 },
      { memberId: 'b', amountCents: 4000 },
    ],
  }

  it('igual à série, igual à conta, ou igual às duas (vale a série)', () => {
    expect(describeSeriesEditOrigin(series, series, account, 'account')).toEqual({ kind: 'series' })
    expect(describeSeriesEditOrigin(account, series, account, 'series')).toEqual({ kind: 'account' })
    expect(describeSeriesEditOrigin(series, series, series, 'account')).toEqual({ kind: 'series' })
  })

  it('editado: informa a base escolhida e o que mudou em relação a ela', () => {
    expect(describeSeriesEditOrigin({ ...series, dueDay: 12 }, series, account, 'series')).toEqual({
      kind: 'edited',
      base: 'series',
      changes: { name: null, totalCents: null, dueDay: { from: 10, to: 12 }, shares: [] },
    })
    const fromAccount = describeSeriesEditOrigin(
      { ...account, name: 'Ginástica' },
      series,
      account,
      'account',
    )
    expect(fromAccount).toEqual({
      kind: 'edited',
      base: 'account',
      changes: {
        name: { from: 'Academia', to: 'Ginástica' },
        totalCents: null,
        dueDay: null,
        shares: [],
      },
    })
  })
})
