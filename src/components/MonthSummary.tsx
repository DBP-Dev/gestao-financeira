import type { Bill } from '../types'
import { formatBRL } from '../utils/money'

interface MonthSummaryProps {
  bills: Bill[]
}

export function MonthSummary({ bills }: MonthSummaryProps) {
  const total = bills.reduce((sum, bill) => sum + bill.totalCents, 0)
  const paid = bills
    .filter((bill) => bill.paid)
    .reduce((sum, bill) => sum + bill.totalCents, 0)
  const pending = total - paid
  const paidCount = bills.filter((bill) => bill.paid).length
  const progress = total > 0 ? Math.round((paid / total) * 100) : 0

  return (
    <section className="summary" aria-label="Resumo do mês">
      <div className="summary__grid">
        <div className="summary__item">
          <span className="summary__label">Total das contas</span>
          <strong className="summary__value">{formatBRL(total)}</strong>
        </div>
        <div className="summary__item summary__item--paid">
          <span className="summary__label">Já pago</span>
          <strong className="summary__value">{formatBRL(paid)}</strong>
        </div>
        <div className="summary__item summary__item--pending">
          <span className="summary__label">Falta pagar</span>
          <strong className="summary__value">{formatBRL(pending)}</strong>
        </div>
      </div>
      {bills.length > 0 && (
        <div className="summary__progress">
          <div
            className="progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            aria-label="Parte do mês já paga"
          >
            <div className="progress__bar" style={{ width: `${progress}%` }} />
          </div>
          <span className="summary__count">
            {paidCount} de {bills.length}{' '}
            {bills.length === 1 ? 'conta paga' : 'contas pagas'}
          </span>
        </div>
      )}
    </section>
  )
}
