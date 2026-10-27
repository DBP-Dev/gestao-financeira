import { useId } from 'react'
import type { Bill, Member } from '../domain/types'
import { formatBRL } from '../domain/money'
import { feedbackClassName, type SaveFeedback } from '../utils/saveFeedback'
import { Avatar } from './Avatar'

interface FamilyMembersProps {
  /** Título da seção. Padrão: "Membros", usado em "Gastos da casa". */
  title?: string
  members: Member[]
  bills: Bill[]
  /**
   * Mensagem da última ação (adicionar, editar, excluir ou desativar), com o tom que diz se
   * a alteração já foi salva, está sendo salva ou ficou só nesta tela.
   */
  feedback: SaveFeedback | null
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
  // Desativados ficam num grupo recolhido, sem ações (não há reativação nem exclusão deles).
  const activeMembers = members.filter((member) => !member.inactive)
  const inactiveMembers = members.filter((member) => member.inactive)

  /** Valores do mês do participante: total e quanto falta pagar. */
  function renderTotals(member: Member) {
    const { total, pending } = getMemberTotals(member.id, bills)
    if (total === 0) return <span className="member-card__muted">Sem contas este mês</span>
    return (
      <>
        <span className="member-card__total">{formatBRL(total)}</span>
        {pending === 0 ? (
          <span className="tag tag--paid">✓ Tudo pago</span>
        ) : (
          <span className="tag tag--pending">○ Falta {formatBRL(pending)}</span>
        )}
      </>
    )
  }

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
        {feedback && <span className={feedbackClassName(feedback.tone)}>{feedback.text}</span>}
      </p>

      <ul className="members">
        {activeMembers.map((member) => {
          const isSelf = member.id === selfMemberId
          return (
            <li key={member.id} className={`member-card ${isSelf ? 'member-card--self' : ''}`}>
              <Avatar member={member} size="large" />
              <strong className="member-card__name">{member.name}</strong>
              {renderTotals(member)}
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

      {inactiveMembers.length > 0 && (
        <details className="members-inactive">
          <summary className="members-inactive__summary">
            Desativados ({inactiveMembers.length})
          </summary>
          <ul className="members">
            {inactiveMembers.map((member) => (
              <li key={member.id} className="member-card member-card--inactive">
                <Avatar member={member} size="large" />
                <strong className="member-card__name">{member.name}</strong>
                {renderTotals(member)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
