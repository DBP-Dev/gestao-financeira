import { useId } from 'react'
import type { Bill, Member } from '../types'
import { formatBRL } from '../utils/money'
import { Avatar } from './Avatar'

interface FamilyMembersProps {
  /** Título da seção. Padrão: "Membros", usado em "Gastos da casa". */
  title?: string
  members: Member[]
  bills: Bill[]
  /** Mensagem da última ação (adicionar, editar ou excluir). */
  feedback: string | null
  canAdd: boolean
  onAdd: () => void
  onEdit: (member: Member) => void
  onDelete: (member: Member) => void
  /** Participante marcado como "eu" nesta área (só em áreas compartilhadas criadas). */
  selfMemberId?: string | null
  /** Se informado, mostra "Sou eu": marca o participante ou, se já marcado, desmarca. */
  onToggleSelf?: (member: Member) => void
}

function getMemberTotals(memberId: string, bills: Bill[]) {
  let total = 0
  let pending = 0
  for (const bill of bills) {
    const share = bill.shares.find((item) => item.memberId === memberId)
    if (!share) continue
    total += share.amountCents
    if (!bill.paid) pending += share.amountCents
  }
  return { total, pending }
}

export function FamilyMembers({
  title = 'Membros',
  members,
  bills,
  feedback,
  canAdd,
  onAdd,
  onEdit,
  onDelete,
  selfMemberId = null,
  onToggleSelf,
}: FamilyMembersProps) {
  // Id único por instância: a seção aparece em mais de uma área.
  const titleId = useId()
  return (
    <section className="section" aria-labelledby={titleId}>
      <div className="section__header section__header--with-action">
        <div>
          <h4 id={titleId} className="section__title">
            {title}
          </h4>
          <p className="section__hint">
            {canAdd
              ? 'Quanto cabe a cada um neste mês'
              : `Limite de ${members.length} membros atingido`}
          </p>
        </div>
        <button
          type="button"
          className="button button--ghost add-button"
          onClick={onAdd}
          disabled={!canAdd}
        >
          ＋ Adicionar membro
        </button>
      </div>

      <p className="members__feedback" role="status">
        {feedback && <span className="backup-message backup-message--ok">{feedback}</span>}
      </p>

      <ul className="members">
        {members.map((member) => {
          const { total, pending } = getMemberTotals(member.id, bills)
          const isSelf = member.id === selfMemberId
          return (
            <li key={member.id} className={`member-card ${isSelf ? 'member-card--self' : ''}`}>
              <Avatar member={member} size="large" />
              <strong className="member-card__name">{member.name}</strong>
              {total === 0 ? (
                <span className="member-card__muted">Sem contas este mês</span>
              ) : (
                <>
                  <span className="member-card__total">{formatBRL(total)}</span>
                  {pending === 0 ? (
                    <span className="tag tag--paid">✓ Tudo pago</span>
                  ) : (
                    <span className="tag tag--pending">
                      ○ Falta {formatBRL(pending)}
                    </span>
                  )}
                </>
              )}
              <div className="member-card__actions">
                {onToggleSelf && (
                  <button
                    type="button"
                    className="link-button link-button--self"
                    onClick={() => onToggleSelf(member)}
                    aria-pressed={isSelf}
                    aria-label={`Sou eu: ${member.name}`}
                  >
                    {isSelf ? '✓ Sou eu' : 'Sou eu'}
                  </button>
                )}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onEdit(member)}
                  aria-label={`Editar o nome de ${member.name}`}
                >
                  Editar
                </button>
                <button
                  type="button"
                  className="link-button link-button--danger"
                  onClick={() => onDelete(member)}
                  aria-label={`Excluir ${member.name}`}
                >
                  Excluir
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
