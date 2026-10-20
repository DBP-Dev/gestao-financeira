/** Mês no formato "AAAA-MM", por exemplo "2026-10". */
export type MonthKey = string

export interface Member {
  id: string
  name: string
  emoji: string
  /** Cor de fundo do avatar. */
  color: string
}

/** Quanto cada pessoa paga de uma conta, em centavos. */
export interface BillShare {
  memberId: string
  amountCents: number
}

export interface Bill {
  id: string
  name: string
  month: MonthKey
  /** Valor total em centavos (evita erros de arredondamento). */
  totalCents: number
  /** Dia do mês em que a conta vence (1 a 31). */
  dueDay: number
  shares: BillShare[]
  paid: boolean
  /** Contas criadas automaticamente para demonstração. */
  isExample?: boolean
}

export type AreaType = 'individual' | 'shared'

/** Área financeira com dados próprios (contas e, se compartilhada, participantes). */
export interface Area {
  /** Identificador estável, independente do nome. */
  id: string
  name: string
  /** Definido na criação; não muda depois. */
  type: AreaType
  /** Participantes da área. Áreas individuais não têm membros. */
  members: Member[]
  bills: Bill[]
}

export interface FinanceData {
  version: 2
  areas: Area[]
}

/** Formato antigo (versão 1): uma única área implícita, "Gastos da casa". */
export interface LegacyFinanceDataV1 {
  version: 1
  members: Member[]
  bills: Bill[]
}

export type BillStatus = 'paid' | 'pending' | 'late'

export interface Today {
  month: MonthKey
  day: number
}
