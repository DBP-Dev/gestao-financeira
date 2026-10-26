import type { Area, Bill, FinanceData, MonthKey } from '../types'
import { MAX_BILLS } from './backup'
import { createId } from './ids'
import {
  redistributeInactiveShares,
  totalBills,
  validateNewShares,
  type SeriesChangeResult,
} from './series'

/**
 * Regras puras das contas comuns que aumentam o total de contas guardadas.
 * O validador recusa mais de MAX_BILLS contas: passar disso faria a próxima abertura
 * cair na recuperação. Por isso as operações são tudo ou nada.
 */

export const ADD_BILL_LIMIT_MESSAGE =
  'Não foi possível adicionar a conta: o limite de 20.000 contas guardadas foi atingido.'

export const COPY_BILLS_LIMIT_MESSAGE =
  'Não foi possível copiar as contas: o limite de 20.000 contas guardadas seria ultrapassado. Nenhuma conta foi copiada.'

/** Conta comum como vem do formulário (sem id). */
export type CommonBillInput = Omit<Bill, 'id' | 'isExample'>

/** Acrescenta uma conta comum na área. Contas de áreas individuais não têm divisão. */
export function addCommonBill(
  data: FinanceData,
  areaId: string,
  input: CommonBillInput,
  newId: () => string = createId,
): SeriesChangeResult {
  const area = data.areas.find((item) => item.id === areaId)
  if (!area) return { ok: false, error: 'A área desta conta não foi encontrada.' }
  if (totalBills(data) + 1 > MAX_BILLS) return { ok: false, error: ADD_BILL_LIMIT_MESSAGE }
  const bill: Bill = {
    ...input,
    shares: area.type === 'individual' ? [] : input.shares,
    id: newId(),
  }
  return {
    ok: true,
    data: {
      ...data,
      areas: data.areas.map((item) =>
        item.id === areaId ? { ...item, bills: [...item.bills, bill] } : item,
      ),
    },
  }
}

export const COPY_NO_ACTIVE_MESSAGE =
  'Não foi possível copiar as contas: esta área não tem participantes ativos. Ative ou ' +
  'adicione um participante e tente de novo. Nenhuma conta foi copiada.'
export const COPY_SHARES_CHANGED_MESSAGE =
  'As divisões das contas mudaram desde que a cópia foi aberta: algum participante foi ' +
  'desativado ou reativado. Nenhuma conta foi copiada. Tente copiar de novo para revisar.'
export const COPY_PAYER_MISSING_MESSAGE = 'Escolha quem paga as contas sem participante ativo.'
export const COPY_PAYER_INACTIVE_MESSAGE =
  'O participante escolhido não está mais ativo nesta área. Nenhuma conta foi copiada.'
export const COPY_SHARES_ERROR_MESSAGE =
  'Não foi possível calcular a divisão das contas sem os participantes desativados. ' +
  'Nenhuma conta foi copiada.'

/**
 * Ajuste de uma conta copiada: a parte dos desativados é repartida entre os ativos que já
 * estão nela, ou ninguém ativo ficou e o pagador escolhido assume o valor inteiro.
 */
export type CopyAdjustmentKind = 'redistribute' | 'payer'

/** Resumo da cópia para a confirmação. */
export interface CopyBillsPlan {
  /** Quantas contas comuns serão copiadas. */
  copyCount: number
  /** Contas de origem cuja cópia terá a divisão ajustada, na ordem da lista. */
  adjusted: { billId: string; name: string; totalCents: number; kind: CopyAdjustmentKind }[]
  /** Desativados que aparecem nas divisões ajustadas, na ordem da área. */
  inactiveMemberIds: string[]
  /** Alguma conta ficaria sem participante ativo: é preciso escolher quem paga. */
  needsPayer: boolean
  /** Em alguma conta, a parte dos desativados vai aos ativos que já estão nela. */
  redistributesAmongActive: boolean
  /** Quem pode assumir: os participantes ativos da área. */
  payerCandidates: string[]
}

/** O que a pessoa viu e aceitou: o ajuste de cada conta de origem e o pagador. */
export interface CopyConfirmation {
  adjustments: Readonly<Record<string, CopyAdjustmentKind>>
  payer?: string
}

/** Cópia sem ajuste nenhum aceito (o clique direto, sem diálogo). */
export const NO_COPY_ADJUSTMENTS: CopyConfirmation = { adjustments: {} }

/** A confirmação correspondente a um resumo, com o pagador escolhido. */
export function confirmationFor(plan: CopyBillsPlan, payer?: string): CopyConfirmation {
  return {
    adjustments: Object.fromEntries(plan.adjusted.map((item) => [item.billId, item.kind])),
    payer: plan.needsPayer ? payer : undefined,
  }
}

type PreparedCopy =
  | { ok: false; error: string }
  | { ok: true; area: Area; sources: Bill[]; plan: CopyBillsPlan }

/**
 * Valida a cópia com os dados atuais e calcula o que ela ajusta. Sem contas comuns no mês
 * de origem não há nada a fazer. Com contas, uma área compartilhada precisa de algum
 * participante ativo, e o limite global de contas vale para todas juntas.
 */
