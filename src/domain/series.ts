import type {
  Area,
  Bill,
  BillSeries,
  BillShare,
  FinanceData,
  MonthKey,
  SeriesKind,
  SeriesVersion,
  Today,
} from './types'
import { HOME_AREA_ID } from './areas'
import { MAX_BILL_NAME_LENGTH, MAX_BILLS, MAX_INSTALLMENTS } from './backup'
import { formatMonthLabel } from './dates'
import { getMemberRemoval } from './members'
import { createId } from './ids'
import { MAX_AMOUNT_CENTS } from './money'

/**
 * Regras puras das contas recorrentes e parceladas. Nenhuma função aqui lê ou grava
 * o armazenamento: todas recebem dados e devolvem dados novos (ou os mesmos, quando
 * não há o que mudar).
 */

/* ---------- Meses ---------- */

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

/** Mês no formato "AAAA-MM" e existente (de 01 a 12), como o validador exige. */
export function isValidMonth(value: unknown): value is MonthKey {
  return typeof value === 'string' && MONTH_PATTERN.test(value)
}

const SERIES_KINDS: readonly SeriesKind[] = ['recurring', 'installment']

/** Número sequencial do mês, para comparar meses e medir a distância entre eles. */
export function monthIndex(month: MonthKey): number {
  const [year, monthNumber] = month.split('-').map(Number)
  return year * 12 + monthNumber - 1
}

/** Mês correspondente a um número sequencial (inverso de `monthIndex`). */
export function monthFromIndex(index: number): MonthKey {
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return `${year}-${String(month).padStart(2, '0')}`
}

/** Último mês em que a série gera conta, ou null se ela não tem fim (recorrente em aberto). */
export function seriesEndMonth(series: BillSeries): MonthKey | null {
  if (series.kind === 'installment') {
    return monthFromIndex(monthIndex(series.startMonth) + (series.installmentCount ?? 0) - 1)
  }
  return series.lastMonth ?? null
}

/** O mês está dentro do período da série (sem considerar as exclusões). */
export function isWithinSeries(series: BillSeries, month: MonthKey): boolean {
  if (month < series.startMonth) return false
  const end = seriesEndMonth(series)
  return end === null || month <= end
}

/** Dados da série que valem no mês: a versão de maior `fromMonth` que não passa do mês. */
export function versionForMonth(series: BillSeries, month: MonthKey): SeriesVersion | null {
  let current: SeriesVersion | null = null
  for (const version of series.versions) {
    if (version.fromMonth <= month) current = version
    else break
  }
  return current
}

/** Número original da parcela no mês (posição a partir do início), ou null se não for parcelada. */
export function installmentNumberFor(series: BillSeries, month: MonthKey): number | null {
  if (series.kind !== 'installment') return null
  return monthIndex(month) - monthIndex(series.startMonth) + 1
}

/* ---------- Ocorrências e previsões ---------- */

/** Conta prevista de uma série: só para exibir e somar, nunca é gravada como está. */
export interface ProjectedBill extends Bill {
  projected: true
  seriesId: string
}

export function isProjectedBill(bill: Bill): bill is ProjectedBill {
  return (bill as Partial<ProjectedBill>).projected === true
}

/** Id da prevista, só para a tela. Não colide com ids gravados (que são UUIDs). */
export function projectedBillId(seriesId: string, month: MonthKey): string {
  return `prevista:${seriesId}:${month}`
}

/**
 * "Recorrente", "Recorrente até dezembro de 2026" (encerrada) ou "Parcela 3/10" (o total
 * vem da série); null em contas comuns.
 */
export function seriesLabelFor(bill: Bill, series: BillSeries[]): string | null {
  if (bill.seriesId === undefined) return null
  const owner = series.find((item) => item.id === bill.seriesId)
  if (!owner) return null
  if (owner.kind === 'recurring') {
    return owner.lastMonth === undefined
      ? 'Recorrente'
      : `Recorrente até ${formatMonthLabel(owner.lastMonth).toLowerCase()}`
  }
  return `Parcela ${bill.installmentNumber}/${owner.installmentCount}`
}

/** A ocorrência gravada da série no mês, se existir. */
export function findOccurrence(area: Area, seriesId: string, month: MonthKey): Bill | undefined {
  return area.bills.find((bill) => bill.seriesId === seriesId && bill.month === month)
}

/** Conta do mês montada a partir dos dados vigentes da série (sem id). */
function occurrenceFromSeries(series: BillSeries, month: MonthKey): Omit<Bill, 'id'> | null {
  const version = versionForMonth(series, month)
  if (!version) return null
  const occurrence: Omit<Bill, 'id'> = {
    name: version.name,
    month,
    totalCents: version.totalCents,
    dueDay: version.dueDay,
    shares: version.shares.map((share) => ({ ...share })),
    paid: false,
    seriesId: series.id,
  }
  const number = installmentNumberFor(series, month)
  if (number !== null) occurrence.installmentNumber = number
  return occurrence
}

/** Chave de uma ocorrência: a mesma série só pode ter uma conta por mês. */
function occurrenceKey(seriesId: string, month: MonthKey): string {
  return `${seriesId}|${month}`
}

/**
 * Chaves das ocorrências gravadas na área, montadas uma única vez, para não percorrer
 * todas as contas a cada série e mês consultados.
 */
function recordedOccurrences(bills: Bill[]): Set<string> {
  const keys = new Set<string>()
  for (const bill of bills) {
    if (bill.seriesId !== undefined) keys.add(occurrenceKey(bill.seriesId, bill.month))
  }
  return keys
}

/** A série precisa de uma conta no mês: dentro do período, não excluído e ainda sem registro. */
function needsOccurrence(
  series: BillSeries,
  month: MonthKey,
  recorded: Set<string>,
  skipped: Set<MonthKey>,
): boolean {
  return (
    isWithinSeries(series, month) &&
    !skipped.has(month) &&
    !recorded.has(occurrenceKey(series.id, month))
  )
}

/**
 * Previstas do mês: uma por série que cobre o mês, sem registro gravado e sem exclusão.
 * Quando a ocorrência já está gravada, ela aparece entre as contas da área e a previsão
 * não existe, por isso a mesma conta nunca é contada duas vezes.
 */
export function projectedBillsForMonth(area: Area, month: MonthKey): ProjectedBill[] {
  // Mês inválido nunca gera previsões (ex.: "2027-13" passaria na comparação de textos).
  if (!isValidMonth(month) || area.series.length === 0) return []
  const recorded = recordedOccurrences(area.bills.filter((bill) => bill.month === month))
  const projected: ProjectedBill[] = []
  for (const series of area.series) {
    if (!needsOccurrence(series, month, recorded, new Set(series.skippedMonths))) continue
    const occurrence = occurrenceFromSeries(series, month)
    if (!occurrence) continue
    projected.push({
      ...occurrence,
      id: projectedBillId(series.id, month),
      seriesId: series.id,
      projected: true,
    })
  }
  return projected
}

/** Contas do mês na área: as gravadas e as previstas das séries. */
export function billsForMonth(area: Area, month: MonthKey): Bill[] {
  return [
    ...area.bills.filter((bill) => bill.month === month),
    ...projectedBillsForMonth(area, month),
  ]
}

/* ---------- Gravação automática ---------- */

/** Total de contas gravadas em todas as áreas (o limite do validador é global). */
export function totalBills(data: FinanceData): number {
  return data.areas.reduce((sum, area) => sum + area.bills.length, 0)
}

/** Ocorrência que a gravação automática precisava criar: (área, série, mês). */
export interface PendingOccurrence {
  areaId: string
  seriesId: string
  month: MonthKey
}

export interface MaterializeResult {
  /** Os mesmos dados (mesmo objeto) quando nada precisou ser gravado. */
  data: FinanceData
  /** Quantas ocorrências foram criadas. */
  created: number
  /** Gravar ultrapassaria o limite de contas: nada foi criado. */
  limitExceeded: boolean
  /** Só quando o limite impediu a gravação: as ocorrências que precisavam ser criadas. */
  pending?: PendingOccurrence[]
}

/**
 * Grava as ocorrências que chegaram até o mês atual real e ainda não existem.
 * Idempotente: só cria (série, mês) sem registro e fora das exclusões, então rodar de
 * novo não cria nada. Se o total de contas passar do limite do validador, não grava nada.
 */
