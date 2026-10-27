import type {
  Area,
  Bill,
  BillSeries,
  BillShare,
  FinanceData,
  LegacyFinanceDataV1,
  Member,
  SeriesVersion,
} from './types'
import {
  HOME_AREA_ID,
  MAX_AREA_NAME_LENGTH,
  MAX_AREAS,
  MY_ACCOUNTS_AREA_ID,
  MY_ACCOUNTS_AREA_NAME,
  cleanAreaName,
  ensureMyAccountsArea,
  migrateV1ToV3,
} from './areas'
import { MAX_AMOUNT_CENTS } from './money'

/** Identifica o arquivo como backup deste aplicativo. */
export const BACKUP_FORMAT = 'contas-da-familia-backup'
/**
 * Aumente este número quando o formato do arquivo mudar.
 * 1: { members, bills } (uma área implícita). 2: { areas }. 3: { areas } com séries.
 * A importação aceita somente a versão 3. Dados salvos no navegador nas versões 1 e 2
 * continuam sendo lidos e convertidos na memória (ver parseStoredData).
 */
export const BACKUP_FORMAT_VERSION = 3

/** Quantidade máxima de parcelas de uma conta parcelada. */
export const MAX_INSTALLMENTS = 120

/** Limites para recusar arquivos absurdos antes de processá-los. */
export const MAX_BACKUP_FILE_BYTES = 5 * 1024 * 1024
export const MAX_MEMBERS = 20
export const MAX_BILLS = 20000
const MAX_SHARES_PER_BILL = MAX_MEMBERS
const MAX_ID_LENGTH = 100
/** Mesmos limites usados nos formulários do aplicativo. */
export const MAX_MEMBER_NAME_LENGTH = 20
export const MAX_BILL_NAME_LENGTH = 40
const MAX_EMOJI_LENGTH = 16

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  formatVersion: typeof BACKUP_FORMAT_VERSION
  createdAt: string
  data: {
    areas: Area[]
  }
}

export interface BackupSummary {
  createdAt: Date
  areaCount: number
  memberCount: number
  billCount: number
  monthCount: number
}

export type BackupParseResult =
  | { ok: true; data: FinanceData; summary: BackupSummary }
  | { ok: false; error: string }

/** Monta o conteúdo do backup apenas com os dados necessários para restaurar o app. */
export function createBackup(data: FinanceData, now: Date): BackupFile {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: now.toISOString(),
    data: {
      areas: data.areas.map(sanitizeArea),
    },
  }
}

/**
 * "gestao-de-gastos-backup-2026-10-20-1430.json". Só o nome do arquivo:
 * o conteúdo continua identificado por BACKUP_FORMAT.
 */
