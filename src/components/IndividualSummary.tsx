import { formatBRL } from '../utils/money'

interface IndividualSummaryProps {
  /** Mês selecionado, por extenso (ex.: "outubro de 2026"). */
  monthLabel: string
  /** Mês atual real, por extenso; o atraso considera só meses anteriores a ele. */
  currentMonthLabel: string
  /** Soma das contas individuais do mês selecionado (pagas e pendentes). */
  monthTotalCents: number
  /** Parte ainda não paga do mês selecionado. */
  monthPendingCents: number
  /** Contas individuais não pagas de meses anteriores ao mês atual real. */
  previousOverdueCents: number
}

/**
 * Indicadores das contas individuais. O atraso de meses anteriores fica separado:
 * ele não depende do mês selecionado e não deve ser somado aos valores do mês.
 */
export function IndividualSummary({
  monthLabel,
  currentMonthLabel,
  monthTotalCents,
  monthPendingCents,
  previousOverdueCents,
}: IndividualSummaryProps) {
  return (
    <div className="individual-summary">
      <dl className="individual-summary__month">
        <div className="individual-summary__item">
          <dt className="individual-summary__label">Total de {monthLabel}</dt>
          <dd className="individual-summary__total">{formatBRL(monthTotalCents)}</dd>
        </div>
        <div className="individual-summary__item individual-summary__item--inline">
          <dt className="individual-summary__label">Pendente de {monthLabel}</dt>
          <dd className="individual-summary__pending">{formatBRL(monthPendingCents)}</dd>
        </div>
      </dl>
      <dl
        className={`individual-summary__overdue ${previousOverdueCents > 0 ? 'individual-summary__overdue--late' : ''}`}
      >
        <div className="individual-summary__item">
          <dt className="individual-summary__label">Em atraso de meses anteriores</dt>
          <dd className="individual-summary__overdue-value">{formatBRL(previousOverdueCents)}</dd>
          <dd className="individual-summary__hint">
            Contas não pagas antes de {currentMonthLabel}. Não muda com o mês escolhido.
          </dd>
        </div>
      </dl>
    </div>
  )
}
