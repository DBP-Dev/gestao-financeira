import type { MonthKey } from '../types'
import { addMonths, formatMonthLabel } from '../utils/dates'

interface AppHeaderProps {
  month: MonthKey
  currentMonth: MonthKey
  onChangeMonth: (month: MonthKey) => void
}

export function AppHeader({ month, currentMonth, onChangeMonth }: AppHeaderProps) {
  const isCurrentMonth = month === currentMonth

  return (
    <header className="app-header">
      <div className="app-header__title">
        <span className="app-header__logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
            <path d="M10 20v-5h4v5" />
          </svg>
        </span>
        <div>
          <h1>Gestão de Gastos</h1>
          <p className="app-header__subtitle">
            Seus gastos do mês, sozinho ou em grupo.
          </p>
        </div>
      </div>

      <nav className="month-selector" aria-label="Escolher mês">
        <button
          type="button"
          className="month-selector__arrow"
          onClick={() => onChangeMonth(addMonths(month, -1))}
          aria-label="Mês anterior"
        >
          ‹
        </button>
        <div className="month-selector__label" aria-live="polite">
          <span className="month-selector__caption">Mês</span>
          <strong>{formatMonthLabel(month)}</strong>
        </div>
        <button
          type="button"
          className="month-selector__arrow"
          onClick={() => onChangeMonth(addMonths(month, 1))}
          aria-label="Próximo mês"
        >
          ›
        </button>
        {!isCurrentMonth && (
          <button
            type="button"
            className="button button--small button--ghost month-selector__today"
            onClick={() => onChangeMonth(currentMonth)}
          >
            Voltar para o mês atual
          </button>
        )}
      </nav>
    </header>
  )
}
