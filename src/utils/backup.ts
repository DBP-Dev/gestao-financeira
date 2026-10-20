import type { Bill, BillShare, FinanceData, Member } from '../types'
import { MAX_AMOUNT_CENTS } from './money'

/** Identifica o arquivo como backup deste aplicativo. */
export const BACKUP_FORMAT = 'contas-da-familia-backup'
/** Aumente este número quando o formato do arquivo mudar. */
export const BACKUP_FORMAT_VERSION = 1

/** Limites para recusar arquivos absurdos antes de processá-los. */
export const MAX_BACKUP_FILE_BYTES = 5 * 1024 * 1024
const MAX_MEMBERS = 20
const MAX_BILLS = 20000
const MAX_SHARES_PER_BILL = MAX_MEMBERS
const MAX_ID_LENGTH = 100
/** Mesmos limites usados nos formulários do aplicativo. */
const MAX_MEMBER_NAME_LENGTH = 20
const MAX_BILL_NAME_LENGTH = 40
const MAX_EMOJI_LENGTH = 16

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  formatVersion: typeof BACKUP_FORMAT_VERSION
  createdAt: string
  data: {
    members: Member[]
    bills: Bill[]
  }
}

export interface BackupSummary {
  createdAt: Date
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
      members: data.members.map(sanitizeMember),
      bills: data.bills.map(sanitizeBill),
    },
  }
}

/** "contas-da-familia-backup-2026-10-20-1430.json" */
export function createBackupFileName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`
  return `contas-da-familia-backup-${date}-${time}.json`
}

/** Faz o navegador baixar o backup como arquivo .json. */
export function downloadBackup(backup: BackupFile, fileName: string) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
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
      fail(`${label} está ligada a uma pessoa que não existe na lista da família.`)
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
    fail('Este arquivo não é um backup do Contas da Família.')
  }

  const { formatVersion, createdAt, data } = raw
  if (typeof formatVersion !== 'number' || !Number.isInteger(formatVersion)) {
    fail('Não foi possível identificar a versão deste backup.')
  }
  if (formatVersion > BACKUP_FORMAT_VERSION) {
    fail('Este backup foi feito por uma versão mais nova do aplicativo e não pode ser lido aqui.')
  }
  if (formatVersion !== BACKUP_FORMAT_VERSION) {
    fail('Esta versão de backup não é reconhecida.')
  }

  const createdAtDate = typeof createdAt === 'string' ? new Date(createdAt) : null
  if (!createdAtDate || Number.isNaN(createdAtDate.getTime())) {
    fail('O backup está sem uma data de criação válida.')
  }

  if (!isPlainObject(data)) fail('O backup está sem os dados do aplicativo.')
  const { members, bills } = data

  if (!Array.isArray(members) || members.length === 0) {
    fail('O backup não tem nenhum integrante da família.')
  }
  if (members.length > MAX_MEMBERS) fail('O backup tem integrantes demais.')
  if (!Array.isArray(bills)) fail('O backup está sem a lista de contas.')
  if (bills.length > MAX_BILLS) fail('O backup tem contas demais.')

  const memberIds = new Set<string>()
  const cleanMembers = members.map((member, index) =>
    validateMember(member, index + 1, memberIds),
  )

  const billIds = new Set<string>()
  const cleanBills = bills.map((bill, index) =>
    validateBill(bill, index + 1, memberIds, billIds),
  )

  return {
    data: { version: 1, members: cleanMembers, bills: cleanBills },
    summary: {
      createdAt: createdAtDate,
      memberCount: cleanMembers.length,
      billCount: cleanBills.length,
      monthCount: new Set(cleanBills.map((bill) => bill.month)).size,
    },
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
