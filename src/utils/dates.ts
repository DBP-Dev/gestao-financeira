import type { Bill, BillStatus, MonthKey, Today } from '../types'

function parseMonthKey(key: MonthKey): { year: number; month: number } {
  const [year, month] = key.split('-').map(Number)
  return { year, month }
}

export function monthKeyFromDate(date: Date): MonthKey {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${date.getFullYear()}-${month}`
}

export function getToday(): Today {
  const now = new Date()
  return { month: monthKeyFromDate(now), day: now.getDate() }
}

export function addMonths(key: MonthKey, delta: number): MonthKey {
  const { year, month } = parseMonthKey(key)
  return monthKeyFromDate(new Date(year, month - 1 + delta, 1))
}

export function daysInMonth(key: MonthKey): number {
  const { year, month } = parseMonthKey(key)
  return new Date(year, month, 0).getDate()
}

/** "2026-10" → "Outubro de 2026" */
export function formatMonthLabel(key: MonthKey): string {
  const { year, month } = parseMonthKey(key)
  const label = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** "2026-10" → "outubro" */
export function formatMonthName(key: MonthKey): string {
  const { year, month } = parseMonthKey(key)
  return new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(
    new Date(year, month - 1, 1),
  )
}

/** Dia de vencimento ajustado ao tamanho do mês (ex.: dia 31 em fevereiro vira 28). */
export function effectiveDueDay(bill: Bill): number {
  return Math.min(bill.dueDay, daysInMonth(bill.month))
}

/** "Vence em 10 de outubro" */
export function formatDueDate(bill: Bill): string {
  return `${effectiveDueDay(bill)} de ${formatMonthName(bill.month)}`
}

export function getBillStatus(bill: Bill, today: Today): BillStatus {
  if (bill.paid) return 'paid'
  const isPastMonth = bill.month < today.month
  const isPastDayThisMonth =
    bill.month === today.month && effectiveDueDay(bill) < today.day
  return isPastMonth || isPastDayThisMonth ? 'late' : 'pending'
}
