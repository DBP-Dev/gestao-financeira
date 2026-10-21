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

/** Dias corridos de hoje até o vencimento (0 = vence hoje; negativo = já venceu). */
export function daysUntilDue(bill: Bill, today: Today): number {
  const due = parseMonthKey(bill.month)
  const now = parseMonthKey(today.month)
  // UTC evita diferenças de horário de verão na conta de dias.
  const dueTime = Date.UTC(due.year, due.month - 1, effectiveDueDay(bill))
  const todayTime = Date.UTC(now.year, now.month - 1, today.day)
  return Math.round((dueTime - todayTime) / 86_400_000)
}

/**
 * Conta pendente (não paga e ainda não vencida) que vence nos próximos `days` dias,
 * contando hoje: com 3, vale hoje, amanhã e depois de amanhã.
 */
export function isDueSoon(bill: Bill, today: Today, days = 3): boolean {
  if (getBillStatus(bill, today) !== 'pending') return false
  const remaining = daysUntilDue(bill, today)
  return remaining >= 0 && remaining < days
}
