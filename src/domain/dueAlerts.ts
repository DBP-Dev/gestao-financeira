import type { Area, Bill, MonthKey, Today } from './types'
import { effectiveDueDay, formatMonthName, getBillStatus, nextBusinessDay } from './dates'
import { billsForMonth } from './series'

/** Conta em alerta no Painel Pessoal: de qual área, qual conta e quando vence. */
export interface DueAlert {
  areaId: string
  areaName: string
  billId: string
  billName: string
  month: MonthKey
  /** Dia de vencimento já ajustado ao tamanho do mês. */
  dueDay: number
}

export interface DueAlerts {
  /** Não pagas com vencimento antes de hoje (de qualquer mês), da mais antiga para a mais recente. */
  overdue: DueAlert[]
  /** Não pagas que vencem de hoje até o próximo dia útil, inclusive, pela data. */
  dueSoon: DueAlert[]
}

/** Quantas contas cada seção mostra; as demais viram "e mais N". Só visual. */
export const MAX_VISIBLE_ALERTS = 3

/** Mês e dia como texto comparável ("2026-10-05"). */
function dateKey(month: MonthKey, day: number): string {
  return `${month}-${String(day).padStart(2, '0')}`
}

function toAlert(area: Area, bill: Bill): DueAlert {
  return {
    areaId: area.id,
    areaName: area.name,
    billId: bill.id,
    billName: bill.name,
    month: bill.month,
    dueDay: effectiveDueDay(bill),
  }
}

/** Pela data de vencimento; no mesmo dia, mantém a ordem das áreas e das contas. */
function byDueDate(a: DueAlert, b: DueAlert): number {
  return dateKey(a.month, a.dueDay).localeCompare(dateKey(b.month, b.dueDay))
}

/**
 * Alertas do Painel Pessoal, só com as contas que entram em "Sua parte": áreas individuais
 * inteiras; nas compartilhadas, só contas com parte de quem `selfIdFor` indicar (null: a
 * área fica de fora). Não depende do mês selecionado.
 *
 * - Em atraso: contas gravadas não pagas que `getBillStatus` considera atrasadas. As
 *   ocorrências passadas já são gravadas pela gravação automática; nada é gravado aqui.
 * - Próximas: contas não pagas que vencem de hoje até o próximo dia útil, inclusive, nos
 *   meses dessa janela, com as previstas de `billsForMonth` (que pula meses já gravados e
 *   excluídos, sem duplicar ocorrências).
 *
 * Uma conta atrasada já venceu e nunca está entre as próximas.
 */
export function getDueAlerts(
  areas: Area[],
  today: Today,
  selfIdFor: (area: Area) => string | null,
): DueAlerts {
  const limit = nextBusinessDay(today)
  const from = dateKey(today.month, today.day)
  const until = dateKey(limit.month, limit.day)
  const windowMonths = today.month === limit.month ? [today.month] : [today.month, limit.month]

  const overdue: DueAlert[] = []
  const dueSoon: DueAlert[] = []
  for (const area of areas) {
    let isMine: (bill: Bill) => boolean
    if (area.type === 'individual') {
      isMine = () => true
    } else {
      const selfId = selfIdFor(area)
      if (selfId === null) continue
      isMine = (bill) => bill.shares.some((share) => share.memberId === selfId)
    }
    for (const bill of area.bills) {
      if (isMine(bill) && getBillStatus(bill, today) === 'late') overdue.push(toAlert(area, bill))
    }
    for (const month of windowMonths) {
      for (const bill of billsForMonth(area, month)) {
        if (bill.paid || !isMine(bill)) continue
        const due = dateKey(bill.month, effectiveDueDay(bill))
        if (due >= from && due <= until) dueSoon.push(toAlert(area, bill))
      }
    }
  }
  return { overdue: overdue.sort(byDueDate), dueSoon: dueSoon.sort(byDueDate) }
}

/** "10 de outubro"; com o ano quando ele não é o de hoje ("10 de outubro de 2025"). */
export function formatAlertDate(alert: DueAlert, today: Today): string {
  const label = `${alert.dueDay} de ${formatMonthName(alert.month)}`
  return alert.month.slice(0, 4) === today.month.slice(0, 4) ? label : `${label} de ${alert.month.slice(0, 4)}`
}

/** Itens visíveis (no máximo MAX_VISIBLE_ALERTS) e quantos ficaram de fora. */
export function visibleAlerts(alerts: DueAlert[]): { shown: DueAlert[]; hidden: number } {
  return {
    shown: alerts.slice(0, MAX_VISIBLE_ALERTS),
    hidden: Math.max(0, alerts.length - MAX_VISIBLE_ALERTS),
  }
}
