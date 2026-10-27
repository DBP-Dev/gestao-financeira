import type { Area, Bill } from './types'
import { getBillsTotals } from './billTotals'

export interface ShareTotals {
  /** Soma das parcelas da pessoa, pagas ou pendentes (centavos). */
  totalCents: number
  /** Soma das parcelas da pessoa em contas ainda não pagas (centavos). */
  pendingCents: number
}

/**
 * Soma somente as parcelas de um integrante nas contas informadas.
 * Contas compartilhadas contribuem apenas com a parcela dele; contas sem
 * parcela dele não entram. O status de pagamento é o da conta inteira.
 */
export function getMemberShareTotals(memberId: string, bills: Bill[]): ShareTotals {
  let totalCents = 0
  let pendingCents = 0
  for (const bill of bills) {
    for (const share of bill.shares) {
      if (share.memberId !== memberId) continue
      totalCents += share.amountCents
      if (!bill.paid) pendingCents += share.amountCents
    }
  }
  return { totalCents, pendingCents }
}

/** Resumo do mês no Painel Pessoal (centavos). */
export interface PersonalMonthSummary {
  /** Sua parte: perfil em "Gastos da casa", "Minhas contas" inteira e "Sou eu" nas outras áreas. */
  shareCents: number
  /** Sua parte nas contas marcadas como pagas (o status é o da conta inteira). */
  paidCents: number
  /** Sua parte nas contas não pagas, inclusive as previstas. */
  pendingCents: number
  /** Valor integral de todas as contas do mês, em todas as áreas. */
  monthTotalCents: number
}

/**
 * Soma o resumo do mês a partir das contas de cada área (gravadas e previstas, como em
 * `billsForMonth`). Áreas individuais entram inteiras na sua parte; nas compartilhadas,
 * só a parte de quem `selfIdFor` indicar (null: a área fica fora da sua parte). Todas as
 * contas entram no total geral. Cada parte vai inteira para "pago" ou "pendente", então
 * pago + pendente é sempre igual à sua parte.
 */
export function getPersonalMonthSummary(
  areaBills: { area: Area; bills: Bill[] }[],
  selfIdFor: (area: Area) => string | null,
): PersonalMonthSummary {
  let shareCents = 0
  let pendingCents = 0
  for (const { area, bills } of areaBills) {
    if (area.type === 'individual') {
      const totals = getBillsTotals(bills)
      shareCents += totals.totalCents
      pendingCents += totals.pendingCents
      continue
    }
    const selfId = selfIdFor(area)
    if (selfId === null) continue
    const totals = getMemberShareTotals(selfId, bills)
    shareCents += totals.totalCents
    pendingCents += totals.pendingCents
  }
  return {
    shareCents,
    paidCents: shareCents - pendingCents,
    pendingCents,
    monthTotalCents: getBillsTotals(areaBills.flatMap(({ bills }) => bills)).totalCents,
  }
}