export function materializeDue(
  data: FinanceData,
  today: Today,
  newId: () => string = createId,
): MaterializeResult {
  const nothing: MaterializeResult = { data, created: 0, limitExceeded: false }
  // Data de referência inválida: não há como saber o que já chegou, então nada é gravado.
  if (!isValidMonth(today.month)) return nothing
  if (!data.areas.some((area) => area.series.length > 0)) return nothing

  const usedIds = new Set(data.areas.flatMap((area) => area.bills.map((bill) => bill.id)))
  const nextId = () => {
    let id = newId()
    while (usedIds.has(id)) id = newId()
    usedIds.add(id)
    return id
  }

  let created = 0
  const pending: PendingOccurrence[] = []
  const areas = data.areas.map((area) => {
    if (area.series.length === 0) return area
    const recorded = recordedOccurrences(area.bills)
    const additions: Bill[] = []
    for (const series of area.series) {
      const end = seriesEndMonth(series)
      const last = end !== null && end < today.month ? end : today.month
      const skipped = new Set(series.skippedMonths)
      for (let index = monthIndex(series.startMonth); index <= monthIndex(last); index++) {
        const month = monthFromIndex(index)
        if (!needsOccurrence(series, month, recorded, skipped)) continue
        const occurrence = occurrenceFromSeries(series, month)
        if (!occurrence) continue
        additions.push({ ...occurrence, id: nextId() })
        pending.push({ areaId: area.id, seriesId: series.id, month })
        recorded.add(occurrenceKey(series.id, month))
      }
    }
    created += additions.length
    return additions.length > 0 ? { ...area, bills: [...area.bills, ...additions] } : area
  })

  if (created === 0) return nothing
  if (totalBills(data) + created > MAX_BILLS) {
    return { data, created: 0, limitExceeded: true, pending }
  }
  return { data: { ...data, areas }, created, limitExceeded: false }
}

/**
 * Das ocorrências que o limite impediu de gravar, as que ainda precisam ser criadas
 * nos dados atuais. Uma ocorrência deixa de estar pendente quando foi gravada (paga ou
 * editada), excluída, ou quando a área, a série ou o período dela mudaram.
 * Usa a mesma regra da gravação automática, então a contagem nunca fica desatualizada.
 */
export function stillPending(
  data: FinanceData,
  pending: PendingOccurrence[],
): PendingOccurrence[] {
  const areasById = new Map(data.areas.map((area) => [area.id, area]))
  const recordedByArea = new Map<string, Set<string>>()
  const skippedBySeries = new Map<BillSeries, Set<MonthKey>>()
  return pending.filter((item) => {
    const area = areasById.get(item.areaId)
    const series = area?.series.find((candidate) => candidate.id === item.seriesId)
    if (!area || !series) return false
    let recorded = recordedByArea.get(area.id)
    if (!recorded) {
      recorded = recordedOccurrences(area.bills)
      recordedByArea.set(area.id, recorded)
    }
    let skipped = skippedBySeries.get(series)
    if (!skipped) {
      skipped = new Set(series.skippedMonths)
      skippedBySeries.set(series, skipped)
    }
    return needsOccurrence(series, item.month, recorded, skipped)
  })
}

/* ---------- Criação ---------- */

/** Mensagem de erro para a quantidade de parcelas, ou null se estiver dentro de 2 a 120. */
export function validateInstallmentCount(count: number): string | null {
  if (!Number.isInteger(count) || count < 2 || count > MAX_INSTALLMENTS) {
    return `A quantidade de parcelas precisa ser de 2 a ${MAX_INSTALLMENTS}.`
  }
  return null
}

export interface NewSeriesInput {
  kind: SeriesKind
  /** Mês de início: o mês selecionado no formulário. */
  startMonth: MonthKey
  /** Só parcelada. */
  installmentCount?: number
  name: string
  /** Valor de cada ocorrência (numa parcelada, de cada parcela). */
  totalCents: number
  dueDay: number
  /** Divisão entre participantes; ignorada em áreas individuais. */
  shares: BillShare[]
  /** "Esta conta já foi paga": vale só para a primeira ocorrência. */
  firstPaid: boolean
}

export type SeriesChangeResult = { ok: true; data: FinanceData } | { ok: false; error: string }

export const INACTIVE_IN_SHARES_MESSAGE =
  'A divisão inclui um participante desativado. Tire essa pessoa da divisão para continuar.'

/**
 * Confere a divisão com as mesmas regras do validador, usando só participantes ativos.
 * `alsoAllowed`: participantes da área aceitos mesmo desativados (os que já estão na conta).
 */
export function validateNewShares(
  area: Area,
  shares: BillShare[],
  totalCents: number,
  alsoAllowed: ReadonlySet<string> = new Set(),
): string | null {
  if (shares.length === 0) return 'Escolha pelo menos uma pessoa para pagar esta conta.'
  const activeIds = new Set(
    area.members
      .filter((member) => !member.inactive || alsoAllowed.has(member.id))
      .map((m) => m.id),
  )
  const seen = new Set<string>()
  let sum = 0
  for (const share of shares) {
    if (!activeIds.has(share.memberId)) {
      return area.members.some((member) => member.id === share.memberId)
        ? INACTIVE_IN_SHARES_MESSAGE
        : 'A divisão inclui alguém que não participa desta área.'
    }
    if (seen.has(share.memberId)) return 'A divisão repete a mesma pessoa.'
    seen.add(share.memberId)
    if (!Number.isSafeInteger(share.amountCents) || share.amountCents <= 0) {
      return 'Cada parte da divisão precisa ser maior que zero.'
    }
    sum += share.amountCents
  }
  return sum === totalCents ? null : 'As partes não somam exatamente o valor da conta.'
}

/** Nome, valor e vencimento de uma conta de série, com as mesmas regras do validador. */
function validateBillFields(input: {
  name: string
  totalCents: number
  dueDay: number
}): string | null {
  const name = input.name.trim()
  if (!name) return 'Escreva o nome da conta.'
  if (name.length > MAX_BILL_NAME_LENGTH) {
    return `O nome pode ter no máximo ${MAX_BILL_NAME_LENGTH} letras.`
  }
  if (
    !Number.isSafeInteger(input.totalCents) ||
    input.totalCents <= 0 ||
    input.totalCents > MAX_AMOUNT_CENTS
  ) {
    return 'O valor precisa ser maior que zero.'
  }
  if (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 31) {
    return 'Escolha um dia de vencimento entre 1 e 31.'
  }
  return null
}

/**
 * Cria uma série na área e grava a primeira ocorrência (com "já foi paga", se marcado).
 * Séries só começam no mês atual ou num mês futuro.
 */
export function createSeries(
  data: FinanceData,
  areaId: string,
  input: NewSeriesInput,
  today: Today,
  newId: () => string = createId,
): SeriesChangeResult {
  const area = data.areas.find((item) => item.id === areaId)
  if (!area) return { ok: false, error: 'A área desta conta não foi encontrada.' }
  if (!isValidMonth(today.month)) {
    return { ok: false, error: 'A data de referência é inválida.' }
  }
  if (!SERIES_KINDS.includes(input.kind)) {
    return { ok: false, error: 'O tipo da conta é inválido.' }
  }
  if (!isValidMonth(input.startMonth)) {
    return { ok: false, error: 'O mês de início é inválido.' }
  }
  if (input.startMonth < today.month) {
    return {
      ok: false,
      error: 'Contas recorrentes e parceladas só podem começar no mês atual ou em um mês futuro.',
    }
  }
  if (input.kind === 'installment') {
    const countError = validateInstallmentCount(input.installmentCount ?? 0)
    if (countError) return { ok: false, error: countError }
  }
  const fieldsError = validateBillFields(input)
  if (fieldsError) return { ok: false, error: fieldsError }
  const name = input.name.trim()
  const shares = area.type === 'individual' ? [] : input.shares.map((share) => ({ ...share }))
  if (area.type === 'shared') {
    const sharesError = validateNewShares(area, shares, input.totalCents)
    if (sharesError) return { ok: false, error: sharesError }
  }
  if (totalBills(data) + 1 > MAX_BILLS) {
    return { ok: false, error: 'O limite de contas guardadas foi atingido.' }
  }

  const usedSeriesIds = new Set(data.areas.flatMap((item) => item.series.map((s) => s.id)))
  const usedBillIds = new Set(data.areas.flatMap((item) => item.bills.map((bill) => bill.id)))
  let seriesId = newId()
  while (usedSeriesIds.has(seriesId)) seriesId = newId()
  let billId = newId()
  while (usedBillIds.has(billId) || billId === seriesId) billId = newId()

  const series: BillSeries = {
    id: seriesId,
    kind: input.kind,
    startMonth: input.startMonth,
    versions: [
      {
        fromMonth: input.startMonth,
        name,
        totalCents: input.totalCents,
        dueDay: input.dueDay,
        shares,
      },
    ],
    skippedMonths: [],
  }
  if (input.kind === 'installment') series.installmentCount = input.installmentCount

  const first = occurrenceFromSeries(series, input.startMonth)
  if (!first) return { ok: false, error: 'Não foi possível montar a primeira conta da série.' }
  const firstBill: Bill = { ...first, id: billId, paid: input.firstPaid }

  return {
    ok: true,
    data: {
      ...data,
      areas: data.areas.map((item) =>
        item.id === areaId
          ? { ...item, series: [...item.series, series], bills: [...item.bills, firstBill] }
          : item,
      ),
    },
  }
}

/* ---------- Ocorrências individuais ---------- */

export const PAID_OCCURRENCE_DELETE_MESSAGE =
  'Esta conta já está paga. Para preservar o histórico de pagamentos, marque-a como pendente antes de excluí-la.'

