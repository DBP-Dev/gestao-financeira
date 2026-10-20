import type { Bill, Member, Today } from '../types'
import { effectiveDueDay, getBillStatus } from '../utils/dates'
import { BillCard } from './BillCard'

interface BillListProps {
  bills: Bill[]
  members: Member[]
  today: Today
  monthName: string
  previousMonthName: string
  canCopyPreviousMonth: boolean
  onAdd: () => void
  onCopyPreviousMonth: () => void
  onTogglePaid: (bill: Bill) => void
  onEdit: (bill: Bill) => void
  onDelete: (bill: Bill) => void
}

export function BillList({
  bills,
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
}: BillListProps) {
  const sortedBills = [...bills].sort(
    (a, b) => effectiveDueDay(a) - effectiveDueDay(b) || a.name.localeCompare(b.name),
  )

  return (
    <section className="section" aria-labelledby="bills-title">
      <div className="section__header section__header--with-action">
        <div>
          <h2 id="bills-title" className="section__title">
            Contas de {monthName}
          </h2>
          <p className="section__hint">Organizadas pela data de vencimento</p>
        </div>
        <button type="button" className="button button--primary add-button" onClick={onAdd}>
          ＋ Adicionar conta
        </button>
      </div>

      {sortedBills.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
              <path d="M9 8h6M9 12h6" />
            </svg>
          </span>
          <h3>Nenhuma conta em {monthName} ainda</h3>
          <p>Adicione a primeira conta do mês para começar a organizar.</p>
          <div className="empty-state__actions">
            <button type="button" className="button button--primary" onClick={onAdd}>
              ＋ Adicionar conta
            </button>
            {canCopyPreviousMonth && (
              <button
                type="button"
                className="button button--ghost"
                onClick={onCopyPreviousMonth}
              >
                Copiar contas de {previousMonthName}
              </button>
            )}
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
