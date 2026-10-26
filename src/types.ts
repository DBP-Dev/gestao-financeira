/** Mês no formato "AAAA-MM", por exemplo "2026-10". */
export type MonthKey = string

export interface Member {
  id: string
  name: string
  emoji: string
  /** Cor de fundo do avatar. */
  color: string
  /** Desativado: não entra em contas novas, mas continua no histórico. */
  inactive?: boolean
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
  /** Série (recorrente ou parcelada) da qual esta conta é a ocorrência do mês. */
  seriesId?: string
  /** Só em parceladas: número original da parcela (posição do mês na série). */
  installmentNumber?: number
  /** Ocorrência editada com "só esta ocorrência". */
  overridden?: boolean
}

export type SeriesKind = 'recurring' | 'installment'

/** Dados de cada ocorrência de uma série, válidos a partir de `fromMonth`. */
export interface SeriesVersion {
  fromMonth: MonthKey
  name: string
  /** Valor de cada ocorrência (numa parcelada, o valor de cada parcela). */
  totalCents: number
  dueDay: number
  /** Divisão entre participantes; vazia em áreas individuais. */
  shares: BillShare[]
}

/** Conta recorrente ou parcelada. As ocorrências gravadas são contas com `seriesId`. */
export interface BillSeries {
  id: string
  kind: SeriesKind
  startMonth: MonthKey
  /** Só parcelada: quantidade de parcelas. */
  installmentCount?: number
  /** Só recorrente encerrada: último mês que gera conta. */
  lastMonth?: MonthKey
  /** Em ordem crescente de `fromMonth`; a primeira começa em `startMonth`. */
  versions: SeriesVersion[]
  /** Meses excluídos pela pessoa: nunca são recriados. */
  skippedMonths: MonthKey[]
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
  /** Contas recorrentes e parceladas da área. */
  series: BillSeries[]
}

export interface FinanceData {
  version: 3
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