export const OCCURRENCE_LIMIT_MESSAGE =
  'Não foi possível gravar esta conta: o limite de 20.000 contas guardadas foi atingido.'

/** Área e série de uma ocorrência, ou a mensagem de erro quando não existem. */
function locateOccurrence(
  data: FinanceData,
  areaId: string,
  seriesId: string,
  month: MonthKey,
): { ok: true; area: Area; series: BillSeries } | { ok: false; error: string } {
  const area = data.areas.find((item) => item.id === areaId)
  if (!area) return { ok: false, error: 'A área desta conta não foi encontrada.' }
  const series = area.series.find((item) => item.id === seriesId)
  if (!series) return { ok: false, error: 'A conta recorrente ou parcelada não foi encontrada.' }
  if (!isValidMonth(month)) return { ok: false, error: 'O mês da conta é inválido.' }
  return { ok: true, area, series }
}

/** A série ainda pode gravar a ocorrência do mês: dentro do período e não excluída. */
function canRecordOccurrence(series: BillSeries, month: MonthKey): boolean {
  return isWithinSeries(series, month) && !series.skippedMonths.includes(month)
}

/** Id novo que não repete nenhum id de conta já gravado. */
function newBillId(data: FinanceData, newId: () => string): string {
  const used = new Set(data.areas.flatMap((area) => area.bills.map((bill) => bill.id)))
  let id = newId()
  while (used.has(id)) id = newId()
  return id
}

function replaceArea(data: FinanceData, area: Area): FinanceData {
  return { ...data, areas: data.areas.map((item) => (item.id === area.id ? area : item)) }
}

const NOT_AVAILABLE_MESSAGE =
  'Esta conta não pode mais ser criada: ela foi excluída ou está fora do período da série.'

/**
 * Paga uma prevista: grava a ocorrência do mês com os dados vigentes da série, já paga.
 * Se a ocorrência já estiver gravada (ex.: clique repetido), nada muda.
 */
export function payProjectedOccurrence(
  data: FinanceData,
  areaId: string,
  seriesId: string,
  month: MonthKey,
  newId: () => string = createId,
): SeriesChangeResult {
  const located = locateOccurrence(data, areaId, seriesId, month)
  if (!located.ok) return located
  const { area, series } = located
  if (findOccurrence(area, seriesId, month)) return { ok: true, data }
  if (!canRecordOccurrence(series, month)) return { ok: false, error: NOT_AVAILABLE_MESSAGE }
  if (totalBills(data) + 1 > MAX_BILLS) return { ok: false, error: OCCURRENCE_LIMIT_MESSAGE }
  const occurrence = occurrenceFromSeries(series, month)
  if (!occurrence) return { ok: false, error: NOT_AVAILABLE_MESSAGE }
  const bill: Bill = { ...occurrence, id: newBillId(data, newId), paid: true }
  return { ok: true, data: replaceArea(data, { ...area, bills: [...area.bills, bill] }) }
}

/**
 * Exclui uma ocorrência sem mexer na série: remove o registro (se houver) e grava a
 * exclusão permanente, para o mês não voltar. Ocorrência paga não é excluída.
 * Numa recorrente encerrada, a ocorrência mantida depois do último mês só tem o registro
 * removido: depois do fim nada é gerado de novo, e o validador não aceita exclusões ali.
 * O mesmo vale para uma parcela gravada além da 120ª posição.
 */
export function deleteOccurrence(
  data: FinanceData,
  areaId: string,
  seriesId: string,
  month: MonthKey,
): SeriesChangeResult {
  const located = locateOccurrence(data, areaId, seriesId, month)
  if (!located.ok) return located
  const { area, series } = located
  const record = findOccurrence(area, seriesId, month)
  if (record?.paid) return { ok: false, error: PAID_OCCURRENCE_DELETE_MESSAGE }

  const bills = record ? area.bills.filter((bill) => bill !== record) : area.bills
  const position = monthIndex(month) - monthIndex(series.startMonth)
  const afterEnd =
    series.kind === 'recurring' && series.lastMonth !== undefined && month > series.lastMonth
  // Parcelada só guarda exclusões até a 120ª posição (como o validador exige); além
  // disso nenhuma parcela é gerada, então basta remover o registro.
  const beyondInstallments = series.kind === 'installment' && position >= MAX_INSTALLMENTS
  if (record && (afterEnd || beyondInstallments)) {
    return { ok: true, data: replaceArea(data, { ...area, bills }) }
  }

  // Exclusão já gravada: nada a fazer (o validador garante que não há registro no mês).
  if (series.skippedMonths.includes(month)) return { ok: true, data }
  const valid =
    position >= 0 &&
    !afterEnd &&
    !beyondInstallments &&
    (record !== undefined || isWithinSeries(series, month))
  if (!valid) return { ok: false, error: 'Esta conta não faz parte da série neste mês.' }

  const skippedMonths = [...series.skippedMonths, month].sort()
  return {
    ok: true,
    data: replaceArea(data, {
      ...area,
      bills,
      series: area.series.map((item) => (item === series ? { ...series, skippedMonths } : item)),
    }),
  }
}

/** Dados de uma ocorrência que "só esta" pode corrigir. Mês, série e parcela ficam fixos. */
export interface OccurrenceInput {
  name: string
  totalCents: number
  dueDay: number
  /** Ignorada em áreas individuais. */
  shares: BillShare[]
  paid: boolean
}

function sameShares(a: BillShare[], b: BillShare[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (share, index) =>
        share.memberId === b[index].memberId && share.amountCents === b[index].amountCents,
    )
  )
}

/**
 * Edita "só esta" ocorrência, gravada (paga ou não) ou prevista, sem alterar a série.
 * Mudou nome, valor, vencimento ou divisão: a ocorrência fica marcada como editada
 * individualmente. Mudou só o pagamento: é a mesma coisa que marcar como paga ou pendente.
 * Sem nenhuma mudança, os dados ficam os mesmos.
 */
export function editOccurrence(
  data: FinanceData,
  areaId: string,
  seriesId: string,
  month: MonthKey,
  input: OccurrenceInput,
  newId: () => string = createId,
): SeriesChangeResult {
  const located = locateOccurrence(data, areaId, seriesId, month)
  if (!located.ok) return located
  const { area, series } = located
  const record = findOccurrence(area, seriesId, month)
  const base = record ?? occurrenceFromSeries(series, month)
  if (!record && (!base || !canRecordOccurrence(series, month))) {
    return { ok: false, error: NOT_AVAILABLE_MESSAGE }
  }
  if (!base) return { ok: false, error: NOT_AVAILABLE_MESSAGE }

  const fieldsError = validateBillFields(input)
  if (fieldsError) return { ok: false, error: fieldsError }
  const name = input.name.trim()
  const shares = area.type === 'individual' ? [] : input.shares.map((share) => ({ ...share }))
  if (area.type === 'shared') {
    // Quem já está na conta continua aceito, mesmo desativado: corrigir outro campo não
    // pode exigir mudar a divisão.
    const current = new Set(base.shares.map((share) => share.memberId))
    const sharesError = validateNewShares(area, shares, input.totalCents, current)
    if (sharesError) return { ok: false, error: sharesError }
  }

  const fieldsChanged =
    name !== base.name ||
    input.totalCents !== base.totalCents ||
    input.dueDay !== base.dueDay ||
    !sameShares(shares, base.shares)
  if (!fieldsChanged && input.paid === base.paid) return { ok: true, data }

  const edited = {
    name,
    totalCents: input.totalCents,
    dueDay: input.dueDay,
    shares,
    paid: input.paid,
    ...(fieldsChanged || record?.overridden ? { overridden: true } : {}),
  }
  if (record) {
    const bills = area.bills.map((bill) => (bill === record ? { ...record, ...edited } : bill))
    return { ok: true, data: replaceArea(data, { ...area, bills }) }
  }
  if (totalBills(data) + 1 > MAX_BILLS) return { ok: false, error: OCCURRENCE_LIMIT_MESSAGE }
  const bill: Bill = { ...base, ...edited, id: newBillId(data, newId) }
  return { ok: true, data: replaceArea(data, { ...area, bills: [...area.bills, bill] }) }
}

/* ---------- "Esta e as seguintes" ---------- */

/** Novos dados da série a partir do mês de vigência. */
export interface SeriesEditInput {
  name: string
  totalCents: number
  dueDay: number
  /** Ignorada em áreas individuais. */
  shares: BillShare[]
}

/** Resposta da pessoa sobre as outras ocorrências editadas individualmente afetadas. */
export type OverriddenChoice = 'preserve' | 'replace'

