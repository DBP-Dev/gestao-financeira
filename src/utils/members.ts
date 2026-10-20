import type { Bill, Member } from '../types'
import { MAX_MEMBER_NAME_LENGTH, MAX_MEMBERS } from './backup'
import { createId } from './ids'

export { MAX_MEMBER_NAME_LENGTH, MAX_MEMBERS }

/** Aparência padrão de novos membros (o avatar exibido usa só a inicial). */
const NEW_MEMBER_EMOJI = '🙂'
const NEW_MEMBER_COLOR = '#dfe3e8'

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
  if (!trimmed) return 'Escreva um nome.'
  if (trimmed.length > MAX_MEMBER_NAME_LENGTH) {
    return `O nome pode ter no máximo ${MAX_MEMBER_NAME_LENGTH} letras.`
  }
  const duplicate = members.find(
    (member) => member.id !== ignoreId && normalizeName(member.name) === normalizeName(trimmed),
  )
  if (duplicate) return `Já existe um membro chamado “${duplicate.name}”.`
  return null
}

/** Novo membro com id próprio, independente do nome. */
export function createMember(name: string): Member {
  return { id: createId(), name: name.trim(), emoji: NEW_MEMBER_EMOJI, color: NEW_MEMBER_COLOR }
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
    blockers.push(
      `${member.name} participa de ${billCount === 1 ? '1 conta' : `${billCount} contas`} ` +
        '(contando meses anteriores). Para proteger o histórico, só é possível excluir quem ' +
        'não participa de nenhuma conta. Se quiser, edite essas contas e tire a pessoa delas antes.',
    )
  }
  if (member.id === currentMemberId) {
    blockers.push(`${member.name} é quem aparece em “Meu painel” como você.`)
  }
  if (members.length <= 1) {
    blockers.push('A família precisa ter pelo menos um membro.')
  }
  return blockers
}
