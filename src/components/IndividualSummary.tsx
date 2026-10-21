import { formatBRL } from '../utils/money'

interface IndividualSummaryProps {
  /** Mês selecionado, por extenso (ex.: "outubro de 2026"). */
  monthLabel: string
  /** Soma das contas individuais do mês selecionado (pagas e pendentes). */
  monthTotalCents: number
  /** Parte ainda não paga do mês selecionado. */
  monthPendingCents: number
}

/** Resumo do mês das contas individuais: total e, menor, o que falta pagar. */
export function IndividualSummary({
  monthLabel,
  monthTotalCents,
  monthPendingCents,
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
    </div>
  )
}