/** Resumo da alteração, para a confirmação. Não é usado para aplicar. */
export interface SeriesEditPlan {
  /** Mês a partir do qual a nova versão vale. */
  effectiveMonth: MonthKey
  /** A ocorrência escolhida já está paga (por isso a vigência começa no mês seguinte). */
  selectedPaid: boolean
  /** Meses de alterações já programadas, depois da vigência, que serão substituídas. */
  replacedVersionMonths: MonthKey[]
  /** Ocorrências gravadas e pendentes que passam a seguir os novos dados. */
  updatedCount: number
  /** Outras ocorrências pendentes editadas individualmente: dependem da escolha da pessoa. */
  overriddenCount: number
  /** Ocorrências pagas da vigência em diante: ficam com os dados antigos. */
  paidKeptCount: number
  /** Há algo a mudar (versões ou ocorrências gravadas). */
  hasChanges: boolean
  /** Dados da série no mês de vigência, antes da alteração (para comparar). */
  baseline: SeriesEditInput
  /** A ocorrência escolhida está gravada e marcada como editada individualmente. */
  selectedOverridden: boolean
  /**
   * O que acontece com a ocorrência escolhida: paga, continua igual; senão, passa a seguir
   * os novos dados (e, se estiver marcada, deixa de ser editada individualmente).
   */
  selectedOutcome: 'paid' | 'follows'
  /** Meses das outras ocorrências gravadas e pendentes que serão atualizadas. */
  updatedMonths: MonthKey[]
  /** Meses das outras ocorrências pendentes editadas individualmente (dependem da escolha). */
  overriddenMonths: MonthKey[]
  /** Meses das ocorrências pagas da vigência em diante (continuam iguais). */
  paidKeptMonths: MonthKey[]
  /**
   * Meses de contas previstas (sem conta gravada nem exclusão) cujos dados mudam, fora o
   * trecho final de `projectedChangesFrom`.
   */
  projectedChangedMonths: MonthKey[]
  /** Numa série sem fim: todas as previstas deste mês em diante mudam; senão, null. */
  projectedChangesFrom: MonthKey | null
}

export const SERIES_EDIT_UNAVAILABLE_MESSAGE =
  '“Esta e as seguintes” não está disponível: não há contas seguintes nesta série.'

export const OVERRIDDEN_CHOICE_MESSAGE =
  'Escolha se as contas editadas individualmente serão preservadas ou substituídas.'

function sameVersion(a: SeriesVersion, b: SeriesVersion): boolean {
  return (
    a.fromMonth === b.fromMonth &&
    a.name === b.name &&
    a.totalCents === b.totalCents &&
    a.dueDay === b.dueDay &&
    sameShares(a.shares, b.shares)
  )
}

/** Mesmo nome, valor, vencimento e divisão (em qualquer ordem); o mês de início não conta. */
function sameVersionData(a: SeriesVersion, b: SeriesVersion): boolean {
  if (a.name !== b.name || a.totalCents !== b.totalCents || a.dueDay !== b.dueDay) return false
  const amounts = new Map(a.shares.map((share) => [share.memberId, share.amountCents]))
  return (
    amounts.size === a.shares.length &&
    a.shares.length === b.shares.length &&
    b.shares.every((share) => amounts.get(share.memberId) === share.amountCents)
  )
}

/**
 * Contas previstas (meses sem conta gravada nem exclusão) da vigência em diante cujos dados
 * mudam com a nova versão. Só serve ao resumo. Numa série sem fim, depois do último mês
 * com versão, conta gravada ou exclusão tudo segue a última versão antiga: se ela muda,
 * `from` é o início desse trecho final (com as previstas logo antes dele que também
 * mudam) e esses meses saem da lista.
 */
function projectedChanges(
  series: BillSeries,
  recordedMonths: ReadonlySet<MonthKey>,
  effectiveMonth: MonthKey,
  newVersion: SeriesVersion,
): { months: MonthKey[]; from: MonthKey | null } {
  const end = seriesEndMonth(series)
  const start = monthIndex(effectiveMonth)
  const lastOld = series.versions[series.versions.length - 1]
  let horizon = end !== null ? monthIndex(end) : Math.max(start, monthIndex(lastOld.fromMonth))
  if (end === null) {
    for (const key of [...recordedMonths, ...series.skippedMonths]) {
      horizon = Math.max(horizon, monthIndex(key))
    }
  }
  const skipped = new Set(series.skippedMonths)
  const isProjected = (key: MonthKey) => !recordedMonths.has(key) && !skipped.has(key)
  const changes = (key: MonthKey) => {
    const old = versionForMonth(series, key)
    return old !== null && !sameVersionData(old, newVersion)
  }
  const months: MonthKey[] = []
  for (let index = start; index <= horizon; index++) {
    const key = monthFromIndex(index)
    if (isProjected(key) && changes(key)) months.push(key)
  }
  if (end !== null || sameVersionData(lastOld, newVersion)) return { months, from: null }
  let fromIndex = horizon + 1
  for (let index = horizon; index >= start; index--) {
    const key = monthFromIndex(index)
    if (!isProjected(key)) continue
    if (!changes(key)) break
    fromIndex = index
  }
  return {
    months: months.filter((key) => monthIndex(key) < fromIndex),
    from: monthFromIndex(fromIndex),
  }
}

type PreparedSeriesEdit =
  | { ok: false; error: string }
  | {
      ok: true
      plan: SeriesEditPlan
      /** Aplica a alteração com a escolha sobre as editadas individualmente. */
      apply: (choice: OverriddenChoice | null) => SeriesChangeResult
    }

/**
 * Valida a alteração com os dados atuais e calcula tudo o que ela muda.
 * Regras: a vigência vem de `seriesEditStartMonth`; as versões anteriores à vigência
 * ficam e as demais são substituídas pela nova; ocorrências pagas nunca mudam; as
 * pendentes dentro do período passam a seguir a nova versão (as editadas
 * individualmente, só com "substituir", exceto a própria ocorrência escolhida).
 * Exclusões, início, fim e quantidade de parcelas não mudam.
 */
function prepareSeriesEdit(
  data: FinanceData,
  areaId: string,
  seriesId: string,
  month: MonthKey,
  input: SeriesEditInput,
): PreparedSeriesEdit {
  const located = locateOccurrence(data, areaId, seriesId, month)
  if (!located.ok) return located
  const { area, series } = located
  const record = findOccurrence(area, seriesId, month)
  if (!record && !canRecordOccurrence(series, month)) {
    return { ok: false, error: NOT_AVAILABLE_MESSAGE }
  }
  const selectedPaid = record?.paid ?? false
  const effectiveMonth = seriesEditStartMonth(series, { month, paid: selectedPaid })
  if (effectiveMonth === null) return { ok: false, error: SERIES_EDIT_UNAVAILABLE_MESSAGE }
  const baseline = seriesDataAt(series, effectiveMonth)
  if (!baseline) return { ok: false, error: SERIES_EDIT_UNAVAILABLE_MESSAGE }

  const fieldsError = validateBillFields(input)
  if (fieldsError) return { ok: false, error: fieldsError }
  const shares = area.type === 'individual' ? [] : input.shares.map((share) => ({ ...share }))
  if (area.type === 'shared') {
    // A nova versão só usa participantes ativos (sem a exceção do "só esta").
    const sharesError = validateNewShares(area, shares, input.totalCents)
    if (sharesError) return { ok: false, error: sharesError }
  }

  const newVersion: SeriesVersion = {
    fromMonth: effectiveMonth,
    name: input.name.trim(),
    totalCents: input.totalCents,
    dueDay: input.dueDay,
    shares,
  }
  // Vigência no início da série: a nova versão vira a primeira (a lista fica vazia).
  const kept = series.versions.filter((version) => version.fromMonth < effectiveMonth)
  const versions = [...kept, newVersion]
  const versionsChanged =
    versions.length !== series.versions.length ||
    versions.some((version, index) => !sameVersion(version, series.versions[index]))
  const replacedVersionMonths = series.versions
    .filter((version) => version.fromMonth > effectiveMonth)
    .map((version) => version.fromMonth)

  // Ocorrências gravadas da vigência até o fim da série.
  const affected = area.bills.filter(
    (bill) =>
      bill.seriesId === series.id &&
      bill.month >= effectiveMonth &&
      isWithinSeries(series, bill.month),
  )
  const isOtherOverridden = (bill: Bill) => !bill.paid && bill.overridden && bill.month !== month
  const paidKeptCount = affected.filter((bill) => bill.paid).length
  const overriddenCount = affected.filter(isOtherOverridden).length

  /** Ocorrência com os dados da nova versão; sem a marca de editada individualmente. */
  const followVersion = (bill: Bill): Bill => {
    const updated: Bill = {
      ...bill,
      name: newVersion.name,
      totalCents: newVersion.totalCents,
      dueDay: newVersion.dueDay,
      shares: newVersion.shares.map((share) => ({ ...share })),
    }
    delete updated.overridden
    return updated
  }
  const differs = (a: Bill, b: Bill) =>
    a.name !== b.name ||
    a.totalCents !== b.totalCents ||
    a.dueDay !== b.dueDay ||
    !sameShares(a.shares, b.shares) ||
    a.overridden !== b.overridden

  const willUpdate = (bill: Bill, choice: OverriddenChoice | null) =>
    !bill.paid && (!isOtherOverridden(bill) || choice === 'replace')
  const updatedCount = affected.filter(
    (bill) => !bill.paid && !isOtherOverridden(bill) && differs(bill, followVersion(bill)),
  ).length

  const monthsOf = (bills: Bill[]) => bills.map((bill) => bill.month).sort()
  const projected = projectedChanges(
    series,
    new Set(area.bills.filter((bill) => bill.seriesId === series.id).map((bill) => bill.month)),
    effectiveMonth,
    newVersion,
  )
  const plan: SeriesEditPlan = {
    effectiveMonth,
    selectedPaid,
    replacedVersionMonths,
    updatedCount,
    overriddenCount,
    paidKeptCount,
    hasChanges: versionsChanged || updatedCount > 0 || overriddenCount > 0,
    // Só para a confirmação: o que já existe acima continua decidindo o que muda.
    baseline,
    selectedOverridden: record?.overridden === true,
    selectedOutcome: selectedPaid ? 'paid' : 'follows',
    updatedMonths: monthsOf(
      affected.filter(
        (bill) =>
          bill.month !== month &&
          !bill.paid &&
          !isOtherOverridden(bill) &&
          differs(bill, followVersion(bill)),
      ),
    ),
    overriddenMonths: monthsOf(affected.filter(isOtherOverridden)),
    paidKeptMonths: monthsOf(affected.filter((bill) => bill.paid)),
    projectedChangedMonths: projected.months,
    projectedChangesFrom: projected.from,
  }

  const apply = (choice: OverriddenChoice | null): SeriesChangeResult => {
    if (overriddenCount > 0 && choice === null) {
      return { ok: false, error: OVERRIDDEN_CHOICE_MESSAGE }
    }
    const affectedSet = new Set(affected)
    let billsChanged = false
    const bills = area.bills.map((bill) => {
      if (!affectedSet.has(bill) || !willUpdate(bill, choice)) return bill
      const updated = followVersion(bill)
      if (!differs(bill, updated)) return bill
      billsChanged = true
      return updated
    })
    if (!versionsChanged && !billsChanged) return { ok: true, data }
    return {
      ok: true,
      data: replaceArea(data, {
        ...area,
        bills: billsChanged ? bills : area.bills,
        series: versionsChanged
          ? area.series.map((item) => (item === series ? { ...series, versions } : item))
          : area.series,
      }),
    }
  }

  return { ok: true, plan, apply }
}

