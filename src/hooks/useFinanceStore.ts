import { useEffect, useState } from 'react'
import { DEFAULT_MEMBERS, createInitialData } from '../data/sampleData'
import type { Area, AreaType, Bill, FinanceData, Member, MonthKey } from '../types'
import { HOME_AREA_ID, createArea, getHomeArea, migrateV1ToV2 } from '../utils/areas'
import { parseStoredData } from '../utils/backup'
import { getToday } from '../utils/dates'
import { createId } from '../utils/ids'

/**
 * Chave mantida desde a primeira versão para não mover dados existentes.
 * O "v1" do nome é histórico: o formato real é indicado pelo campo `version`
 * do conteúdo (1 = antes das áreas, 2 = com áreas) e lido por parseStoredData.
 */
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
  return migrateV1ToV2({ version: 1, members: DEFAULT_MEMBERS, bills: [] })
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

  /** Aplica uma alteração somente na área indicada; as outras áreas não mudam. */
  function updateArea(areaId: string, change: (area: Area) => Area) {
    setData((current) => ({
      ...current,
      areas: current.areas.map((area) => (area.id === areaId ? change(area) : area)),
    }))
  }

  function updateHome(change: (home: Area) => Area) {
    updateArea(HOME_AREA_ID, change)
  }

  /** Contas de áreas individuais nunca têm divisão entre pessoas. */
  function sharesFor(area: Area, input: BillInput) {
    return area.type === 'individual' ? [] : input.shares
  }

  function addBill(areaId: string, input: BillInput) {
    updateArea(areaId, (area) => ({
      ...area,
      bills: [...area.bills, { ...input, shares: sharesFor(area, input), id: createId() }],
    }))
  }

  function updateBill(areaId: string, id: string, input: BillInput) {
    updateArea(areaId, (area) => ({
      ...area,
      bills: area.bills.map((bill) =>
        // Depois de editada, a conta deixa de ser considerada exemplo.
        bill.id === id ? { ...input, shares: sharesFor(area, input), id, isExample: false } : bill,
      ),
    }))
  }

  function deleteBill(areaId: string, id: string) {
    updateArea(areaId, (area) => ({ ...area, bills: area.bills.filter((bill) => bill.id !== id) }))
  }

  function togglePaid(areaId: string, id: string) {
    updateArea(areaId, (area) => ({
      ...area,
      bills: area.bills.map((bill) => (bill.id === id ? { ...bill, paid: !bill.paid } : bill)),
    }))
  }

  function copyBills(areaId: string, fromMonth: MonthKey, toMonth: MonthKey) {
    updateArea(areaId, (area) => {
      const copies = area.bills
        .filter((bill) => bill.month === fromMonth)
        .map((bill) => ({
          ...bill,
          id: createId(),
          month: toMonth,
          paid: false,
        }))
      return { ...area, bills: [...area.bills, ...copies] }
    })
  }

  function deleteExamples() {
    updateHome((home) => ({ ...home, bills: home.bills.filter((bill) => !bill.isExample) }))
  }

  /** Atualiza o perfil exibido (nome e cor). O id e as contas não mudam. */
  function updateMember(id: string, changes: Pick<Member, 'name' | 'color'>) {
    updateHome((home) => ({
      ...home,
      members: home.members.map((member) =>
        member.id === id ? { ...member, name: changes.name, color: changes.color } : member,
      ),
    }))
  }

  function addMember(member: Member) {
    updateHome((home) => ({ ...home, members: [...home.members, member] }))
  }

  /** Exclui um membro somente se ele não participa de nenhuma conta e não é o último. */
  function deleteMember(id: string) {
    updateHome((home) => {
      const hasShares = home.bills.some((bill) =>
        bill.shares.some((share) => share.memberId === id),
      )
      if (hasShares || home.members.length <= 1) return home
      return { ...home, members: home.members.filter((member) => member.id !== id) }
    })
  }

  /** Cria uma área vazia. O nome já deve ter sido validado (validateAreaName). */
  function addArea(name: string, type: AreaType) {
    setData((current) => ({
      ...current,
      areas: [...current.areas, createArea(name, type, current.areas)],
    }))
  }

  /** Substitui todos os dados de uma vez (usado ao restaurar um backup já validado). */
  function replaceAllData(next: FinanceData) {
    setData(next)
  }

  const home = getHomeArea(data)

  return {
    data,
    storageIssue: initial.issue,
    areas: data.areas,
    /** Membros e contas da área "Gastos da casa", usados pela interface atual. */
    members: home.members,
    bills: home.bills,
    addBill,
    updateBill,
    deleteBill,
    togglePaid,
    copyBills,
    deleteExamples,
    updateMember,
    addMember,
    deleteMember,
    addArea,
    replaceAllData,
  }
}
