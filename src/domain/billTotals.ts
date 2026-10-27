import type { Bill } from './types'

export interface BillsTotals {
  /** Soma dos valores integrais das contas (centavos). */
  totalCents: number
  /** Soma das contas marcadas como pagas (centavos). */
  paidCents: number
  /** Total menos o pago (centavos). */
  pendingCents: number
  paidCount: number
}

/** Totais integrais de um conjunto de contas, usados no resumo da Família. */
export function getBillsTotals(bills: Bill[]): BillsTotals {
  const totalCents = bills.reduce((sum, bill) => sum + bill.totalCents, 0)
  const paidBills = bills.filter((bill) => bill.paid)
  const paidCents = paidBills.reduce((sum, bill) => sum + bill.totalCents, 0)
  return {
    totalCents,
    paidCents,
    pendingCents: totalCents - paidCents,
    paidCount: paidBills.length,
  }
}