/** Resumo de "esta e as seguintes" para a confirmação. Não altera os dados. */
export function planSeriesEdit(
  data: FinanceData,
  areaId: string,
  seriesId: string,
  month: MonthKey,
  input: SeriesEditInput,
): { ok: true; plan: SeriesEditPlan } | { ok: false; error: string } {
  const prepared = prepareSeriesEdit(data, areaId, seriesId, month, input)
  return prepared.ok ? { ok: true, plan: prepared.plan } : prepared
}

/**
 * Aplica "esta e as seguintes". Revalida tudo com os dados atuais (o resumo mostrado na
 * confirmação não é usado). `choice` é obrigatória quando há outras ocorrências
 * editadas individualmente afetadas.
 */
export function applySeriesEdit(
  data: FinanceData,
  areaId: string,
  seriesId: string,
  month: MonthKey,
  input: SeriesEditInput,
  choice: OverriddenChoice | null,
): SeriesChangeResult {
  const prepared = prepareSeriesEdit(data, areaId, seriesId, month, input)
  return prepared.ok ? prepared.apply(choice) : prepared
}

/* ---------- Encerramento de recorrência ---------- */

/** Quantos anos depois do mês atual o último mês de uma recorrência pode ficar. */
const END_MONTH_YEARS_AHEAD = 5

/** O que fazer com as contas gravadas e pendentes depois do último mês. */
export type PendingAfterEndChoice = 'keep' | 'delete'

/** Resumo do encerramento, para a confirmação. Não é usado para aplicar. */
export interface EndSeriesPlan {
  lastMonth: MonthKey
  /** Contas gravadas e pendentes depois do último mês (inclusive vencidas e do mês atual). */
  pendingAfter: { month: MonthKey; totalCents: number }[]
  /** Contas pagas depois do último mês: sempre ficam. */
  paidAfterCount: number
  /** Meses de alterações programadas depois do fim, que são descartadas. */
  discardedVersionMonths: MonthKey[]
  /** Meses excluídos depois do fim: as exclusões deixam de ser necessárias e saem. */
  discardedSkippedMonths: MonthKey[]
}

export const SERIES_ENDED_MESSAGE =
  'Esta conta recorrente já foi encerrada e não pode ser alterada.'

export const END_CHOICE_MESSAGE =
  'Escolha se as contas pendentes depois do último mês serão mantidas ou excluídas.'

/** Primeiro e último mês aceitos como último mês: do início até cinco anos depois de hoje. */
export function endMonthRange(series: BillSeries, today: Today): { from: MonthKey; to: MonthKey } {
  const limit = monthFromIndex(monthIndex(today.month) + END_MONTH_YEARS_AHEAD * 12)
  return { from: series.startMonth, to: limit > series.startMonth ? limit : series.startMonth }
}

/** Meses que podem ser escolhidos como último mês, em ordem. */
export function endMonthOptions(series: BillSeries, today: Today): MonthKey[] {
  const { from, to } = endMonthRange(series, today)
  const options: MonthKey[] = []
  for (let index = monthIndex(from); index <= monthIndex(to); index++) {
    options.push(monthFromIndex(index))
  }
  return options
}

type PreparedEndSeries =
  | { ok: false; error: string }
  | {
      ok: true
      plan: EndSeriesPlan
      apply: (choice: PendingAfterEndChoice | null) => SeriesChangeResult
    }

/**
 * Valida o encerramento com os dados atuais e calcula o que ele muda. Só recorrentes em
 * aberto (sem reabertura). Grava o último mês; descarta versões e exclusões depois dele
 * (o validador não as aceita); contas pagas depois do fim ficam; as pendentes depois do
 * fim ficam ou saem conforme a escolha, sem exclusão permanente (nada é gerado ali).
 */
function prepareEndSeries(
  data: FinanceData,
  areaId: string,
  seriesId: string,
  lastMonth: MonthKey,
  today: Today,
): PreparedEndSeries {
  const area = data.areas.find((item) => item.id === areaId)
  if (!area) return { ok: false, error: 'A área desta conta não foi encontrada.' }
  const series = area.series.find((item) => item.id === seriesId)
  if (!series) return { ok: false, error: 'A conta recorrente ou parcelada não foi encontrada.' }
  if (series.kind !== 'recurring') {
    return { ok: false, error: 'Só contas recorrentes podem ser encerradas.' }
  }
  if (series.lastMonth !== undefined) return { ok: false, error: SERIES_ENDED_MESSAGE }
  if (!isValidMonth(today.month)) return { ok: false, error: 'A data de referência é inválida.' }
  const { from, to } = endMonthRange(series, today)
  if (!isValidMonth(lastMonth) || lastMonth < from || lastMonth > to) {
    return {
      ok: false,
      error: 'Escolha um último mês entre o início da recorrência e cinco anos depois do mês atual.',
    }
  }

  const versions = series.versions.filter((version) => version.fromMonth <= lastMonth)
  const discardedVersionMonths = series.versions
    .filter((version) => version.fromMonth > lastMonth)
    .map((version) => version.fromMonth)
  const skippedMonths = series.skippedMonths.filter((month) => month <= lastMonth)
  const discardedSkippedMonths = series.skippedMonths.filter((month) => month > lastMonth)
  const after = area.bills
    .filter((bill) => bill.seriesId === series.id && bill.month > lastMonth)
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
  const pendingAfter = after.filter((bill) => !bill.paid)

  const plan: EndSeriesPlan = {
    lastMonth,
    pendingAfter: pendingAfter.map((bill) => ({ month: bill.month, totalCents: bill.totalCents })),
    paidAfterCount: after.length - pendingAfter.length,
    discardedVersionMonths,
    discardedSkippedMonths,
  }

  const apply = (choice: PendingAfterEndChoice | null): SeriesChangeResult => {
    if (pendingAfter.length > 0 && choice === null) {
      return { ok: false, error: END_CHOICE_MESSAGE }
    }
    const removed = new Set(choice === 'delete' ? pendingAfter : [])
    const ended: BillSeries = { ...series, versions, skippedMonths, lastMonth }
    return {
      ok: true,
      data: replaceArea(data, {
        ...area,
        bills: removed.size > 0 ? area.bills.filter((bill) => !removed.has(bill)) : area.bills,
        series: area.series.map((item) => (item === series ? ended : item)),
      }),
    }
  }

  return { ok: true, plan, apply }
}

/** Resumo do encerramento para a confirmação. Não altera os dados. */
export function planEndSeries(
  data: FinanceData,
  areaId: string,
  seriesId: string,
  lastMonth: MonthKey,
  today: Today,
): { ok: true; plan: EndSeriesPlan } | { ok: false; error: string } {
  const prepared = prepareEndSeries(data, areaId, seriesId, lastMonth, today)
  return prepared.ok ? { ok: true, plan: prepared.plan } : prepared
}

