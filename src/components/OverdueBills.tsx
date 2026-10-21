import { useId } from 'react'
import type { Bill } from '../types'
import { formatDueDate, formatMonthLabel } from '../utils/dates'
import { formatBRL } from '../utils/money'

interface OverdueBillsProps {
  /** Contas de meses anteriores, não pagas e já vencidas. */
  bills: Bill[]
  onMarkPaid: (bill: Bill) => void
  /** Nome da área, incluído só no rótulo acessível. Sem ele, o rótulo vem do título visível. */
  areaName?: string
}

export function OverdueBills({ bills, onMarkPaid, areaName }: OverdueBillsProps) {
  const titleId = useId()
  if (bills.length === 0) return null

  const total = bills.reduce((sum, bill) => sum + bill.totalCents, 0)

  return (
    <div
      className="overdue"
      role="region"
      aria-labelledby={areaName ? undefined : titleId}
      aria-label={areaName ? `Contas atrasadas de meses anteriores — ${areaName}` : undefined}
    >
      <div className="overdue__header">
        <h4 id={titleId} className="overdue__title">
          ! Contas atrasadas de meses anteriores
        </h4>
        <p className="overdue__total">
          {bills.length === 1 ? '1 conta' : `${bills.length} contas`} ·{' '}
          <strong>{formatBRL(total)}</strong> em atraso
        </p>
      </div>

      <ul className="overdue__list">
        {bills.map((bill) => (
          <li key={bill.id} className="overdue__item">
            <div className="overdue__info">
              <strong>{bill.name}</strong>
              <span className="overdue__details">
                Referente a {formatMonthLabel(bill.month)} · Venceu em {formatDueDate(bill)}
              </span>
            </div>
            <strong className="overdue__value">{formatBRL(bill.totalCents)}</strong>
            <button
              type="button"
              className="button button--small button--success"
              onClick={() => onMarkPaid(bill)}
              aria-label={`Marcar ${bill.name} de ${formatMonthLabel(bill.month)} como paga`}
            >
              Marcar como paga
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
