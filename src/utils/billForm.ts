import type { Bill, BillShare, Member } from '../types'
import { centsToInput, formatBRL, parseMoneyInput, splitEvenly } from './money'

export type SplitMode = 'equal' | 'custom'

/** Estado do formulário enquanto a pessoa digita (tudo como texto). */
export interface BillDraft {
  name: string
  total: string
  dueDay: string
  memberIds: string[]
  splitMode: SplitMode
  customAmounts: Record<string, string>
  paid: boolean
}

export interface DraftErrors {
  name?: string
  total?: string
  dueDay?: string
  members?: string
  /** Problema na soma das partes. */
  sum?: string
  /** Problemas em valores individuais, por pessoa. */
  memberAmounts: Record<string, string>
}

export interface DraftAnalysis {
  totalCents: number | null
  /** Quanto cabe a cada pessoa, quando já é possível calcular. */
  shares: BillShare[] | null
  errors: DraftErrors
  /** Soma das partes personalizadas e se ela fecha com o total. */
  customSumCents: number
  sumMatches: boolean
  isValid: boolean
}

function isEqualSplit(bill: Bill): boolean {
  const expected = splitEvenly(bill.totalCents, bill.shares.length)
  return bill.shares.every((share, index) => share.amountCents === expected[index])
}

export function createDraft(bill?: Bill): BillDraft {
  if (!bill) {
    return {
      name: '',
      total: '',
      dueDay: '10',
      memberIds: [],
      splitMode: 'equal',
      customAmounts: {},
      paid: false,
    }
  }

  const customAmounts: Record<string, string> = {}
  for (const share of bill.shares) {
    customAmounts[share.memberId] = centsToInput(share.amountCents)
  }

  return {
    name: bill.name,
    total: centsToInput(bill.totalCents),
    dueDay: String(bill.dueDay),
    memberIds: bill.shares.map((share) => share.memberId),
    splitMode: isEqualSplit(bill) ? 'equal' : 'custom',
    customAmounts,
    paid: bill.paid,
  }
}

/** Mantém os integrantes escolhidos na mesma ordem da lista da família. */
export function orderMemberIds(ids: string[], members: Member[]): string[] {
  return members.map((member) => member.id).filter((id) => ids.includes(id))
}

/**
 * `individual`: conta de área individual — sem pessoas e sem divisão (`shares` vazio).
 * As validações de nome, valor e vencimento são as mesmas.
 */
export function analyzeDraft(draft: BillDraft, individual = false): DraftAnalysis {
  const errors: DraftErrors = { memberAmounts: {} }

  if (!draft.name.trim()) {
    errors.name = 'Escreva o nome da conta, por exemplo "Água".'
  }

  const totalCents = parseMoneyInput(draft.total)
  if (totalCents === null) {
    errors.total = 'Digite o valor da conta, por exemplo 150,00.'
  } else if (totalCents === 0) {
    errors.total = 'O valor precisa ser maior que zero.'
  }
  const hasValidTotal = totalCents !== null && totalCents > 0

  const dueDay = Number(draft.dueDay)
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    errors.dueDay = 'Escolha um dia entre 1 e 31.'
  }

  if (individual) {
    const shares: BillShare[] | null = hasValidTotal ? [] : null
    const isValid = !errors.name && !errors.total && !errors.dueDay && shares !== null
    return { totalCents, shares, errors, customSumCents: 0, sumMatches: true, isValid }
  }

  const count = draft.memberIds.length
  if (count === 0) {
    errors.members = 'Escolha pelo menos uma pessoa para pagar esta conta.'
  }

  let shares: BillShare[] | null = null
  let customSumCents = 0
  let sumMatches = true
  const usesCustomValues = draft.splitMode === 'custom' && count > 1

  if (usesCustomValues) {
    const parsedShares: BillShare[] = []
    let allAmountsValid = true
    for (const memberId of draft.memberIds) {
      const amount = parseMoneyInput(draft.customAmounts[memberId] ?? '')
      if (amount === null) {
        errors.memberAmounts[memberId] = 'Digite um valor.'
        allAmountsValid = false
      } else if (amount === 0) {
        errors.memberAmounts[memberId] = 'Precisa ser maior que zero.'
        allAmountsValid = false
      } else {
        customSumCents += amount
        parsedShares.push({ memberId, amountCents: amount })
      }
    }

    if (hasValidTotal && allAmountsValid) {
      const difference = totalCents - customSumCents
      sumMatches = difference === 0
      if (difference > 0) {
        errors.sum = `Ainda faltam ${formatBRL(difference)} para fechar o total de ${formatBRL(totalCents)}.`
      } else if (difference < 0) {
        errors.sum = `A soma passou ${formatBRL(-difference)} do total de ${formatBRL(totalCents)}.`
      } else {
        shares = parsedShares
      }
    } else {
      sumMatches = false
    }
  } else if (hasValidTotal && count > 0) {
    const amounts = splitEvenly(totalCents, count)
    shares = draft.memberIds.map((memberId, index) => ({
      memberId,
      amountCents: amounts[index],
    }))
  }

  const isValid =
    !errors.name &&
    !errors.total &&
    !errors.dueDay &&
    !errors.members &&
    !errors.sum &&
    Object.keys(errors.memberAmounts).length === 0 &&
    shares !== null

  return { totalCents, shares, errors, customSumCents, sumMatches, isValid }
}