/**
 * Encerra a recorrência no último mês escolhido. Revalida tudo com os dados atuais (o
 * resumo mostrado não é usado). `choice` é obrigatória quando há contas pendentes
 * gravadas depois do último mês.
 */
export function applyEndSeries(
  data: FinanceData,
  areaId: string,
  seriesId: string,
  lastMonth: MonthKey,
  today: Today,
  choice: PendingAfterEndChoice | null,
): SeriesChangeResult {
  const prepared = prepareEndSeries(data, areaId, seriesId, lastMonth, today)
  return prepared.ok ? prepared.apply(choice) : prepared
}

/* ---------- Quantidade de parcelas ---------- */

/** Resumo da mudança na quantidade de parcelas, para a confirmação. Não é usado para aplicar. */
export interface InstallmentCountPlan {
  currentCount: number
  newCount: number
  /** Menor quantidade aceita: 2, ou a maior parcela já paga. */
  minCount: number
  /** Último mês da compra com a nova quantidade. */
  newLastMonth: MonthKey
  /** Parcelas novas que vão existir (as excluídas continuam excluídas). */
  addedCount: number
  /** Das novas, as de meses que já passaram (até o atual): criadas como pendentes ao confirmar. */
  pastCreatedCount: number
  /** Parcelas gravadas e pendentes acima do novo total: removidas ao confirmar. */
  removed: { month: MonthKey; installmentNumber: number; totalCents: number }[]
  /** Previstas acima do novo total, que deixam de aparecer. */
  removedProjectedCount: number
  /** Meses de alterações programadas depois do novo fim, que são descartadas. */
  discardedVersionMonths: MonthKey[]
  /** A quantidade muda. */
  hasChanges: boolean
  /**
   * Só ao aumentar: participantes desativados na divisão das parcelas novas (a da última
   * versão) ou nas parcelas pendentes já gravadas no novo trecho. Saem dessas divisões.
   */
  inactiveMemberIds: string[]
  /** Alguma dessas divisões ficaria sem participante ativo: é preciso escolher quem paga. */
  needsPayer: boolean
  /** As parcelas novas recebem uma versão com a divisão corrigida (há parcela nova gerada). */
  fixesNewInstallments: boolean
  /** Em alguma dessas divisões, a parte dos desativados vai aos ativos que já estavam nela. */
  redistributesAmongActive: boolean
  /** Participantes ativos da área, na ordem dela, que podem pagar. */
  payerCandidates: string[]
  /** Parcelas pendentes já gravadas no novo trecho, com desativado: só a divisão muda. */
  recalculated: {
    billId: string
    month: MonthKey
    installmentNumber: number
    totalCents: number
  }[]
}

export const INSTALLMENT_PAYER_MISSING_MESSAGE = 'Escolha quem paga as parcelas novas.'
export const INSTALLMENT_PAYER_INACTIVE_MESSAGE =
  'O participante escolhido para pagar as parcelas novas não está mais ativo nesta área.'
export const INSTALLMENT_NO_ACTIVE_MESSAGE =
  'Não há participante ativo nesta área para assumir as parcelas novas.'
export const INSTALLMENT_SHARES_ERROR_MESSAGE =
  'Não foi possível calcular a divisão das parcelas sem os participantes desativados. ' +
  'Nada foi alterado.'

/**
 * Tira todos os participantes desativados de uma divisão, sem mudar o total. A soma das
 * partes deles vai, em partes iguais, só aos participantes ativos que já estão na
 * divisão; os centavos que sobram vão um a um aos primeiros na ordem da área. Sem nenhum
 * ativo na divisão, o valor inteiro vai a `payer`. Sem desativados, devolve a mesma
 * divisão. Devolve null quando seria preciso um pagador e ele não foi informado.
 * (A desativação usa `redistributeShares`, que trata um participante só.)
 */
export function redistributeInactiveShares(
  shares: BillShare[],
  area: Area,
  payer: string | undefined,
): BillShare[] | null {
  const inactiveIds = new Set(area.members.filter((m) => m.inactive).map((m) => m.id))
  if (!shares.some((share) => inactiveIds.has(share.memberId))) return shares
  const removedCents = shares
    .filter((share) => inactiveIds.has(share.memberId))
    .reduce((sum, share) => sum + share.amountCents, 0)
  const others = shares
    .filter((share) => !inactiveIds.has(share.memberId))
    .map((share) => ({ ...share }))
  if (others.length === 0) {
    if (payer === undefined) return null
    return [{ memberId: payer, amountCents: removedCents }]
  }
  const order = new Map(area.members.map((member, index) => [member.id, index]))
  const receivers = [...others].sort(
    (a, b) => (order.get(a.memberId) ?? 0) - (order.get(b.memberId) ?? 0),
  )
  const base = Math.floor(removedCents / receivers.length)
  let rest = removedCents - base * receivers.length
  for (const receiver of receivers) {
    receiver.amountCents += base + (rest > 0 ? 1 : 0)
    if (rest > 0) rest--
  }
  return others
}

/** Mensagem do mínimo: explica qual parcela paga impede a redução. */
function minCountMessage(minCount: number): string {
  return minCount > 2
    ? `A quantidade mínima é ${minCount}, porque a parcela ${minCount} já está paga.`
    : 'A quantidade mínima é 2.'
}

type PreparedInstallmentCount =
  | { ok: false; error: string }
  | {
      ok: true
      plan: InstallmentCountPlan
      apply: (payer: string | undefined) => SeriesChangeResult
    }

/**
 * Valida a nova quantidade com os dados atuais e calcula o que ela muda. De 2 a 120 e
 * nunca abaixo da maior parcela paga. Aumentar acrescenta meses no fim, respeitando as
 * exclusões. Reduzir remove as gravadas pendentes acima do novo total (sem exclusão
 * permanente: se a compra aumentar de novo, esses meses voltam como parcelas novas) e
 * descarta versões depois do novo fim. Exclusões permanentes, início, numeração e
 * pagamentos nunca mudam.
 *
 * Ao aumentar, participantes desativados não entram nas parcelas novas: se a divisão da
 * última versão tiver algum, uma versão nova começa no primeiro mês acrescentado com a
 * divisão corrigida (só se alguma parcela nova for gerada); e as parcelas pendentes já
 * gravadas no novo trecho têm só a divisão recalculada, a partir da própria conta.
 */
