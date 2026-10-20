import { useEffect, useState } from 'react'
import { createInitialData } from '../data/sampleData'
import type { Bill, FinanceData, MonthKey } from '../types'
import { getToday } from '../utils/dates'
import { createId } from '../utils/ids'

const STORAGE_KEY = 'gestao-financeira:dados:v1'

function isFinanceData(value: unknown): value is FinanceData {
  if (typeof value !== 'object' || value === null) return false
  const data = value as Partial<FinanceData>
  return (
    data.version === 1 &&
    Array.isArray(data.members) &&
    Array.isArray(data.bills)
  )
}

function loadData(): FinanceData {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed: unknown = JSON.parse(saved)
      if (isFinanceData(parsed)) return parsed
    }
  } catch {
    // Dados corrompidos ou armazenamento bloqueado: começa com os exemplos.
  }
  return createInitialData(getToday().month)
}

function saveData(data: FinanceData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Sem espaço ou armazenamento bloqueado: o app continua funcionando na sessão.
  }
}

export type BillInput = Omit<Bill, 'id' | 'isExample'>

/** Guarda integrantes e contas, salvando tudo no navegador automaticamente. */
export function useFinanceStore() {
  const [data, setData] = useState<FinanceData>(loadData)

  useEffect(() => {
    saveData(data)
  }, [data])

  function addBill(input: BillInput) {
    setData((current) => ({
      ...current,
      bills: [...current.bills, { ...input, id: createId() }],
    }))
  }

  function updateBill(id: string, input: BillInput) {
    setData((current) => ({
      ...current,
      bills: current.bills.map((bill) =>
        // Depois de editada, a conta deixa de ser considerada exemplo.
        bill.id === id ? { ...input, id, isExample: false } : bill,
      ),
    }))
  }

  function deleteBill(id: string) {
    setData((current) => ({
      ...current,
      bills: current.bills.filter((bill) => bill.id !== id),
    }))
  }

  function togglePaid(id: string) {
    setData((current) => ({
      ...current,
      bills: current.bills.map((bill) =>
        bill.id === id ? { ...bill, paid: !bill.paid } : bill,
      ),
    }))
  }

  function copyBills(fromMonth: MonthKey, toMonth: MonthKey) {
    setData((current) => {
      const copies = current.bills
        .filter((bill) => bill.month === fromMonth)
        .map((bill) => ({
          ...bill,
          id: createId(),
          month: toMonth,
          paid: false,
        }))
      return { ...current, bills: [...current.bills, ...copies] }
    })
  }

  function deleteExamples() {
    setData((current) => ({
      ...current,
      bills: current.bills.filter((bill) => !bill.isExample),
    }))
  }

  function renameMember(id: string, name: string) {
    setData((current) => ({
      ...current,
      members: current.members.map((member) =>
        member.id === id ? { ...member, name } : member,
      ),
    }))
  }

  /** Substitui todos os dados de uma vez (usado ao restaurar um backup já validado). */
  function replaceAllData(next: FinanceData) {
    setData(next)
  }

  return {
    data,
    members: data.members,
    bills: data.bills,
    addBill,
    updateBill,
    deleteBill,
    togglePaid,
    copyBills,
    deleteExamples,
    renameMember,
    replaceAllData,
  }
}
