import { MEMBER_IDS } from '../data/sampleData'
import type { Bill } from '../types'

/** Integrante usado como "eu" no Painel Pessoal quando existe nos dados. */
export const DEFAULT_CURRENT_MEMBER_ID: string = MEMBER_IDS.me

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