function prepareInstallmentCount(
  data: FinanceData,
  areaId: string,
  seriesId: string,
  newCount: number,
  today: Today,
): PreparedInstallmentCount {
  const area = data.areas.find((item) => item.id === areaId)
  if (!area) return { ok: false, error: 'A área desta conta não foi encontrada.' }
  const series = area.series.find((item) => item.id === seriesId)
  if (!series) return { ok: false, error: 'A conta recorrente ou parcelada não foi encontrada.' }
  if (series.kind !== 'installment' || series.installmentCount === undefined) {
    return { ok: false, error: 'Só contas parceladas têm quantidade de parcelas.' }
  }
  if (!isValidMonth(today.month)) return { ok: false, error: 'A data de referência é inválida.' }
  const countError = validateInstallmentCount(newCount)
  if (countError) return { ok: false, error: countError }
  const minCount = minInstallmentCount(series, area.bills)
  if (newCount < minCount) return { ok: false, error: minCountMessage(minCount) }

  const currentCount = series.installmentCount
  const start = monthIndex(series.startMonth)
  const newLastMonth = monthFromIndex(start + newCount - 1)
  const versions = series.versions.filter((version) => version.fromMonth <= newLastMonth)
  const discardedVersionMonths = series.versions
    .filter((version) => version.fromMonth > newLastMonth)
    .map((version) => version.fromMonth)

  const ownBills = area.bills.filter((bill) => bill.seriesId === series.id)
  // Só quando a quantidade muda: com a mesma quantidade, nada é aplicado nem removido.
  const removedBills =
    newCount !== currentCount
      ? ownBills.filter((bill) => !bill.paid && bill.month > newLastMonth)
      : []
  const recorded = new Set(ownBills.map((bill) => bill.month))
  const skipped = new Set(series.skippedMonths)

  let addedCount = 0
  let pastCreatedCount = 0
  let removedProjectedCount = 0
  for (let position = newCount + 1; position <= currentCount; position++) {
    const month = monthFromIndex(start + position - 1)
    if (!recorded.has(month) && !skipped.has(month)) removedProjectedCount++
  }
  for (let position = currentCount + 1; position <= newCount; position++) {
    const month = monthFromIndex(start + position - 1)
    if (skipped.has(month) || recorded.has(month)) continue
    addedCount++
    if (month <= today.month) pastCreatedCount++
  }

  // Aumento com participante desativado: só nas parcelas novas e nas pendentes gravadas do
  // novo trecho (depois do fim anterior). O que vem antes não muda.
  const increasing = newCount > currentCount && area.type === 'shared'
  const inactiveIds = new Set(area.members.filter((m) => m.inactive).map((m) => m.id))
  const hasInactive = (shares: BillShare[]) => shares.some((s) => inactiveIds.has(s.memberId))
  const oldLastMonth = monthFromIndex(start + currentCount - 1)
  const lastVersion = versions[versions.length - 1]
  // D2: sem parcela nova gerada, não há versão nova.
  const fixVersion = increasing && addedCount > 0 && hasInactive(lastVersion.shares)
  const recalculatedBills = increasing
    ? ownBills.filter(
        (bill) =>
          !bill.paid &&
          bill.month > oldLastMonth &&
          bill.month <= newLastMonth &&
          hasInactive(bill.shares),
      )
    : []
  const sharesToFix = [
    ...(fixVersion ? [lastVersion.shares] : []),
    ...recalculatedBills.map((bill) => bill.shares),
  ]
  const inactiveMemberIds = area.members
    .filter(
      (m) => m.inactive && sharesToFix.some((shares) => shares.some((s) => s.memberId === m.id)),
    )
    .map((m) => m.id)
  const needsPayer = sharesToFix.some(
    (shares) => redistributeInactiveShares(shares, area, undefined) === null,
  )
  const redistributesAmongActive = sharesToFix.some(
    (shares) => redistributeInactiveShares(shares, area, undefined) !== null,
  )
  const payerCandidates = area.members.filter((m) => !m.inactive).map((m) => m.id)
  if (needsPayer && payerCandidates.length === 0) {
    return { ok: false, error: INSTALLMENT_NO_ACTIVE_MESSAGE }
  }

  const plan: InstallmentCountPlan = {
    currentCount,
    newCount,
    minCount,
    newLastMonth,
    addedCount,
    pastCreatedCount,
    removed: removedBills
      .map((bill) => ({
        month: bill.month,
        installmentNumber: bill.installmentNumber ?? installmentNumberFor(series, bill.month) ?? 0,
        totalCents: bill.totalCents,
      }))
      .sort((a, b) => a.installmentNumber - b.installmentNumber),
    removedProjectedCount,
    discardedVersionMonths,
    hasChanges: newCount !== currentCount,
    inactiveMemberIds,
    needsPayer,
    fixesNewInstallments: fixVersion,
    redistributesAmongActive,
    payerCandidates,
    recalculated: recalculatedBills
      .map((bill) => ({
        billId: bill.id,
        month: bill.month,
        installmentNumber: bill.installmentNumber ?? installmentNumberFor(series, bill.month) ?? 0,
        totalCents: bill.totalCents,
      }))
      .sort((a, b) => a.installmentNumber - b.installmentNumber),
  }

  const apply = (payer: string | undefined): SeriesChangeResult => {
    if (!plan.hasChanges) return { ok: true, data }
    if (needsPayer) {
      // Revalida com os dados atuais: o pagador precisa existir na área e estar ativo.
      if (payer === undefined) return { ok: false, error: INSTALLMENT_PAYER_MISSING_MESSAGE }
      if (!payerCandidates.includes(payer)) {
        return { ok: false, error: INSTALLMENT_PAYER_INACTIVE_MESSAGE }
      }
    }
    const usedPayer = needsPayer ? payer : undefined
    const removed = new Set(removedBills)

    // Divisões corrigidas. Se alguma não puder ser calculada, nada é aplicado (em vez de
    // manter o desativado em silêncio).
    let fixedVersionShares: BillShare[] | null = null
    if (fixVersion) {
      fixedVersionShares = redistributeInactiveShares(lastVersion.shares, area, usedPayer)
      if (fixedVersionShares === null) {
        return { ok: false, error: INSTALLMENT_SHARES_ERROR_MESSAGE }
      }
    }
    const fixedBillShares = new Map<Bill, BillShare[]>()
    for (const bill of recalculatedBills) {
      const shares = redistributeInactiveShares(bill.shares, area, usedPayer)
      if (shares === null) return { ok: false, error: INSTALLMENT_SHARES_ERROR_MESSAGE }
      fixedBillShares.set(bill, shares)
    }

    const newVersions = fixedVersionShares
      ? [
          ...versions,
          {
            ...lastVersion,
            // Primeiro mês acrescentado: depois de todas as versões e até o novo fim. Pode
            // ser um mês excluído; ele continua sem parcela e os seguintes usam esta versão.
            fromMonth: monthFromIndex(start + currentCount),
            shares: fixedVersionShares,
          },
        ]
      : versions
    const changed: BillSeries = { ...series, installmentCount: newCount, versions: newVersions }
    const bills = area.bills
      .filter((bill) => !removed.has(bill))
      // D3: a própria conta é a base; só a divisão muda (nome, valor, vencimento, número,
      // mês, id, pagamento e a marca de edição individual continuam como estão).
      .map((bill) => {
        const shares = fixedBillShares.get(bill)
        return shares ? { ...bill, shares } : bill
      })
    return {
      ok: true,
      data: replaceArea(data, {
        ...area,
        bills: removed.size > 0 || fixedBillShares.size > 0 ? bills : area.bills,
        series: area.series.map((item) => (item === series ? changed : item)),
      }),
    }
  }

  return { ok: true, plan, apply }
}

/** Resumo da nova quantidade de parcelas para a confirmação. Não altera os dados. */
export function planInstallmentCount(
  data: FinanceData,
  areaId: string,
  seriesId: string,
  newCount: number,
  today: Today,
): { ok: true; plan: InstallmentCountPlan } | { ok: false; error: string } {
  const prepared = prepareInstallmentCount(data, areaId, seriesId, newCount, today)
  return prepared.ok ? { ok: true, plan: prepared.plan } : prepared
}

/**
 * Muda a quantidade de parcelas, revalidando tudo com os dados atuais (o resumo mostrado
 * não é usado). As parcelas novas de meses que já passaram não são criadas aqui: a
 * gravação automática faz isso logo depois, tudo ou nada.
 */
export function applyInstallmentCount(
  data: FinanceData,
  areaId: string,
  seriesId: string,
  newCount: number,
  today: Today,
  payer?: string,
): SeriesChangeResult {
  const prepared = prepareInstallmentCount(data, areaId, seriesId, newCount, today)
  return prepared.ok ? prepared.apply(payer) : prepared
}

/* ---------- Desativação de participantes ---------- */

/** Quem assume cada série em que o desativado ficaria como único pagador: { série: participante }. */
export type PayerChoices = Record<string, string>

/** Conta listada no resumo da desativação. */
export interface DeactivationBill {
  billId: string
  name: string
  month: MonthKey
  totalCents: number
}

/** Resumo da desativação, para a confirmação. Não é usado para aplicar. */
export interface DeactivationPlan {
  /** Mês a partir do qual o participante sai das divisões (o mês seguinte ao atual). */
  effectiveMonth: MonthKey
  /** Séries cujas divisões futuras mudam; `needsPayer`: precisa escolher quem assume. */
  affectedSeries: { seriesId: string; name: string; needsPayer: boolean }[]
  /** Participantes ativos que podem assumir, na ordem da área. */
  payerCandidates: string[]
  /** Contas de séries, pendentes, a partir do mês de efeito: recalculadas ao confirmar. */
  recalculated: DeactivationBill[]
  /** Contas comuns, pendentes, a partir do mês de efeito: só listadas, não mudam. */
  commonBillsKept: DeactivationBill[]
}

/**
 * Tira o participante de uma divisão, sem mudar o total. A parte dele vai, em partes
 * iguais, só aos participantes ativos que já estão na divisão; os centavos que sobram vão
 * um a um aos primeiros na ordem da área. Sem nenhum ativo na divisão, o valor inteiro
 * vai a `payer`. Devolve null quando seria preciso um pagador e ele não foi informado.
 */
function redistributeShares(
  shares: BillShare[],
  memberId: string,
  area: Area,
  payer: string | undefined,
): BillShare[] | null {
  const removed = shares.find((share) => share.memberId === memberId)
  if (!removed) return shares
  const order = new Map(area.members.map((member, index) => [member.id, index]))
  const activeIds = new Set(area.members.filter((m) => !m.inactive).map((m) => m.id))
  const others = shares
    .filter((share) => share.memberId !== memberId)
    .map((share) => ({ ...share }))
  const receivers = others
    .filter((share) => activeIds.has(share.memberId))
    .sort((a, b) => (order.get(a.memberId) ?? 0) - (order.get(b.memberId) ?? 0))
  if (receivers.length === 0) {
    if (payer === undefined) return null
    return [...others, { memberId: payer, amountCents: removed.amountCents }]
  }
  const base = Math.floor(removed.amountCents / receivers.length)
  let rest = removed.amountCents - base * receivers.length
  for (const receiver of receivers) {
    receiver.amountCents += base + (rest > 0 ? 1 : 0)
    if (rest > 0) rest--
  }
  return others
}

/** A divisão tem o participante e nenhum outro ativo: precisa de alguém para assumir. */
function needsPayerFor(shares: BillShare[], memberId: string, area: Area): boolean {
  return redistributeShares(shares, memberId, area, undefined) === null
}

type PreparedDeactivation =
  | { ok: false; error: string }
  | { ok: true; plan: DeactivationPlan; apply: (payers: PayerChoices) => SeriesChangeResult }