function prepareCopy(
  data: FinanceData,
  areaId: string,
  fromMonth: MonthKey,
): PreparedCopy {
  const area = data.areas.find((item) => item.id === areaId)
  if (!area) return { ok: false, error: 'A área desta conta não foi encontrada.' }
  const sources = area.bills.filter(
    (bill) => bill.month === fromMonth && bill.seriesId === undefined,
  )
  const payerCandidates = area.members.filter((member) => !member.inactive).map((m) => m.id)
  const plan: CopyBillsPlan = {
    copyCount: sources.length,
    adjusted: [],
    inactiveMemberIds: [],
    needsPayer: false,
    redistributesAmongActive: false,
    payerCandidates,
  }
  if (sources.length === 0) return { ok: true, area, sources, plan }
  if (area.type === 'shared' && payerCandidates.length === 0) {
    return { ok: false, error: COPY_NO_ACTIVE_MESSAGE }
  }
  if (totalBills(data) + sources.length > MAX_BILLS) {
    return { ok: false, error: COPY_BILLS_LIMIT_MESSAGE }
  }
  // Áreas individuais não têm divisão: nada a ajustar.
  if (area.type === 'shared') {
    const inactiveIds = new Set(area.members.filter((m) => m.inactive).map((m) => m.id))
    const found = new Set<string>()
    for (const bill of sources) {
      const inactiveHere = bill.shares.filter((share) => inactiveIds.has(share.memberId))
      if (inactiveHere.length === 0) continue
      for (const share of inactiveHere) found.add(share.memberId)
      const kind: CopyAdjustmentKind =
        redistributeInactiveShares(bill.shares, area, undefined) === null ? 'payer' : 'redistribute'
      plan.adjusted.push({ billId: bill.id, name: bill.name, totalCents: bill.totalCents, kind })
    }
    plan.inactiveMemberIds = area.members.filter((m) => found.has(m.id)).map((m) => m.id)
    plan.needsPayer = plan.adjusted.some((item) => item.kind === 'payer')
    plan.redistributesAmongActive = plan.adjusted.some((item) => item.kind === 'redistribute')
  }
  return { ok: true, area, sources, plan }
}

/** Resumo da cópia para a confirmação. Não altera os dados. */
export function planCopyBills(
  data: FinanceData,
  areaId: string,
  fromMonth: MonthKey,
): { ok: true; plan: CopyBillsPlan } | { ok: false; error: string } {
  const prepared = prepareCopy(data, areaId, fromMonth)
  return prepared.ok ? { ok: true, plan: prepared.plan } : prepared
}

/**
 * Copia as contas comuns de um mês para outro, pendentes. As de séries são geradas pela
 * própria série e não são copiadas. Participantes desativados não entram nas cópias: a
 * parte deles vai aos ativos que já estão na conta ou, sem nenhum, ao pagador escolhido.
 * Tudo é refeito com os dados atuais e comparado com o que foi aceito (`confirmation`):
 * um ajuste que não foi aceito recusa a cópia. Qualquer erro (limite, pagador, divisão)
 * recusa todas as cópias; as contas de origem nunca mudam.
 */
export function copyCommonBills(
  data: FinanceData,
  areaId: string,
  fromMonth: MonthKey,
  toMonth: MonthKey,
  newId: () => string = createId,
  confirmation: CopyConfirmation = NO_COPY_ADJUSTMENTS,
): SeriesChangeResult {
  const prepared = prepareCopy(data, areaId, fromMonth)
  if (!prepared.ok) return prepared
  const { area, sources, plan } = prepared
  if (sources.length === 0) return { ok: true, data }
  for (const item of plan.adjusted) {
    if (confirmation.adjustments[item.billId] !== item.kind) {
      return { ok: false, error: COPY_SHARES_CHANGED_MESSAGE }
    }
  }
  let payer: string | undefined
  if (plan.needsPayer) {
    if (confirmation.payer === undefined) return { ok: false, error: COPY_PAYER_MISSING_MESSAGE }
    if (!plan.payerCandidates.includes(confirmation.payer)) {
      return { ok: false, error: COPY_PAYER_INACTIVE_MESSAGE }
    }
    payer = confirmation.payer
  }
  const copies: Bill[] = []
  for (const bill of sources) {
    let shares = bill.shares
    if (area.type === 'shared') {
      const fixed = redistributeInactiveShares(bill.shares, area, payer)
      if (fixed === null || validateNewShares(area, fixed, bill.totalCents) !== null) {
        return { ok: false, error: COPY_SHARES_ERROR_MESSAGE }
      }
      shares = fixed
    }
    copies.push({ ...bill, id: newId(), month: toMonth, paid: false, shares })
  }
  return {
    ok: true,
    data: {
      ...data,
      areas: data.areas.map((item) =>
        item.id === areaId ? { ...item, bills: [...item.bills, ...copies] } : item,
      ),
    },
  }
}
