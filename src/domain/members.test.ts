import { describe, expect, it } from 'vitest'
import type { Bill, BillSeries, Member } from './types'
import { getMemberRemoval, isActiveMember, isMemberInSeries } from './members'

const member = (id: string, name: string, inactive = false): Member => ({
  id,
  name,
  emoji: '🙂',
  color: '#d8ecff',
  ...(inactive ? { inactive: true } : {}),
})
const ana = member('a', 'Ana')
const bia = member('b', 'Bia')
const caio = member('c', 'Caio')

const series: BillSeries[] = [
  {
    id: 's1',
    kind: 'recurring',
    startMonth: '2026-12',
    versions: [
      {
        fromMonth: '2026-12',
        name: 'Academia',
        totalCents: 10000,
        dueDay: 10,
        shares: [{ memberId: 'a', amountCents: 10000 }],
      },
      {
        fromMonth: '2027-03',
        name: 'Academia',
        totalCents: 10000,
        dueDay: 10,
        shares: [{ memberId: 'b', amountCents: 10000 }],
      },
    ],
    skippedMonths: [],
  },
]

const bill: Bill = {
  id: 'x',
  name: 'Luz',
  month: '2026-10',
  totalCents: 5000,
  dueDay: 5,
  shares: [{ memberId: 'c', amountCents: 5000 }],
  paid: false,
}

describe('participantes em séries', () => {
  it('identifica quem aparece em qualquer versão de uma série', () => {
    expect(isMemberInSeries('a', series)).toBe(true)
    expect(isMemberInSeries('b', series)).toBe(true)
    expect(isMemberInSeries('c', series)).toBe(false)
    expect(isMemberInSeries('a', [])).toBe(false)
  })

  it('reconhece participantes ativos', () => {
    expect(isActiveMember(ana)).toBe(true)
    expect(isActiveMember(member('d', 'Duda', true))).toBe(false)
  })
})

describe('excluir, desativar ou bloquear (getMemberRemoval)', () => {
  it('sem contas e sem séries: exclusão definitiva', () => {
    expect(getMemberRemoval(caio, [ana, bia, caio], [], series, null, true)).toEqual({ mode: 'delete' })
  })

  it('com contas gravadas ou participação em séries: desativação', () => {
    expect(getMemberRemoval(caio, [ana, bia, caio], [bill], [], null, true)).toEqual({
      mode: 'deactivate',
    })
    // Só nas versões de uma série, sem contas gravadas.
    expect(getMemberRemoval(bia, [ana, bia, caio], [], series, null, true)).toEqual({
      mode: 'deactivate',
    })
  })

  it('bloqueia o perfil do painel pessoal, o último membro e o último ativo de "Gastos da casa"', () => {
    expect(getMemberRemoval(caio, [ana, caio], [], [], 'c', true)).toEqual({
      mode: 'blocked',
      reasons: ['Não é possível excluir nem desativar o membro que está selecionado no painel pessoal.'],
    })
    expect(getMemberRemoval(caio, [caio], [], [], null, true)).toEqual({
      mode: 'blocked',
      reasons: ['É preciso ter pelo menos um membro.'],
    })
    const inactiveBia = member('b', 'Bia', true)
    expect(getMemberRemoval(ana, [ana, inactiveBia], [bill], [], null, true)).toEqual({
      mode: 'blocked',
      reasons: ['A área “Gastos da casa” precisa de pelo menos um membro ativo.'],
    })
  })

  it('nas outras áreas, o último ativo pode ser desativado (o último membro continua protegido)', () => {
    const inactiveBia = member('b', 'Bia', true)
    const anaBill: Bill = { ...bill, shares: [{ memberId: 'a', amountCents: 5000 }] }
    expect(getMemberRemoval(ana, [ana, inactiveBia], [anaBill], [], null, false)).toEqual({
      mode: 'deactivate',
    })
    expect(getMemberRemoval(ana, [ana], [anaBill], [], null, false)).toEqual({
      mode: 'blocked',
      reasons: ['É preciso ter pelo menos um membro.'],
    })
  })

  it('participante já desativado não é removido de novo', () => {
    const inactiveCaio = member('c', 'Caio', true)
    expect(getMemberRemoval(inactiveCaio, [ana, bia, inactiveCaio], [bill], [], null, true)).toEqual({
      mode: 'blocked',
      reasons: ['Este participante já está desativado.'],
    })
  })
})
