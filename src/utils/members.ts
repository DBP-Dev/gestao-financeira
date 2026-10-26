import type { Bill, BillSeries, Member } from '../types'
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

/**
 * O membro aparece na divisão de alguma versão de uma conta recorrente ou parcelada.
 * Excluí-lo deixaria a série apontando para alguém que não existe (dados inválidos).
 */
export function isMemberInSeries(memberId: string, series: BillSeries[]): boolean {
  return series.some((item) =>
    item.versions.some((version) =>
      version.shares.some((share) => share.memberId === memberId),
    ),
  )
}

/** Participante ativo: aparece em contas novas, no perfil e em "Sou eu". */
export function isActiveMember(member: Member): boolean {
  return !member.inactive
}

/**
 * O que acontece ao remover um participante:
 * - 'delete': sem contas e sem séries, a exclusão é definitiva (como sempre foi);
 * - 'deactivate': com histórico ou séries, ele é desativado e continua nas contas antigas;
 * - 'blocked': nenhuma das duas é permitida, pelos motivos indicados.
 */
export type MemberRemoval =
  | { mode: 'delete' }
  | { mode: 'deactivate' }
  | { mode: 'blocked'; reasons: string[] }

/**
 * Decide entre excluir, desativar ou bloquear. `protectedMemberId` é o perfil do painel
 * pessoal (só em "Gastos da casa"), que não pode ser excluído nem desativado. Toda área
 * precisa continuar com pelo menos um membro; `requireActive` ("Gastos da casa") exige
 * também que reste um membro ativo. Nas outras áreas, séries que ficariam sem pagador
 * ativo são conferidas na própria desativação.
 */
export function getMemberRemoval(
  member: Member,
  members: Member[],
  bills: Bill[],
  series: BillSeries[],
  protectedMemberId: string | null,
  requireActive: boolean,
): MemberRemoval {
  if (!isActiveMember(member)) {
    return { mode: 'blocked', reasons: ['Este participante já está desativado.'] }
  }
  const reasons: string[] = []
  if (member.id === protectedMemberId) {
    reasons.push(
      'Não é possível excluir nem desativar o membro que está selecionado no painel pessoal.',
    )
  }
  if (members.length <= 1) {
    reasons.push('É preciso ter pelo menos um membro.')
  } else if (
    requireActive &&
    !members.some((other) => other.id !== member.id && isActiveMember(other))
  ) {
    reasons.push('A área “Gastos da casa” precisa de pelo menos um membro ativo.')
  }
  if (reasons.length > 0) return { mode: 'blocked', reasons }
  const hasHistory =
    countMemberBills(member.id, bills) > 0 || isMemberInSeries(member.id, series)
  return hasHistory ? { mode: 'deactivate' } : { mode: 'delete' }
}
