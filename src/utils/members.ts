import type { Bill, Member } from '../types'
import { MAX_MEMBER_NAME_LENGTH, MAX_MEMBERS } from './backup'
import { createId } from './ids'

export { MAX_MEMBER_NAME_LENGTH, MAX_MEMBERS }

/** Ícone padrão de novos membros (o formato dos dados exige um; a tela mostra a inicial). */
const NEW_MEMBER_EMOJI = '🙂'

export interface MemberColorOption {
  value: string
  /** Nome lido por leitores de tela. */
  label: string
}

/**
 * Cores disponíveis para os membros. As cinco primeiras são as dos membros de exemplo.
 * Todas são claras: contornos com contraste alto no tema escuro e, misturadas ao fundo
 * do avatar, mantêm a inicial legível (contraste AA).
 */
export const MEMBER_COLOR_OPTIONS: MemberColorOption[] = [
  { value: '#d8ecff', label: 'Azul' },
  { value: '#ffe0e6', label: 'Rosa' },
  { value: '#dff3e4', label: 'Verde' },
  { value: '#fff0c9', label: 'Amarelo' },
  { value: '#ece3ff', label: 'Lilás' },
  { value: '#ffe2cc', label: 'Pêssego' },
  { value: '#d4f1ee', label: 'Água-marinha' },
  { value: '#f3dcf0', label: 'Orquídea' },
  { value: '#e5edc6', label: 'Lima' },
  { value: '#dfe3e8', label: 'Cinza' },
]

const MEMBER_COLORS = MEMBER_COLOR_OPTIONS.map((option) => option.value)

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase('pt-BR')
}

/**
 * Valida o nome de um membro. Devolve a mensagem de erro, ou null se estiver ok.
 * `ignoreId` permite que um membro mantenha o próprio nome ao ser editado.
 */
export function validateMemberName(
  name: string,
  members: Member[],
  ignoreId?: string,
): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Informe um nome.'
  if (trimmed.length > MAX_MEMBER_NAME_LENGTH) {
    return `O nome pode ter no máximo ${MAX_MEMBER_NAME_LENGTH} caracteres.`
  }
  const duplicate = members.find(
    (member) => member.id !== ignoreId && normalizeName(member.name) === normalizeName(trimmed),
  )
  if (duplicate) return `Já existe um membro chamado “${duplicate.name}”.`
  return null
}

/** Cor menos usada da paleta (empate: a primeira). Não depende do nome do membro. */
export function pickMemberColor(members: Member[]): string {
  const usage = new Map(MEMBER_COLORS.map((color) => [color, 0]))
  for (const member of members) {
    const color = member.color.toLowerCase()
    const count = usage.get(color)
    if (count !== undefined) usage.set(color, count + 1)
  }
  let best = MEMBER_COLORS[0]
  for (const color of MEMBER_COLORS) {
    if ((usage.get(color) ?? 0) < (usage.get(best) ?? 0)) best = color
  }
  return best
}

/** Novo membro com id próprio, independente do nome. Sem cor escolhida, usa a menos usada. */
export function createMember(
  name: string,
  members: Member[],
  color: string = pickMemberColor(members),
): Member {
  return { id: createId(), name: name.trim(), emoji: NEW_MEMBER_EMOJI, color }
}

/** Quantas contas (de qualquer mês) têm participação deste membro. */
export function countMemberBills(memberId: string, bills: Bill[]): number {
  return bills.filter((bill) => bill.shares.some((share) => share.memberId === memberId)).length
}

/** Motivos que impedem excluir um membro. Lista vazia = exclusão permitida. */
export function getMemberDeletionBlockers(
  member: Member,
  members: Member[],
  bills: Bill[],
  currentMemberId: string | null,
): string[] {
  const blockers: string[] = []
  const billCount = countMemberBills(member.id, bills)
  if (billCount > 0) {
    const billsLabel = billCount === 1 ? '1 conta' : `${billCount} contas`
    blockers.push(
      `Não é possível excluir este membro porque ele participa de ${billsLabel} ` +
        '(contando todos os meses).',
    )
  }
  if (member.id === currentMemberId) {
    blockers.push('Não é possível excluir o membro que está selecionado no painel pessoal.')
  }
  if (members.length <= 1) {
    blockers.push('A família precisa ter pelo menos um membro.')
  }
  return blockers
}
