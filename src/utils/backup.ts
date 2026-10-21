import type { Area, Bill, BillShare, FinanceData, LegacyFinanceDataV1, Member } from '../types'
import {
  HOME_AREA_ID,
  MAX_AREA_NAME_LENGTH,
  MAX_AREAS,
  cleanAreaName,
  migrateV1ToV2,
} from './areas'
import { MAX_AMOUNT_CENTS } from './money'

/** Identifica o arquivo como backup deste aplicativo. */
export const BACKUP_FORMAT = 'contas-da-familia-backup'
/**
 * Aumente este número quando o formato do arquivo mudar.
 * 1: { members, bills } (uma área implícita). 2: { areas }.
 * Backups da versão 1 continuam sendo aceitos e são convertidos na importação.
 */
export const BACKUP_FORMAT_VERSION = 2

/** Limites para recusar arquivos absurdos antes de processá-los. */
export const MAX_BACKUP_FILE_BYTES = 5 * 1024 * 1024
export const MAX_MEMBERS = 20
const MAX_BILLS = 20000
const MAX_SHARES_PER_BILL = MAX_MEMBERS
const MAX_ID_LENGTH = 100
/** Mesmos limites usados nos formulários do aplicativo. */
export const MAX_MEMBER_NAME_LENGTH = 20
const MAX_BILL_NAME_LENGTH = 40
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

/** Faz o navegador baixar o backup como arquivo .json. */
export function downloadBackup(backup: BackupFile, fileName: string) {
  downloadTextFile(JSON.stringify(backup, null, 2), fileName, 'application/json')
}

/** Faz o navegador baixar um texto qualquer como arquivo, sem alterá-lo. */
export function downloadTextFile(text: string, fileName: string, type = 'text/plain') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
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
  return { id: member.id, name: member.name, emoji: member.emoji, color: member.color }
}

function sanitizeBill(bill: Bill): Bill {
  const clean: Bill = {
    id: bill.id,
    name: bill.name,
    month: bill.month,
    totalCents: bill.totalCents,
    dueDay: bill.dueDay,
    shares: bill.shares.map((share) => ({
      memberId: share.memberId,
      amountCents: share.amountCents,
    })),
    paid: bill.paid,
  }
  if (bill.isExample) clean.isExample = true
  return clean
}

function sanitizeArea(area: Area): Area {
  return {
    id: area.id,
    name: area.name,
    type: area.type,
    members: area.members.map(sanitizeMember),
    bills: area.bills.map(sanitizeBill),
  }
}

function validateMember(value: unknown, position: number, seenIds: Set<string>): Member {
  const label = `O integrante nº ${position}`
  if (!isPlainObject(value)) fail(`${label} não está no formato esperado.`)

  const { id, name, emoji, color } = value
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

  return { id, name: name.trim(), emoji, color }
}

