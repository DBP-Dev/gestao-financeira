import type { Bill, BillStatus, Member } from '../domain/types'
import { formatDueDate } from '../domain/dates'
import { formatBRL } from '../domain/money'
import { Avatar } from './Avatar'

interface BillCardProps {
  bill: Bill
  status: BillStatus
  members: Member[]
  /**
   * Conta prevista de uma série (ainda não gravada). Pagar ou editar grava a ocorrência
   * do mês; excluir impede que ela seja criada.
   */
  projected?: boolean
  /** Rótulo da série: "Recorrente" ou "Parcela 3/10". */
  seriesLabel?: string | null
  onTogglePaid: () => void
  onEdit: () => void
  onDelete: () => void
}

const STATUS_LABEL: Record<BillStatus, string> = {
  paid: '✓ Paga',
  pending: '○ Pendente',
  late: 'Atrasada',
}

export function BillCard({
  bill,
  status,
  members,
  projected = false,
  seriesLabel = null,
  onTogglePaid,
  onEdit,
  onDelete,
}: BillCardProps) {
  const isSinglePerson = bill.shares.length === 1

  return (
    <article className={`bill-card bill-card--${status} ${projected ? 'bill-card--projected' : ''}`}>
      <div className="bill-card__top">
        <div>
          <h5 className="bill-card__name">
            {bill.name}
            {bill.isExample && <span className="tag tag--example">Exemplo</span>}
            {projected && <span className="tag tag--projected">Prevista</span>}
            {seriesLabel && <span className="tag tag--series">{seriesLabel}</span>}
          </h5>
          <p className="bill-card__due">Vence em {formatDueDate(bill)}</p>
        </div>
        <div className="bill-card__amount">
          <strong>{formatBRL(bill.totalCents)}</strong>
          <span className={`tag tag--${status}`}>{STATUS_LABEL[status]}</span>
        </div>
      </div>

      {/* Contas de áreas individuais não têm divisão entre pessoas. */}
      {bill.shares.length > 0 && (
        <div className="bill-card__shares">
          <span className="bill-card__shares-title">
            {isSinglePerson ? 'Quem paga' : 'Quanto cada um paga'}
          </span>
          <ul className="shares">
            {bill.shares.map((share) => {
              const member = members.find((item) => item.id === share.memberId)
              if (!member) return null
              return (
                <li key={share.memberId} className="shares__item">
                  <Avatar member={member} size="small" />
                  <span className="shares__name">{member.name}</span>
                  <span className="shares__value">{formatBRL(share.amountCents)}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {projected && (
        <p className="bill-card__note">
          Prevista: ela será criada automaticamente quando o mês chegar.
        </p>
      )}
      <div className="bill-card__actions">
        <button
          type="button"
          className={`button button--small ${bill.paid ? 'button--ghost' : 'button--success'}`}
          onClick={onTogglePaid}
        >
          {bill.paid ? 'Marcar como pendente' : 'Marcar como paga'}
        </button>
        <div className="bill-card__secondary-actions">
          <button
            type="button"
            className="button button--small button--ghost"
            onClick={onEdit}
            aria-label={`Editar a conta ${bill.name}`}
          >
            Editar
          </button>
          <button
            type="button"
            className="button button--small button--ghost button--danger-text"
            onClick={onDelete}
            aria-label={`Excluir a conta ${bill.name}`}
          >
            Excluir
          </button>
        </div>
      </div>
    </article>
  )
}
