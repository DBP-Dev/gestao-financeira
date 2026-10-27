import type { Bill, BillShare, Member } from '../domain/types'
import { centsToInput, formatBRL, parseMoneyInput, splitEvenly } from '../domain/money'
import { validateInstallmentCount } from '../domain/series'

export type SplitMode = 'equal' | 'custom'

/** Tipo escolhido ao criar a conta. Edições são sempre de uma conta só ("normal"). */
export type BillKind = 'normal' | 'recurring' | 'installment'

/** Estado do formulário enquanto a pessoa digita (tudo como texto). */
export interface BillDraft {
  name: string
  total: string
  dueDay: string
  memberIds: string[]
  splitMode: SplitMode
  customAmounts: Record<string, string>
  paid: boolean
  kind: BillKind
  /** Quantidade de parcelas como digitada (só no tipo parcelado). */
  installmentCount: string
}

export interface DraftErrors {
  name?: string
  total?: string
  dueDay?: string
  installmentCount?: string
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
  /** Quantidade de parcelas já convertida, quando o tipo é parcelado e ela é válida. */
  installmentCount: number | null
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
      kind: 'normal',
      installmentCount: '',
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
    kind: 'normal',
    installmentCount: '',
  }
}

/** Quantidade de parcelas: só números inteiros de 2 a 120. */
function analyzeInstallmentCount(draft: BillDraft): { value: number | null; error?: string } {
  if (draft.kind !== 'installment') return { value: null }
  const text = draft.installmentCount.trim()
  if (!/^\d+$/.test(text)) {
    return { value: null, error: 'Informe a quantidade de parcelas, de 2 a 120.' }
  }
  const count = Number(text)
  const error = validateInstallmentCount(count)
  return error ? { value: null, error } : { value: count }
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

  const installments = analyzeInstallmentCount(draft)
  if (installments.error) errors.installmentCount = installments.error
  const installmentCount = installments.value

  if (individual) {
    const shares: BillShare[] | null = hasValidTotal ? [] : null
    const isValid =
      !errors.name && !errors.total && !errors.dueDay && !errors.installmentCount && shares !== null
    return {
      totalCents,
      shares,
      errors,
      customSumCents: 0,
      sumMatches: true,
      installmentCount,
      isValid,
    }
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
    !errors.installmentCount &&
    !errors.members &&
    !errors.sum &&
    Object.keys(errors.memberAmounts).length === 0 &&
    shares !== null

  return { totalCents, shares, errors, customSumCents, sumMatches, installmentCount, isValid }
}

/* ---------- Base da nova versão em "esta e as seguintes" ---------- */

/** Nome, valor, vencimento e divisão como são gravados (valores em centavos). */
export interface BillData {
  name: string
  totalCents: number
  dueDay: number
  shares: BillShare[]
}

/** Base escolhida no formulário: os dados da conta selecionada ou os dados da série. */
export type SeriesEditBase = 'account' | 'series'

/** Os dados que o formulário salvaria; null quando o rascunho é inválido. */
export function billDataFromDraft(draft: BillDraft, individual = false): BillData | null {
  const analysis = analyzeDraft(draft, individual)
  if (!analysis.isValid || analysis.shares === null || analysis.totalCents === null) return null
  return {
    name: draft.name.trim(),
    totalCents: analysis.totalCents,
    dueDay: Number(draft.dueDay),
    shares: analysis.shares,
  }
}

/** Divisão por participante; null quando alguém aparece duas vezes. */
function sharesByMember(shares: BillShare[]): Map<string, number> | null {
  const map = new Map<string, number>()
  for (const share of shares) {
    if (map.has(share.memberId)) return null
    map.set(share.memberId, share.amountCents)
  }
  return map
}

/**
 * Os mesmos dados: nome (sem espaços nas pontas), valor, vencimento e o valor de cada
 * participante, em centavos. Só a ordem dos participantes não importa. Dados inválidos
 * (null) ou divisão com alguém repetido nunca são iguais a nada.
 */
export function sameBillData(a: BillData | null, b: BillData | null): boolean {
  if (!a || !b) return false
  if (a.name.trim() !== b.name.trim() || a.totalCents !== b.totalCents || a.dueDay !== b.dueDay) {
    return false
  }
  const sharesA = sharesByMember(a.shares)
  const sharesB = sharesByMember(b.shares)
  if (!sharesA || !sharesB || sharesA.size !== sharesB.size) return false
  for (const [memberId, amountCents] of sharesA) {
    if (sharesB.get(memberId) !== amountCents) return false
  }
  return true
}

/** O rascunho tem exatamente os dados da série (rascunho inválido: não tem). */
export function draftMatchesSeriesData(
  draft: BillDraft,
  data: BillData,
  individual = false,
): boolean {
  return sameBillData(billDataFromDraft(draft, individual), data)
}

/** Diferenças de `from` para `to`, campo a campo; na divisão, participante a participante. */
export interface BillDataDiff {
  name: { from: string; to: string } | null
  totalCents: { from: number; to: number } | null
  dueDay: { from: number; to: number } | null
  /** `from` null: entrou na divisão; `to` null: saiu. */
  shares: { memberId: string; from: number | null; to: number | null }[]
}

export function diffBillData(from: BillData, to: BillData): BillDataDiff {
  const shares: BillDataDiff['shares'] = []
  const toByMember = new Map(to.shares.map((share) => [share.memberId, share.amountCents]))
  const fromIds = new Set(from.shares.map((share) => share.memberId))
  for (const share of from.shares) {
    const next = toByMember.get(share.memberId) ?? null
    if (next !== share.amountCents) {
      shares.push({ memberId: share.memberId, from: share.amountCents, to: next })
    }
  }
  for (const share of to.shares) {
    if (!fromIds.has(share.memberId)) {
      shares.push({ memberId: share.memberId, from: null, to: share.amountCents })
    }
  }
  const name = from.name.trim() !== to.name.trim() ? { from: from.name.trim(), to: to.name.trim() } : null
  return {
    name,
    totalCents: from.totalCents !== to.totalCents ? { from: from.totalCents, to: to.totalCents } : null,
    dueDay: from.dueDay !== to.dueDay ? { from: from.dueDay, to: to.dueDay } : null,
    shares,
  }
}

export function hasDifferences(diff: BillDataDiff): boolean {
  return Boolean(diff.name || diff.totalCents || diff.dueDay || diff.shares.length > 0)
}

/**
 * Rascunho com os dados da série, exatamente como estão (mesma ordem, mesmos centavos e
 * participantes desativados, se houver). O pagamento fica a cargo de quem chama.
 */
export function draftFromSeriesData(data: BillData): BillDraft {
  const { name, totalCents, dueDay, shares } = data
  return createDraft({ id: '', month: '', paid: false, name, totalCents, dueDay, shares })
}

/**
 * De onde vêm os valores finais de "esta e as seguintes": iguais aos dados da série (isso
 * é conferido primeiro), iguais aos dados da conta selecionada, ou editados a partir da
 * base escolhida (com o que mudou em relação a ela).
 */
export type SeriesEditOrigin =
  | { kind: 'series' }
  | { kind: 'account' }
  | { kind: 'edited'; base: SeriesEditBase; changes: BillDataDiff }

export function describeSeriesEditOrigin(
  final: BillData,
  seriesData: BillData,
  accountData: BillData,
  base: SeriesEditBase,
): SeriesEditOrigin {
  if (sameBillData(final, seriesData)) return { kind: 'series' }
  if (sameBillData(final, accountData)) return { kind: 'account' }
  return {
    kind: 'edited',
    base,
    changes: diffBillData(base === 'series' ? seriesData : accountData, final),
  }
}