function validateBill(
  value: unknown,
  position: number,
  memberIds: Set<string>,
  seenIds: Set<string>,
  /** Contas de áreas individuais não têm divisão: `shares` deve ser vazio. */
  individual = false,
): Bill {
  if (!isPlainObject(value)) fail(`A conta nº ${position} não está no formato esperado.`)

  const { id, name, month, totalCents, dueDay, shares, paid, isExample } = value
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
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
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

  if (individual) {
    if (!Array.isArray(shares) || shares.length > 0) {
      fail(`${label} é de uma área individual e não pode ter divisão entre pessoas.`)
    }
    const bill: Bill = { id, name: name.trim(), month, totalCents, dueDay, shares: [], paid }
    if (isExample) bill.isExample = true
    return bill
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

  const bill: Bill = {
    id,
    name: name.trim(),
    month,
    totalCents,
    dueDay,
    shares: cleanShares,
    paid,
  }
  if (isExample) bill.isExample = true
  return bill
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
  if (formatVersion !== 1 && formatVersion !== 2) {
    fail('Esta versão de backup não é reconhecida.')
  }

  const createdAtDate = typeof createdAt === 'string' ? new Date(createdAt) : null
  if (!createdAtDate || Number.isNaN(createdAtDate.getTime())) {
    fail('O backup está sem uma data de criação válida.')
  }

  if (!isPlainObject(data)) fail('O backup está sem os dados do aplicativo.')
  // Versão 1: uma área implícita, convertida para "Gastos da casa" sem alterar os dados.
  const cleanData =
    formatVersion === 1
      ? migrateV1ToV2(validateLegacyContent(data.members, data.bills))
      : validateAreas(data.areas)

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

/** Valida membros e contas de uma área (mesmas regras de sempre). */
function validateMembersAndBills(
  members: unknown[],
  bills: unknown[],
  billIds: Set<string>,
  individual = false,
): { members: Member[]; bills: Bill[] } {
  if (members.length > MAX_MEMBERS) fail('Há integrantes demais.')
  const memberIds = new Set<string>()
  const cleanMembers = members.map((member, index) =>
    validateMember(member, index + 1, memberIds),
  )
  const cleanBills = bills.map((bill, index) =>
    validateBill(bill, index + 1, memberIds, billIds, individual),
  )
  return { members: cleanMembers, bills: cleanBills }
}

/** Dados da versão 1 ({ members, bills }), como eram validados antes das áreas. */
function validateLegacyContent(members: unknown, bills: unknown): LegacyFinanceDataV1 {
  if (!Array.isArray(members) || members.length === 0) {
    fail('Nenhum integrante foi encontrado.')
  }
  if (!Array.isArray(bills)) fail('A lista de contas não foi encontrada.')
  if (bills.length > MAX_BILLS) fail('Há contas demais.')
  return { version: 1, ...validateMembersAndBills(members, bills, new Set()) }
}

function validateArea(
  value: unknown,
  position: number,
  areaIds: Set<string>,
  billIds: Set<string>,
): Area {
  const label = `A área nº ${position}`
  if (!isPlainObject(value)) fail(`${label} não está no formato esperado.`)

  const { id, name, type, members, bills } = value
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

  try {
    const content = validateMembersAndBills(members, bills, billIds, type === 'individual')
    return { id, name: cleanName, type, ...content }
  } catch (error) {
    if (error instanceof BackupValidationError) fail(`Na área “${cleanName}”: ${error.message}`)
    throw error
  }
}

/** Dados da versão 2 ({ areas }). A área "Gastos da casa" é obrigatória. */
function validateAreas(areas: unknown): FinanceData {
  if (!Array.isArray(areas) || areas.length === 0) fail('Nenhuma área foi encontrada.')
  if (areas.length > MAX_AREAS) fail('Há áreas demais.')

  const areaIds = new Set<string>()
  // Ids de contas únicos em todas as áreas, para nenhuma conta aparecer em duas áreas.
  const billIds = new Set<string>()
  const cleanAreas = areas.map((area, index) => validateArea(area, index + 1, areaIds, billIds))
  if (billIds.size > MAX_BILLS) fail('Há contas demais.')

  const home = cleanAreas.find((area) => area.id === HOME_AREA_ID)
  if (!home) fail('A área “Gastos da casa” não foi encontrada.')
  if (home.type !== 'shared') fail('A área “Gastos da casa” precisa ser compartilhada.')
  if (home.members.length === 0) fail('A área “Gastos da casa” não tem nenhum membro.')

  return { version: 2, areas: cleanAreas }
}

export type StoredDataParseResult =
  | { ok: true; data: FinanceData }
  | { ok: false; error: string }

/**
 * Lê e valida os dados salvos no navegador com as mesmas regras do backup.
 * Dados da versão 1 são convertidos para a versão 2 apenas na memória; a chave
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
      return { ok: true, data: migrateV1ToV2(validateLegacyContent(raw.members, raw.bills)) }
    }
    if (isPlainObject(raw) && raw.version === 2) {
      return { ok: true, data: validateAreas(raw.areas) }
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
