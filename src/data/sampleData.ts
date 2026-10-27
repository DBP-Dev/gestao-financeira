import type { Bill, FinanceData, Member, MonthKey } from '../domain/types'
import { migrateV1ToV3 } from '../domain/areas'
import { splitEvenly } from '../domain/money'

export const MEMBER_IDS = {
  me: 'eu',
  mother: 'mae',
  stepfather: 'padrasto',
  brother: 'irmao',
  grandma: 'vo',
} as const

/** Integrante usado como "eu" no Painel Pessoal quando existe nos dados. */
export const DEFAULT_CURRENT_MEMBER_ID: string = MEMBER_IDS.me

export const DEFAULT_MEMBERS: Member[] = [
  { id: MEMBER_IDS.me, name: 'Eu', emoji: '🙂', color: '#d8ecff' },
  { id: MEMBER_IDS.mother, name: 'Mãe', emoji: '👩', color: '#ffe0e6' },
  { id: MEMBER_IDS.stepfather, name: 'Padrasto', emoji: '👨', color: '#dff3e4' },
  { id: MEMBER_IDS.brother, name: 'Irmão', emoji: '🧑', color: '#fff0c9' },
  { id: MEMBER_IDS.grandma, name: 'Vó', emoji: '👵', color: '#ece3ff' },
]

function sharedEqually(memberIds: string[], totalCents: number) {
  const amounts = splitEvenly(totalCents, memberIds.length)
  return memberIds.map((memberId, index) => ({
    memberId,
    amountCents: amounts[index],
  }))
}

/** Contas fictícias para demonstrar o aplicativo. Os valores são apenas exemplos. */
export function createSampleBills(month: MonthKey): Bill[] {
  const splitTrio = [MEMBER_IDS.me, MEMBER_IDS.mother, MEMBER_IDS.stepfather]

  return [
    {
      id: 'exemplo-aluguel',
      name: 'Aluguel',
      month,
      totalCents: 150000,
      dueDay: 5,
      shares: [{ memberId: MEMBER_IDS.mother, amountCents: 150000 }],
      paid: true,
      isExample: true,
    },
    {
      id: 'exemplo-condominio',
      name: 'Condomínio',
      month,
      totalCents: 45000,
      dueDay: 10,
      shares: sharedEqually(splitTrio, 45000),
      paid: false,
      isExample: true,
    },
    {
      id: 'exemplo-internet',
      name: 'Internet',
      month,
      totalCents: 12000,
      dueDay: 15,
      shares: sharedEqually(splitTrio, 12000),
      paid: true,
      isExample: true,
    },
    {
      id: 'exemplo-energia',
      name: 'Energia',
      month,
      totalCents: 18000,
      dueDay: 20,
      shares: [{ memberId: MEMBER_IDS.brother, amountCents: 18000 }],
      paid: false,
      isExample: true,
    },
    {
      id: 'exemplo-mercado',
      name: 'Mercado',
      month,
      totalCents: 90000,
      dueDay: 25,
      shares: sharedEqually(splitTrio, 90000),
      paid: false,
      isExample: true,
    },
  ]
}

/** Primeiro uso: só a área "Gastos da casa", com os membros e as contas de exemplo. */
export function createInitialData(month: MonthKey): FinanceData {
  return migrateV1ToV3({
    version: 1,
    members: DEFAULT_MEMBERS,
    bills: createSampleBills(month),
  })
}