/**
 * Valida a desativação com os dados atuais e calcula o que ela muda. A partir do mês
 * seguinte ao atual, o participante sai das versões das séries que ainda geram contas
 * (versão nova no mês de efeito, ou alteração no lugar das que começam nele ou depois,
 * nunca antes do início da série) e das contas de séries pendentes desse mês em diante.
 * Contas pagas, contas comuns, o mês atual e as divisões anteriores não mudam.
 */
function prepareDeactivation(
  data: FinanceData,
  areaId: string,
  memberId: string,
  today: Today,
  protectedMemberId: string | null,
): PreparedDeactivation {
  const area = data.areas.find((item) => item.id === areaId)
  if (!area) return { ok: false, error: 'A área deste participante não foi encontrada.' }
  const member = area.members.find((item) => item.id === memberId)
  if (!member) return { ok: false, error: 'Este participante não foi encontrado.' }
  if (!isValidMonth(today.month)) return { ok: false, error: 'A data de referência é inválida.' }
  const removal = getMemberRemoval(
    member,
    area.members,
    area.bills,
    area.series,
    protectedMemberId,
    area.id === HOME_AREA_ID,
  )
  if (removal.mode === 'blocked') return { ok: false, error: removal.reasons.join(' ') }
  if (removal.mode === 'delete') {
    return { ok: false, error: 'Este participante não tem histórico: ele pode ser excluído.' }
  }

  const effectiveMonth = monthFromIndex(monthIndex(today.month) + 1)
  const hasMember = (shares: BillShare[]) => shares.some((share) => share.memberId === memberId)
  const payerCandidates = area.members
    .filter((item) => item.id !== memberId && !item.inactive)
    .map((item) => item.id)

  // Versões a mudar em cada série que ainda gera contas no mês de efeito ou depois.
  const versionTargets = new Map<BillSeries, SeriesVersion[]>()
  for (const series of area.series) {
    const end = seriesEndMonth(series)
    if (end !== null && end < effectiveMonth) continue
    const inEffect = versionForMonth(series, effectiveMonth)
    const targets = series.versions.filter(
      (version) => version.fromMonth >= effectiveMonth && hasMember(version.shares),
    )
    if (inEffect && inEffect.fromMonth < effectiveMonth && hasMember(inEffect.shares)) {
      targets.unshift(inEffect)
    }
    if (targets.length > 0) versionTargets.set(series, targets)
  }

  // Contas pendentes do mês de efeito em diante com o participante.
  const futurePending = area.bills.filter(
    (bill) => !bill.paid && bill.month >= effectiveMonth && hasMember(bill.shares),
  )
  const seriesBills = futurePending.filter((bill) => bill.seriesId !== undefined)
  const commonBills = futurePending.filter((bill) => bill.seriesId === undefined)

  const affected = area.series.filter(
    (series) =>
      versionTargets.has(series) || seriesBills.some((bill) => bill.seriesId === series.id),
  )
  const affectedSeries = affected.map((series) => ({
    seriesId: series.id,
    name: series.versions[series.versions.length - 1].name,
    needsPayer:
      (versionTargets.get(series) ?? []).some((version) =>
        needsPayerFor(version.shares, memberId, area),
      ) ||
      seriesBills.some(
        (bill) => bill.seriesId === series.id && needsPayerFor(bill.shares, memberId, area),
      ),
  }))
  const noCandidate = affectedSeries.find((item) => item.needsPayer && payerCandidates.length === 0)
  if (noCandidate) {
    return {
      ok: false,
      error: `Não é possível desativar: não há outro participante ativo para assumir “${noCandidate.name}”.`,
    }
  }

  const toListItem = (bill: Bill): DeactivationBill => ({
    billId: bill.id,
    name: bill.name,
    month: bill.month,
    totalCents: bill.totalCents,
  })
  const byMonth = (a: DeactivationBill, b: DeactivationBill) =>
    a.month < b.month ? -1 : a.month > b.month ? 1 : 0
  const plan: DeactivationPlan = {
    effectiveMonth,
    affectedSeries,
    payerCandidates,
    recalculated: seriesBills.map(toListItem).sort(byMonth),
    commonBillsKept: commonBills.map(toListItem).sort(byMonth),
  }

  const apply = (payers: PayerChoices): SeriesChangeResult => {
    // Confere os pagadores escolhidos com os dados atuais.
    for (const item of affectedSeries) {
      if (!item.needsPayer) continue
      const payer = payers[item.seriesId]
      if (payer === undefined) {
        return { ok: false, error: `Escolha quem assume a conta “${item.name}”.` }
      }
      if (!payerCandidates.includes(payer)) {
        return {
          ok: false,
          error: `O participante escolhido para assumir “${item.name}” não está mais ativo nesta área.`,
        }
      }
    }
    const payerFor = (seriesId: string) =>
      affectedSeries.find((item) => item.seriesId === seriesId)?.needsPayer
        ? payers[seriesId]
        : undefined

    const series = area.series.map((item) => {
      const targets = versionTargets.get(item)
      if (!targets) return item
      const payer = payerFor(item.id)
      const changed = (version: SeriesVersion): SeriesVersion => ({
        ...version,
        shares: redistributeShares(version.shares, memberId, area, payer) ?? version.shares,
      })
      const versions: SeriesVersion[] = []
      for (const version of item.versions) {
        if (version.fromMonth < effectiveMonth) {
          versions.push(version)
          // A versão vigente começou antes: a nova divisão entra no mês de efeito.
          if (targets.includes(version) && version === versionForMonth(item, effectiveMonth)) {
            versions.push({ ...changed(version), fromMonth: effectiveMonth })
          }
        } else {
          versions.push(targets.includes(version) ? changed(version) : version)
        }
      }
      return { ...item, versions }
    })

    const recalculatedSet = new Set(seriesBills)
    const bills = area.bills.map((bill) => {
      if (!recalculatedSet.has(bill)) return bill
      const shares = redistributeShares(bill.shares, memberId, area, payerFor(bill.seriesId ?? ''))
      return shares ? { ...bill, shares } : bill
    })

    const members = area.members.map((item) =>
      item.id === memberId ? { ...item, inactive: true } : item,
    )
    return { ok: true, data: replaceArea(data, { ...area, members, series, bills }) }
  }

  return { ok: true, plan, apply }
}

/** Resumo da desativação para a confirmação. Não altera os dados. */
export function planMemberDeactivation(
  data: FinanceData,
  areaId: string,
  memberId: string,
  today: Today,
  protectedMemberId: string | null,
): { ok: true; plan: DeactivationPlan } | { ok: false; error: string } {
  const prepared = prepareDeactivation(data, areaId, memberId, today, protectedMemberId)
  return prepared.ok ? { ok: true, plan: prepared.plan } : prepared
}

/**
 * Desativa o participante. Revalida tudo com os dados atuais, inclusive os pagadores
 * escolhidos (o resumo mostrado não é usado). Uma única alteração: o participante,
 * as versões e as contas recalculadas mudam juntos.
 */
export function applyMemberDeactivation(
  data: FinanceData,
  areaId: string,
  memberId: string,
  today: Today,
  protectedMemberId: string | null,
  payers: PayerChoices,
): SeriesChangeResult {
  const prepared = prepareDeactivation(data, areaId, memberId, today, protectedMemberId)
  return prepared.ok ? prepared.apply(payers) : prepared
}

/* ---------- Regras de edição usadas nas próximas etapas ---------- */

/**
 * Nome, valor, vencimento e divisão da série no mês (da versão em vigor nele), exatamente
 * como estão, inclusive com participantes desativados. null fora do período da série.
 */
export function seriesDataAt(series: BillSeries, month: MonthKey): SeriesEditInput | null {
  if (!isWithinSeries(series, month)) return null
  const version = versionForMonth(series, month)
  if (!version) return null
  return {
    name: version.name,
    totalCents: version.totalCents,
    dueDay: version.dueDay,
    shares: version.shares.map((share) => ({ ...share })),
  }
}

/**
 * Mês a partir do qual "esta e as seguintes" passa a valer: o da ocorrência selecionada,
 * ou o seguinte se ela já estiver paga. null quando não há ocorrências seguintes
 * (a ocorrência está no último mês da série ou depois do fim).
 */
export function seriesEditStartMonth(
  series: BillSeries,
  occurrence: { month: MonthKey; paid: boolean },
): MonthKey | null {
  const start = occurrence.paid
    ? monthFromIndex(monthIndex(occurrence.month) + 1)
    : occurrence.month
  return isWithinSeries(series, start) ? start : null
}

/**
 * Menor quantidade de parcelas aceita: 2, ou a maior numeração de parcela já paga,
 * para nenhuma parcela paga ficar fora do total.
 */
export function minInstallmentCount(series: BillSeries, bills: Bill[]): number {
  let highestPaid = 0
  for (const bill of bills) {
    if (bill.seriesId !== series.id || !bill.paid) continue
    highestPaid = Math.max(highestPaid, bill.installmentNumber ?? 0)
  }
  return Math.max(2, highestPaid)
}
