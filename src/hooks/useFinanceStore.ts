import { useEffect, useState } from 'react'
import { DEFAULT_MEMBERS, createInitialData } from '../data/sampleData'
import type { Bill, FinanceData, MonthKey } from '../types'
import { parseStoredData } from '../utils/backup'
import { getToday } from '../utils/dates'
import { createId } from '../utils/ids'

const STORAGE_KEY = 'gestao-financeira:dados:v1'
/** Cópias exatas de dados que não puderam ser lidos. Nunca são sobrescritas. */
const RECOVERY_KEY_PREFIX = `${STORAGE_KEY}:recuperacao:`

/** Problema encontrado ao abrir os dados salvos (null quando está tudo certo). */
export type StorageIssue =
  /** Dados ilegíveis, mas uma cópia exata foi guardada e conferida. */
  | { kind: 'recovered'; reason: string; recoveryKey: string; original: string }
  /** Dados ilegíveis e não foi possível guardar a cópia: nada será gravado. */
  | { kind: 'not-preserved'; reason: string; original: string }
  /** O navegador não deixou ler o armazenamento: nada será gravado. */
  | { kind: 'unavailable' }

interface InitialLoad {
  data: FinanceData
  /** Se é permitido gravar na chave principal. */
  canSave: boolean
  /** Primeiro uso: os exemplos devem ser gravados logo de início. */
  saveOnStart: boolean
  issue: StorageIssue | null
}

function createEmptyData(): FinanceData {
  return { version: 1, members: DEFAULT_MEMBERS, bills: [] }
}

/**
 * Guarda uma cópia exata do texto original em uma chave de recuperação.
 * Reaproveita uma cópia idêntica já existente (recarregamentos e StrictMode) e
 * nunca sobrescreve outra cópia. Devolve a chave somente se a gravação foi conferida.
 */
function preserveOriginal(original: string): string | null {
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (key?.startsWith(RECOVERY_KEY_PREFIX) && localStorage.getItem(key) === original) {
        return key
      }
    }

    const baseKey = RECOVERY_KEY_PREFIX + new Date().toISOString()
    let key = baseKey
    for (let suffix = 2; localStorage.getItem(key) !== null; suffix++) {
      key = `${baseKey}-${suffix}`
    }
    localStorage.setItem(key, original)
    return localStorage.getItem(key) === original ? key : null
  } catch {
    return null
  }
}

function loadInitial(): InitialLoad {
  let saved: string | null
  try {
    saved = localStorage.getItem(STORAGE_KEY)
  } catch {
    return {
      data: createEmptyData(),
      canSave: false,
      saveOnStart: false,
      issue: { kind: 'unavailable' },
    }
  }

  // Chave inexistente: primeiro uso, começa com os exemplos.
  if (saved === null) {
    return {
      data: createInitialData(getToday().month),
      canSave: true,
      saveOnStart: true,
      issue: null,
    }
  }

  const result = parseStoredData(saved)
  if (result.ok) {
    return { data: result.data, canSave: true, saveOnStart: false, issue: null }
  }

  // Chave existente com conteúdo inválido: só libera gravações depois de preservar o original.
  const recoveryKey = preserveOriginal(saved)
  if (recoveryKey) {
    return {
      data: createEmptyData(),
      canSave: true,
      saveOnStart: false,
      issue: { kind: 'recovered', reason: result.error, recoveryKey, original: saved },
    }
  }
  return {
    data: createEmptyData(),
    canSave: false,
    saveOnStart: false,
    issue: { kind: 'not-preserved', reason: result.error, original: saved },
  }
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
  const [initial] = useState(loadInitial)
  const [data, setData] = useState<FinanceData>(initial.data)

  useEffect(() => {
    if (!initial.canSave) return
    // O estado inicial só é gravado no primeiro uso; nos outros casos, a chave
    // original só muda depois de uma alteração feita pela pessoa.
    if (data === initial.data && !initial.saveOnStart) return
    saveData(data)
  }, [data, initial])

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
    storageIssue: initial.issue,
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