export function createBackupFileName(
  now: Date,
  prefix = 'gestao-de-gastos-backup',
  extension = 'json',
): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`
  return `${prefix}-${date}-${time}.${extension}`
}

/* ---------- Validação ---------- */

class BackupValidationError extends Error {}

function fail(message: string): never {
  throw new BackupValidationError(message)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH
  )
}

function isValidCents(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_AMOUNT_CENTS
  )
}

function sanitizeMember(member: Member): Member {
  const clean: Member = {
    id: member.id,
    name: member.name,
    emoji: member.emoji,
    color: member.color,
  }
  if (member.inactive) clean.inactive = true
  return clean
}

function sanitizeShares(shares: BillShare[]): BillShare[] {
  return shares.map((share) => ({ memberId: share.memberId, amountCents: share.amountCents }))
}

function sanitizeBill(bill: Bill): Bill {
  const clean: Bill = {
    id: bill.id,
    name: bill.name,
    month: bill.month,
    totalCents: bill.totalCents,
    dueDay: bill.dueDay,
    shares: sanitizeShares(bill.shares),
    paid: bill.paid,
  }
  if (bill.isExample) clean.isExample = true
  if (bill.seriesId !== undefined) clean.seriesId = bill.seriesId
  if (bill.installmentNumber !== undefined) clean.installmentNumber = bill.installmentNumber
  if (bill.overridden) clean.overridden = true
  return clean
}

function sanitizeSeries(series: BillSeries): BillSeries {
  const clean: BillSeries = {
    id: series.id,
    kind: series.kind,
    startMonth: series.startMonth,
    versions: series.versions.map((version) => ({
      fromMonth: version.fromMonth,
      name: version.name,
      totalCents: version.totalCents,
      dueDay: version.dueDay,
      shares: sanitizeShares(version.shares),
    })),
    skippedMonths: [...series.skippedMonths],
  }
  if (series.installmentCount !== undefined) clean.installmentCount = series.installmentCount
  if (series.lastMonth !== undefined) clean.lastMonth = series.lastMonth
  return clean
}

function sanitizeArea(area: Area): Area {
  return {
    id: area.id,
    name: area.name,
    type: area.type,
    members: area.members.map(sanitizeMember),
    bills: area.bills.map(sanitizeBill),
    series: area.series.map(sanitizeSeries),
  }
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

function isValidMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH_PATTERN.test(value)
}

/** Número sequencial do mês, para comparar meses e medir a distância entre eles. */
function monthIndex(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number)
  return year * 12 + monthNumber - 1
}

/**
 * `legacy`: dados das versões 1 e 2, que não podem ter campos criados na versão 3
 * (séries, participantes desativados e marcações das ocorrências).
 */
function validateMember(
  value: unknown,
  position: number,
  seenIds: Set<string>,
  legacy: boolean,
): Member {
  const label = `O integrante nº ${position}`
  if (!isPlainObject(value)) fail(`${label} não está no formato esperado.`)

  const { id, name, emoji, color, inactive } = value
  if (!isValidId(id)) fail(`${label} está sem um identificador válido.`)
  if (seenIds.has(id)) fail(`Há dois integrantes com o mesmo identificador (“${id}”).`)
  seenIds.add(id)

  if (typeof name !== 'string' || !name.trim()) fail(`${label} está sem nome.`)
  if (name.trim().length > MAX_MEMBER_NAME_LENGTH) {
    fail(`O nome “${name.trim()}” é maior que ${MAX_MEMBER_NAME_LENGTH} letras.`)
  }
  if (typeof emoji !== 'string' || emoji.length > MAX_EMOJI_LENGTH) {
    fail(`${label} (“${name.trim()}”) tem um ícone inválido.`)
  }
  if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) {
    fail(`${label} (“${name.trim()}”) tem uma cor inválida.`)
  }
  if (inactive !== undefined) {
    if (legacy) {
      fail(`${label} (“${name.trim()}”) tem uma marcação de desativado, que não existe nesta versão dos dados.`)
    }
    if (typeof inactive !== 'boolean') {
      fail(`${label} (“${name.trim()}”) tem uma marcação de desativado inválida.`)
    }
  }

  const member: Member = { id, name: name.trim(), emoji, color }
  if (inactive) member.inactive = true
  return member
}

/** Divisão de uma conta (ou dos dados de uma série) entre os participantes da área. */
function validateShares(
  shares: unknown,
  totalCents: number,
  memberIds: Set<string>,
  label: string,
  /** Áreas individuais não têm divisão: `shares` deve ser vazio. */
  individual: boolean,
): BillShare[] {
  if (individual) {
    if (!Array.isArray(shares) || shares.length > 0) {
      fail(`${label} é de uma área individual e não pode ter divisão entre pessoas.`)
    }
    return []
  }

  if (!Array.isArray(shares) || shares.length === 0) {
    fail(`${label} não tem nenhuma pessoa responsável.`)
  }
  if (shares.length > MAX_SHARES_PER_BILL) fail(`${label} tem pessoas demais.`)

  const shareMemberIds = new Set<string>()
  const cleanShares: BillShare[] = []
  let sum = 0
  for (const share of shares) {
    if (!isPlainObject(share)) fail(`${label} tem uma divisão em formato inválido.`)
    const { memberId, amountCents } = share
    if (typeof memberId !== 'string' || !memberIds.has(memberId)) {
      fail(`${label} está ligada a uma pessoa que não existe entre os membros da área.`)
    }
    if (shareMemberIds.has(memberId)) fail(`${label} repete a mesma pessoa na divisão.`)
    shareMemberIds.add(memberId)
    if (!isValidCents(amountCents)) {
      fail(`${label} tem uma parte com valor inválido. Cada parte precisa ser maior que zero.`)
    }
    sum += amountCents
    cleanShares.push({ memberId, amountCents })
  }
  if (sum !== totalCents) {
    fail(`${label} tem partes que não somam exatamente o valor total.`)
  }
  return cleanShares
}

function validateBill(
  value: unknown,
  position: number,
  memberIds: Set<string>,
  seenIds: Set<string>,
  individual: boolean,
  legacy: boolean,
): Bill {
  if (!isPlainObject(value)) fail(`A conta nº ${position} não está no formato esperado.`)

  const {
    id,
    name,
    month,
    totalCents,
    dueDay,
    shares,
    paid,
    isExample,
    seriesId,
    installmentNumber,
    overridden,
  } = value
  const label =
    typeof name === 'string' && name.trim()
      ? `A conta “${name.trim()}” (nº ${position})`
      : `A conta nº ${position}`

  if (!isValidId(id)) fail(`${label} está sem um identificador válido.`)
  if (seenIds.has(id)) fail(`Há duas contas com o mesmo identificador (“${id}”).`)
  seenIds.add(id)

  if (typeof name !== 'string' || !name.trim()) fail(`${label} está sem nome.`)
  if (name.trim().length > MAX_BILL_NAME_LENGTH) {
    fail(`${label} tem um nome maior que ${MAX_BILL_NAME_LENGTH} letras.`)
  }
  if (!isValidMonth(month)) {
    fail(`${label} está com o mês em formato inválido.`)
  }
  if (!isValidCents(totalCents)) {
    fail(`${label} tem um valor total inválido. Ele precisa ser maior que zero.`)
  }
  if (typeof dueDay !== 'number' || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    fail(`${label} tem um dia de vencimento inválido (precisa ser de 1 a 31).`)
  }
  if (typeof paid !== 'boolean') fail(`${label} está sem a situação de pagamento.`)
  if (isExample !== undefined && typeof isExample !== 'boolean') {
    fail(`${label} tem uma marcação de exemplo inválida.`)
  }

  const hasSeriesFields =
    seriesId !== undefined || installmentNumber !== undefined || overridden !== undefined
  if (legacy && hasSeriesFields) {
    fail(`${label} tem dados de conta recorrente ou parcelada, que não existem nesta versão dos dados.`)
  }
  if (seriesId !== undefined && !isValidId(seriesId)) {
    fail(`${label} está ligada a uma conta recorrente ou parcelada com identificador inválido.`)
  }
  if (
    installmentNumber !== undefined &&
    (typeof installmentNumber !== 'number' ||
      !Number.isInteger(installmentNumber) ||
      installmentNumber < 1 ||
      installmentNumber > MAX_INSTALLMENTS)
  ) {
    fail(`${label} tem um número de parcela inválido.`)
  }
  if (overridden !== undefined && typeof overridden !== 'boolean') {
    fail(`${label} tem uma marcação de edição individual inválida.`)
  }
  if (seriesId === undefined && (installmentNumber !== undefined || overridden === true)) {
    fail(`${label} tem dados de conta recorrente ou parcelada, mas não está ligada a nenhuma.`)
  }

  const bill: Bill = {
    id,
    name: name.trim(),
    month,
    totalCents,
    dueDay,
    shares: validateShares(shares, totalCents, memberIds, label, individual),
    paid,
  }
  if (isExample) bill.isExample = true
  if (seriesId !== undefined) bill.seriesId = seriesId
  if (installmentNumber !== undefined) bill.installmentNumber = installmentNumber
  if (overridden) bill.overridden = true
  return bill
}

/** Dados de uma série (nome, valor, vencimento e divisão) a partir de um mês. */
function validateSeriesVersion(
  value: unknown,
  position: number,
  seriesLabel: string,
  memberIds: Set<string>,
  individual: boolean,
): SeriesVersion {
  const label = `${seriesLabel} (dados nº ${position})`
  if (!isPlainObject(value)) fail(`${label} não está no formato esperado.`)

  const { fromMonth, name, totalCents, dueDay, shares } = value
  if (!isValidMonth(fromMonth)) fail(`${label} está com o mês de início em formato inválido.`)
  if (typeof name !== 'string' || !name.trim()) fail(`${label} está sem nome.`)
  if (name.trim().length > MAX_BILL_NAME_LENGTH) {
    fail(`${label} tem um nome maior que ${MAX_BILL_NAME_LENGTH} letras.`)
  }
  if (!isValidCents(totalCents)) {
    fail(`${label} tem um valor inválido. Ele precisa ser maior que zero.`)
  }
  if (typeof dueDay !== 'number' || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    fail(`${label} tem um dia de vencimento inválido (precisa ser de 1 a 31).`)
  }

  return {
    fromMonth,
    name: name.trim(),
    totalCents,
    dueDay,
    shares: validateShares(shares, totalCents, memberIds, label, individual),
  }
}

/** Conta recorrente ou parcelada de uma área (dados da versão 3). */
function validateSeries(
  value: unknown,
  position: number,
  memberIds: Set<string>,
  inactiveMemberIds: Set<string>,
  individual: boolean,
  seenIds: Set<string>,
): BillSeries {
  if (!isPlainObject(value)) {
    fail(`A conta recorrente ou parcelada nº ${position} não está no formato esperado.`)
  }

  const { id, kind, startMonth, installmentCount, lastMonth, versions, skippedMonths } = value
  const firstVersion = Array.isArray(versions) ? versions[0] : undefined
  const firstName =
    isPlainObject(firstVersion) && typeof firstVersion.name === 'string'
      ? firstVersion.name.trim()
      : ''
  const label = firstName
    ? `A conta recorrente ou parcelada “${firstName}” (nº ${position})`
    : `A conta recorrente ou parcelada nº ${position}`

  if (!isValidId(id)) fail(`${label} está sem um identificador válido.`)
  if (seenIds.has(id)) {
    fail(`Há duas contas recorrentes ou parceladas com o mesmo identificador (“${id}”).`)
  }
  seenIds.add(id)

  if (kind !== 'recurring' && kind !== 'installment') fail(`${label} tem um tipo inválido.`)
  if (!isValidMonth(startMonth)) fail(`${label} está com o mês de início em formato inválido.`)
  const start = monthIndex(startMonth)

  // Último mês que ainda gera conta: fim da parcelada ou encerramento da recorrente.
  let end: number | null = null
  let count: number | undefined
  if (kind === 'installment') {
    if (
      typeof installmentCount !== 'number' ||
      !Number.isInteger(installmentCount) ||
      installmentCount < 2 ||
      installmentCount > MAX_INSTALLMENTS
    ) {
      fail(`${label} precisa ter de 2 a ${MAX_INSTALLMENTS} parcelas.`)
    }
    if (lastMonth !== undefined) fail(`${label} é parcelada e não pode ter mês de encerramento.`)
    count = installmentCount
    end = start + installmentCount - 1
  } else {
    if (installmentCount !== undefined) {
      fail(`${label} é recorrente e não pode ter quantidade de parcelas.`)
    }
    if (lastMonth !== undefined) {
      if (!isValidMonth(lastMonth)) {
        fail(`${label} está com o mês de encerramento em formato inválido.`)
      }
      if (monthIndex(lastMonth) < start) fail(`${label} termina antes de começar.`)
      end = monthIndex(lastMonth)
    }
  }

  if (!Array.isArray(versions) || versions.length === 0) {
    fail(`${label} está sem os dados das contas.`)
  }
  const cleanVersions = versions.map((version, index) =>
    validateSeriesVersion(version, index + 1, label, memberIds, individual),
  )
  cleanVersions.forEach((version, index) => {
    const from = monthIndex(version.fromMonth)
    if (index === 0 && version.fromMonth !== startMonth) {
      fail(`${label} precisa ter os primeiros dados valendo a partir do mês de início.`)
    }
    if (index > 0 && from <= monthIndex(cleanVersions[index - 1].fromMonth)) {
      fail(`${label} tem alterações fora de ordem ou repetidas no mesmo mês.`)
    }
    // Nada programado depois do fim: essas alterações nunca teriam efeito.
    if (end !== null && from > end) {
      fail(`${label} tem uma alteração programada para depois do seu último mês.`)
    }
  })

  if (!Array.isArray(skippedMonths)) fail(`${label} está sem a lista de meses excluídos.`)
  const seenSkipped = new Set<string>()
  for (const month of skippedMonths) {
    if (!isValidMonth(month)) fail(`${label} tem um mês excluído em formato inválido.`)
    if (seenSkipped.has(month)) fail(`${label} repete um mês excluído.`)
    seenSkipped.add(month)
    const index = monthIndex(month)
    if (index < start) fail(`${label} tem um mês excluído anterior ao seu início.`)
    // Parceladas guardam exclusões até a última parcela possível, para elas não voltarem
    // se a quantidade aumentar de novo. Recorrentes em aberto não têm limite.
    if (kind === 'installment' && index - start >= MAX_INSTALLMENTS) {
      fail(`${label} tem um mês excluído além da ${MAX_INSTALLMENTS}ª parcela.`)
    }
    if (kind === 'recurring' && end !== null && index > end) {
      fail(`${label} tem um mês excluído depois do encerramento.`)
    }
  }

  // Recorrente em aberto sempre gera contas futuras: a divisão vigente não pode ter
  // participante desativado. Nas demais séries isso depende da data atual.
  if (kind === 'recurring' && lastMonth === undefined) {
    const current = cleanVersions[cleanVersions.length - 1]
    if (current.shares.some((share) => inactiveMemberIds.has(share.memberId))) {
      fail(`${label} ainda divide as próximas contas com um participante desativado.`)
    }
  }

  const series: BillSeries = {
    id,
    kind,
    startMonth,
    versions: cleanVersions,
    skippedMonths: [...seenSkipped],
  }
  if (count !== undefined) series.installmentCount = count
  if (lastMonth !== undefined) series.lastMonth = lastMonth
  return series
}

/** Ocorrências gravadas: ligadas a uma série da área, uma por mês e fora dos meses excluídos. */
function validateOccurrences(bills: Bill[], seriesList: BillSeries[]) {
  const seriesById = new Map(seriesList.map((series) => [series.id, series]))
  const seen = new Set<string>()
  bills.forEach((bill, index) => {
    if (bill.seriesId === undefined) return
    const label = `A conta “${bill.name}” (nº ${index + 1})`
    const series = seriesById.get(bill.seriesId)
    if (!series) {
      fail(`${label} está ligada a uma conta recorrente ou parcelada que não existe nesta área.`)
    }
    const position = monthIndex(bill.month) - monthIndex(series.startMonth) + 1
    if (position < 1) fail(`${label} é de um mês anterior ao início da sua série.`)
    if (series.skippedMonths.includes(bill.month)) {
      fail(`${label} está num mês que foi excluído da sua série.`)
    }
    const key = `${bill.seriesId}|${bill.month}`
    if (seen.has(key)) fail(`${label} repete uma ocorrência que já existe no mesmo mês.`)
    seen.add(key)
    if (series.kind === 'installment') {
      if (bill.installmentNumber !== position) {
        fail(`${label} tem o número da parcela diferente da posição do mês na compra.`)
      }
    } else if (bill.installmentNumber !== undefined) {
      fail(`${label} tem número de parcela, mas pertence a uma conta recorrente.`)
    }
  })
}

function validateMembers(
  members: unknown[],
  legacy: boolean,
): { members: Member[]; memberIds: Set<string>; inactiveMemberIds: Set<string> } {
  if (members.length > MAX_MEMBERS) fail('Há integrantes demais.')
  const memberIds = new Set<string>()
  const cleanMembers = members.map((member, index) =>
    validateMember(member, index + 1, memberIds, legacy),
  )
  const inactiveMemberIds = new Set(
    cleanMembers.filter((member) => member.inactive).map((member) => member.id),
  )
  return { members: cleanMembers, memberIds, inactiveMemberIds }
}

function validateBackup(raw: unknown): { data: FinanceData; summary: BackupSummary } {
  if (!isPlainObject(raw) || raw.format !== BACKUP_FORMAT) {
    fail('Este arquivo não é um backup do Gestão de Gastos.')
  }

  const { formatVersion, createdAt, data } = raw
  if (typeof formatVersion !== 'number' || !Number.isInteger(formatVersion)) {
    fail('Não foi possível identificar a versão deste backup.')
  }
  if (formatVersion > BACKUP_FORMAT_VERSION) {
    fail('Este backup foi feito por uma versão mais nova do aplicativo e não pode ser lido aqui.')
  }
  if (formatVersion === 1 || formatVersion === 2) {
    fail('Este backup é de uma versão anterior e não pode ser importado.')
  }
  if (formatVersion !== BACKUP_FORMAT_VERSION) {
    fail('Esta versão de backup não é reconhecida.')
  }

  const createdAtDate = typeof createdAt === 'string' ? new Date(createdAt) : null
  if (!createdAtDate || Number.isNaN(createdAtDate.getTime())) {
    fail('O backup está sem uma data de criação válida.')
  }

  if (!isPlainObject(data)) fail('O backup está sem os dados do aplicativo.')
  const cleanData = validateAreas(data.areas, false)

  const allBills = cleanData.areas.flatMap((area) => area.bills)
  return {
    data: cleanData,
    summary: {
      createdAt: createdAtDate,
      areaCount: cleanData.areas.length,
      memberCount: cleanData.areas.reduce((sum, area) => sum + area.members.length, 0),
      billCount: allBills.length,
      monthCount: new Set(allBills.map((bill) => bill.month)).size,
    },
  }
}

/** Dados da versão 1 ({ members, bills }), como eram validados antes das áreas. */
function validateLegacyContent(members: unknown, bills: unknown): LegacyFinanceDataV1 {
  if (!Array.isArray(members) || members.length === 0) {
    fail('Nenhum integrante foi encontrado.')
  }
  if (!Array.isArray(bills)) fail('A lista de contas não foi encontrada.')
  if (bills.length > MAX_BILLS) fail('Há contas demais.')
  const { members: cleanMembers, memberIds } = validateMembers(members, true)
  const billIds = new Set<string>()
  const cleanBills = bills.map((bill, index) =>
    validateBill(bill, index + 1, memberIds, billIds, false, true),
  )
  return { version: 1, members: cleanMembers, bills: cleanBills }
}

/**
 * Valida uma área e devolve a versão limpa. Exportada para o futuro servidor, que guarda
 * cada área separadamente. Em dados inválidos, lança um erro com a mensagem do problema;
 * os conjuntos acumulam os ids já vistos, para detectar repetições entre áreas.
 */
export function validateArea(
  value: unknown,
  position: number,
  areaIds: Set<string>,
  billIds: Set<string>,
  seriesIds: Set<string>,
  legacy: boolean,
): Area {
  const label = `A área nº ${position}`
  if (!isPlainObject(value)) fail(`${label} não está no formato esperado.`)

  const { id, name, type, members, bills, series } = value
  if (!isValidId(id)) fail(`${label} está sem um identificador válido.`)
  if (areaIds.has(id)) fail(`Há duas áreas com o mesmo identificador (“${id}”).`)
  areaIds.add(id)

  if (typeof name !== 'string' || !cleanAreaName(name)) fail(`${label} está sem nome.`)
  const cleanName = cleanAreaName(name)
  if (cleanName.length > MAX_AREA_NAME_LENGTH) {
    fail(`O nome da área “${cleanName}” é maior que ${MAX_AREA_NAME_LENGTH} caracteres.`)
  }
  if (type !== 'individual' && type !== 'shared') {
    fail(`A área “${cleanName}” tem um tipo inválido.`)
  }
  if (!Array.isArray(members)) fail(`A área “${cleanName}” está sem a lista de membros.`)
  if (!Array.isArray(bills)) fail(`A área “${cleanName}” está sem a lista de contas.`)
  if (type === 'individual' && members.length > 0) {
    fail(`A área individual “${cleanName}” não pode ter membros.`)
  }
  if (legacy && series !== undefined) {
    fail(`A área “${cleanName}” tem contas recorrentes ou parceladas, que não existem nesta versão dos dados.`)
  }
  if (!legacy && !Array.isArray(series)) {
    fail(`A área “${cleanName}” está sem a lista de contas recorrentes e parceladas.`)
  }

  try {
    const individual = type === 'individual'
    const validated = validateMembers(members, legacy)
    const cleanSeries = Array.isArray(series)
      ? series.map((item, index) =>
          validateSeries(
            item,
            index + 1,
            validated.memberIds,
            validated.inactiveMemberIds,
            individual,
            seriesIds,
          ),
        )
      : []
    const cleanBills = bills.map((bill, index) =>
      validateBill(bill, index + 1, validated.memberIds, billIds, individual, legacy),
    )
    validateOccurrences(cleanBills, cleanSeries)
    return {
      id,
      name: cleanName,
      type,
      members: validated.members,
      bills: cleanBills,
      series: cleanSeries,
    }
  } catch (error) {
    if (error instanceof BackupValidationError) fail(`Na área “${cleanName}”: ${error.message}`)
    throw error
  }
}

/**
 * Áreas nas versões 2 (`legacy`, convertida para a 3 sem séries) e 3.
 * A área "Gastos da casa" é obrigatória e precisa de pelo menos um membro ativo.
 * "Minhas contas" é acrescentada vazia se faltar (só na memória), e precisa ser individual.
 */
function validateAreas(areas: unknown, legacy: boolean): FinanceData {
  if (!Array.isArray(areas) || areas.length === 0) fail('Nenhuma área foi encontrada.')
  if (areas.length > MAX_AREAS) fail('Há áreas demais.')

  const areaIds = new Set<string>()
  // Ids de contas e de séries únicos em todas as áreas, para nada aparecer em duas áreas.
  const billIds = new Set<string>()
  const seriesIds = new Set<string>()
  const cleanAreas = areas.map((area, index) =>
    validateArea(area, index + 1, areaIds, billIds, seriesIds, legacy),
  )
  if (billIds.size > MAX_BILLS) fail('Há contas demais.')

  const home = cleanAreas.find((area) => area.id === HOME_AREA_ID)
  if (!home) fail('A área “Gastos da casa” não foi encontrada.')
  if (home.type !== 'shared') fail('A área “Gastos da casa” precisa ser compartilhada.')
  if (home.members.length === 0) fail('A área “Gastos da casa” não tem nenhum membro.')
  if (home.members.every((member) => member.inactive)) {
    fail('A área “Gastos da casa” não tem nenhum membro ativo.')
  }

  const myAccounts = cleanAreas.find((area) => area.id === MY_ACCOUNTS_AREA_ID)
  if (myAccounts && myAccounts.type !== 'individual') {
    fail('A área “Minhas contas” precisa ser individual.')
  }
  // Os nomes já vêm limpos por validateArea; nenhum nome é corrigido automaticamente.
  if (myAccounts && myAccounts.name !== MY_ACCOUNTS_AREA_NAME) {
    fail('A área fixa “Minhas contas” não pode ter outro nome.')
  }
  const reservedName = MY_ACCOUNTS_AREA_NAME.toLocaleLowerCase('pt-BR')
  const nameClash = cleanAreas.some(
    (area) =>
      area.id !== MY_ACCOUNTS_AREA_ID && area.name.toLocaleLowerCase('pt-BR') === reservedName,
  )
  if (nameClash) fail('O nome “Minhas contas” é reservado para a área fixa.')
  // "Minhas contas" é a única área individual; dados antigos com outras não são aceitos.
  const otherIndividual = cleanAreas.find(
    (area) => area.type === 'individual' && area.id !== MY_ACCOUNTS_AREA_ID,
  )
  if (otherIndividual) {
    fail(`A área individual “${otherIndividual.name}” não é aceita: só “Minhas contas” pode ser individual.`)
  }

  // O limite conta "Minhas contas", para os dados salvos continuarem válidos ao reabrir.
  const withMyAccounts = ensureMyAccountsArea(cleanAreas)
  if (withMyAccounts.length > MAX_AREAS) fail('Há áreas demais.')

  return { version: 3, areas: withMyAccounts }
}

export type StoredDataParseResult =
  | { ok: true; data: FinanceData }
  | { ok: false; error: string }

/**
 * Lê e valida os dados salvos no navegador com as mesmas regras do backup.
 * Dados das versões 1 e 2 são convertidos para a versão 3 apenas na memória; a chave
 * só é regravada quando a pessoa fizer alguma alteração.
 */
export function parseStoredData(text: string): StoredDataParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'O conteúdo salvo não está em formato JSON válido.' }
  }

  try {
    if (isPlainObject(raw) && raw.version === 1) {
      return { ok: true, data: migrateV1ToV3(validateLegacyContent(raw.members, raw.bills)) }
    }
    if (isPlainObject(raw) && raw.version === 2) {
      return { ok: true, data: validateAreas(raw.areas, true) }
    }
    if (isPlainObject(raw) && raw.version === 3) {
      return { ok: true, data: validateAreas(raw.areas, false) }
    }
    fail('Os dados salvos estão em um formato ou versão que este aplicativo não reconhece.')
  } catch (error) {
    if (error instanceof BackupValidationError) return { ok: false, error: error.message }
    return { ok: false, error: 'Os dados salvos estão com problemas e não podem ser usados.' }
  }
}

/**
 * Lê e valida o texto de um arquivo de backup.
 * Nada é alterado aqui: o resultado só é aplicado depois da confirmação.
 */
export function parseBackup(text: string): BackupParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return {
      ok: false,
      error: 'Não foi possível ler o arquivo. Ele não parece ser um backup em formato JSON.',
    }
  }

  try {
    return { ok: true, ...validateBackup(raw) }
  } catch (error) {
    if (error instanceof BackupValidationError) return { ok: false, error: error.message }
    return { ok: false, error: 'O arquivo de backup está com problemas e não pode ser usado.' }
  }
}
