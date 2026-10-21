import type { Bill } from '../types'
import { getBillsTotals } from '../utils/billTotals'
import { formatBRL } from '../utils/money'
import { OverdueBills } from './OverdueBills'

interface MonthSummaryProps {
  bills: Bill[]
  /** Contas atrasadas de meses anteriores (não entram nos totais do mês). */
  overdueBills: Bill[]
  onMarkPaid: (bill: Bill) => void
  /** Nome da área, incluído só nos rótulos acessíveis. Sem ele, os rótulos ficam como antes. */
  areaName?: string
}

export function MonthSummary({ bills, overdueBills, onMarkPaid, areaName }: MonthSummaryProps) {
  const {
    totalCents: total,
    paidCents: paid,
    pendingCents: pending,
    paidCount,
  } = getBillsTotals(bills)
  // Arredonda para baixo: só chega a 100% quando não falta nada a pagar.
  const progress = total > 0 ? Math.floor((paid * 100) / total) : 0
  const labelSuffix = areaName ? ` — ${areaName}` : ''

  return (
    <section className="summary" aria-label={`Resumo do mês${labelSuffix}`}>
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
            aria-label={`Parte do mês já paga${labelSuffix}`}
          >
            <div className="progress__bar" style={{ width: `${progress}%` }} />
          </div>
          <span className="summary__count">
            {paidCount} de {bills.length}{' '}
            {bills.length === 1 ? 'conta paga' : 'contas pagas'}
          </span>
        </div>
      )}
      <OverdueBills bills={overdueBills} onMarkPaid={onMarkPaid} areaName={areaName} />
    </section>
  )
}
