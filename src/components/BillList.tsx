import { useId, type ReactNode } from 'react'
import type { Bill, BillSeries, Member, Today } from '../types'
import { effectiveDueDay, getBillStatus } from '../utils/dates'
import { isProjectedBill, seriesLabelFor } from '../utils/series'
import { BillCard } from './BillCard'

interface BillListProps {
  /** Contas do mês: as gravadas e as previstas das séries. */
  bills: Bill[]
  /** Séries da área, para os rótulos "Recorrente" e "Parcela 3/10". */
  series?: BillSeries[]
  members: Member[]
  today: Today
  monthName: string
  previousMonthName: string
  /** O mês anterior tem contas comuns para copiar. */
  canCopyPreviousMonth: boolean
  onAdd: () => void
  onCopyPreviousMonth: () => void
  onTogglePaid: (bill: Bill) => void
  onEdit: (bill: Bill) => void
  onDelete: (bill: Bill) => void
  /** Aviso opcional exibido logo abaixo do cabeçalho da lista. */
  notice?: ReactNode
  /** Ações extras exibidas à esquerda de "Adicionar conta" (ex.: "Excluir área"). */
  actions?: ReactNode
}

export function BillList({
  bills,
  series = [],
  members,
  today,
  monthName,
  previousMonthName,
  canCopyPreviousMonth,
  onAdd,
  onCopyPreviousMonth,
  onTogglePaid,
  onEdit,
  onDelete,
  notice,
  actions,
}: BillListProps) {
  // Id único: pode haver uma lista por área na mesma página.
  const titleId = useId()
  const sortedBills = [...bills].sort(
    (a, b) => effectiveDueDay(a) - effectiveDueDay(b) || a.name.localeCompare(b.name),
  )
  const addButton = (
    <button type="button" className="button button--primary add-button" onClick={onAdd}>
      ＋ Adicionar conta
    </button>
  )
  // Copiar o mês anterior traz só contas comuns: o botão aparece quando o mês ainda não
  // tem nenhuma, mesmo que já existam contas de séries (gravadas ou previstas).
  const hasCommonBills = bills.some((bill) => bill.seriesId === undefined)
  const copyButton = (
    <button type="button" className="button button--ghost" onClick={onCopyPreviousMonth}>
      Copiar contas de {previousMonthName}
    </button>
  )
  const showCopyInHeader = canCopyPreviousMonth && !hasCommonBills && sortedBills.length > 0

  return (
    <section className="section" aria-labelledby={titleId}>
      <div className="section__header section__header--with-action">
        <div>
          <h4 id={titleId} className="section__title">
            Contas de {monthName}
          </h4>
          <p className="section__hint">Organizadas pela data de vencimento</p>
        </div>
        {actions || showCopyInHeader ? (
          <div className="section__actions">
            {actions}
            {showCopyInHeader && copyButton}
            {addButton}
          </div>
        ) : (
          addButton
        )}
      </div>

      {notice}

      {sortedBills.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
              <path d="M9 8h6M9 12h6" />
            </svg>
          </span>
          <h5>Nenhuma conta em {monthName} ainda</h5>
          <p>Adicione a primeira conta do mês para começar a organizar.</p>
          <div className="empty-state__actions">
            <button type="button" className="button button--primary" onClick={onAdd}>
              ＋ Adicionar conta
            </button>
            {canCopyPreviousMonth && copyButton}
          </div>
        </div>
      ) : (
        <ul className="bill-list">
          {sortedBills.map((bill) => (
            <li key={bill.id}>
              <BillCard
                bill={bill}
                status={getBillStatus(bill, today)}
                members={members}
                projected={isProjectedBill(bill)}
                seriesLabel={seriesLabelFor(bill, series)}
                onTogglePaid={() => onTogglePaid(bill)}
                onEdit={() => onEdit(bill)}
                onDelete={() => onDelete(bill)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
