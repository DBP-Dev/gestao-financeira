import { useEffect, useState } from 'react'
import { DEFAULT_MEMBERS, createInitialData } from '../data/sampleData'
import type { Area, Bill, FinanceData, Member, MonthKey, Today } from '../types'
import {
  HOME_AREA_ID,
  createArea,
  getHomeArea,
  migrateV1ToV3,
  removeArea,
} from '../utils/areas'
import { MAX_BILLS, MAX_MEMBERS, parseStoredData } from '../utils/backup'
import {
  addCommonBill,
  copyCommonBills,
  planCopyBills,
  type CopyConfirmation,
} from '../utils/commonBills'
import { isMemberInSeries } from '../utils/members'
import type { SaveState } from '../utils/saveFeedback'
import {
  createGuardedWriter,
  getLockManager,
  isBlockedStatus,
  type GuardedWriter,
  type PersistenceStatus,
} from '../utils/storageSync'
import {
  applyEndSeries,
  applyInstallmentCount,
  applyMemberDeactivation,
  planMemberDeactivation,
  type PayerChoices,
  applySeriesEdit,
  planInstallmentCount,
  createSeries,
  planEndSeries,
  planSeriesEdit,
  type PendingAfterEndChoice,
  type OverriddenChoice,
  type SeriesEditInput,
  deleteOccurrence as deleteSeriesOccurrence,
  editOccurrence as editSeriesOccurrence,
  materializeDue,
  payProjectedOccurrence,
  stillPending,
  totalBills,
  type MaterializeResult,
  type NewSeriesInput,
  type OccurrenceInput,
  type PendingOccurrence,
  type SeriesChangeResult,
} from '../utils/series'

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
  /** Texto lido da chave principal na abertura (null: chave inexistente ou ilegível). */
  raw: string | null
  /** Se é permitido gravar na chave principal. */
  canSave: boolean
  /**
   * Gravar logo de início: no primeiro uso (exemplos) ou quando a abertura gravou
   * ocorrências de contas recorrentes e parceladas que chegaram ao mês atual.
   */
  saveOnStart: boolean
  issue: StorageIssue | null
  /**
   * A gravação automática ultrapassaria o limite de contas e não gravou nada: as
   * ocorrências que ficaram pendentes. null quando não há aviso de limite.
   */
  pending: PendingOccurrence[] | null
}

/** Pendentes do resultado da gravação automática (null quando o limite não impediu). */
function pendingOf(result: MaterializeResult): PendingOccurrence[] | null {
  return result.limitExceeded ? (result.pending ?? []) : null
}

/**
 * Reavaliação do aviso de limite depois de uma ação da pessoa:
 * - 'resolved': uma prevista foi gravada (paga ou editada). Só reconta as pendentes;
 *   não libera espaço, então não tenta gravar.
 * - 'deleted': uma exclusão liberou espaço. Tenta gravar só se as pendentes couberem.
 * - 'full': exclusão de área (contas e séries juntas). Tenta gravar sem pré-checagem.
 */
type Recheck = 'resolved' | 'deleted' | 'full'
const RECHECK_ORDER: Recheck[] = ['resolved', 'deleted', 'full']

function strongerRecheck(current: Recheck | null, next: Recheck): Recheck {
  if (current === null) return next
  return RECHECK_ORDER.indexOf(next) > RECHECK_ORDER.indexOf(current) ? next : current
}

function createEmptyData(): FinanceData {
  return migrateV1ToV3({ version: 1, members: DEFAULT_MEMBERS, bills: [] })
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

function loadInitial(today: Today): InitialLoad {
  let saved: string | null
  try {
    saved = localStorage.getItem(STORAGE_KEY)
  } catch {
    return {
      data: createEmptyData(),
      raw: null,
      canSave: false,
      saveOnStart: false,
      issue: { kind: 'unavailable' },
      pending: null,
    }
  }

  // Chave inexistente: primeiro uso, começa com os exemplos.
  if (saved === null) {
    return {
      data: createInitialData(today.month),
      raw: null,
      canSave: true,
      saveOnStart: true,
      issue: null,
      pending: null,
    }
  }

  const result = parseStoredData(saved)
  if (result.ok) {
    // Só depois de uma leitura normal e válida: grava as ocorrências que chegaram ao
    // mês atual. Sem nada a gravar, os dados ficam os mesmos e nada é regravado.
    const materialized = materializeDue(result.data, today)
    return {
      data: materialized.data,
      raw: saved,
      canSave: true,
      saveOnStart: materialized.created > 0,
      issue: null,
      pending: pendingOf(materialized),
    }
  }

  // Chave existente com conteúdo inválido: só libera gravações depois de preservar o original.
  // Nesse caminho a gravação automática nunca roda.
  const recoveryKey = preserveOriginal(saved)
  if (recoveryKey) {
    return {
      data: createEmptyData(),
      // A primeira gravação confere com o original ilegível (a cópia já está guardada).
      raw: saved,
      canSave: true,
      saveOnStart: false,
      issue: { kind: 'recovered', reason: result.error, recoveryKey, original: saved },
      pending: null,
    }
  }
  return {
    data: createEmptyData(),
    raw: saved,
    canSave: false,
    saveOnStart: false,
    issue: { kind: 'not-preserved', reason: result.error, original: saved },
    pending: null,
  }
}

export type BillInput = Omit<Bill, 'id' | 'isExample'>

/**
 * Guarda integrantes e contas, salvando tudo no navegador automaticamente.
 * `today` vem do `useToday` do App: na virada do mês, as ocorrências de contas
 * recorrentes e parceladas que chegaram ao novo mês são gravadas.
 */
export function useFinanceStore(today: Today) {
  const [initial] = useState(() => loadInitial(today))
  const [data, setData] = useState<FinanceData>(initial.data)
  // Com o aviso de limite ativo: as ocorrências que a gravação automática não pôde criar.
  const [pending, setPending] = useState(initial.pending)
  const [recheck, setRecheck] = useState<Recheck | null>(null)

  // Gravação protegida (storageSync): só grava se a chave ainda tiver o texto que esta aba
  // leu ou gravou por último, dentro de uma trava compartilhada entre as abas.
  const [persistence, setPersistence] = useState<PersistenceStatus>(() =>
    initial.canSave && getLockManager() === null ? 'unsupported' : 'saved',
  )
  const [writer] = useState<GuardedWriter | null>(() =>
    initial.canSave
      ? createGuardedWriter({
          storage: localStorage,
          key: STORAGE_KEY,
          locks: getLockManager(),
          initialRaw: initial.raw,
          onStatus: setPersistence,
        })
      : null,
  )
  const writesBlocked = isBlockedStatus(persistence)

  // Gravação automática só com dados lidos normalmente (nunca em recuperação ou sem acesso)
  // e enquanto esta aba puder gravar (sem conflito com outra aba).
  const canMaterialize = initial.canSave && initial.issue === null && !writesBlocked

  /** Aplica o resultado de uma tentativa de gravação automática (tudo ou nada). */
  function applyMaterialized(materialized: MaterializeResult) {
    if (materialized.data !== data) setData(materialized.data)
    setPending(pendingOf(materialized))
  }

  // Virada do mês com o app aberto: roda uma vez por mês, durante a renderização, como o
  // App já faz para acompanhar o mês. Sem nada a gravar, os dados não mudam.
  const [materializedMonth, setMaterializedMonth] = useState(today.month)
  if (today.month !== materializedMonth) {
    setMaterializedMonth(today.month)
    // A avaliação completa do novo mês substitui qualquer reavaliação pedida.
    if (recheck !== null) setRecheck(null)
    if (canMaterialize) applyMaterialized(materializeDue(data, today))
  } else if (recheck !== null) {
    // Reavaliação do aviso de limite, pedida por uma ação da pessoa. Roda durante a
    // renderização, antes de salvar: a ação e as ocorrências criadas são gravadas juntas,
    // numa única gravação. Só é pedida com o aviso ativo e leitura normal dos dados.
    setRecheck(null)
    if (pending !== null && canMaterialize) {
      const remaining = stillPending(data, pending)
      if (remaining.length === 0) {
        // As pendentes conhecidas foram gravadas ou excluídas pela pessoa. Antes de retirar o
        // aviso, confirma com a avaliação completa: sem nada a criar, os dados ficam os
        // mesmos (nenhuma gravação) e o aviso some; se surgir outra pendente, ela é
        // gravada ou passa a ser a nova lista, sempre tudo ou nada.
        applyMaterialized(materializeDue(data, today))
      } else if (
        recheck === 'full' ||
        (recheck === 'deleted' && totalBills(data) + remaining.length <= MAX_BILLS)
      ) {
        applyMaterialized(materializeDue(data, today))
      } else if (remaining.length !== pending.length) {
        setPending(remaining)
      }
    }
  }

  /** Pede a reavaliação do aviso de limite (só faz sentido com o aviso ativo). */
  function requestRecheck(kind: Recheck) {
    if (pending === null || !canMaterialize) return
    setRecheck((current) => strongerRecheck(current, kind))
  }

  useEffect(() => {
    if (!writer) return
    // O estado inicial só é gravado no primeiro uso ou quando a abertura criou ocorrências;
    // depois, a cada mudança dos dados (ações da pessoa, virada do mês, reavaliação do
    // limite, restauração). Toda gravação é protegida: com conflito ou falha de leitura,
    // nada é gravado e a aba para de gravar.
    if (data === initial.data && !initial.saveOnStart) return
    // O próprio objeto dos dados identifica o pedido: saveStateOf diz se ele foi gravado.
    writer.save(() => JSON.stringify(data), data)
  }, [data, initial, writer])

  /**
   * Situação da gravação de um estado dos dados (o objeto `data` depois de uma ação):
   * 'saved' só depois da confirmação; 'failed' se esta aba não pode gravar ou a última
   * gravação falhou; 'saving' enquanto o pedido espera.
   */
  function saveStateOf(target: FinanceData): SaveState {
    if (!writer) return 'failed'
    if (target === initial.data && !initial.saveOnStart) return 'saved'
    if (writer.isSaved(target)) return 'saved'
    return writesBlocked || persistence === 'write-failed' ? 'failed' : 'saving'
  }

  // Outra aba gravou a chave: se o texto não é o que esta aba conhece, para de gravar já.
  // É só um aviso antecipado; a proteção real é a conferência dentro da trava.
  useEffect(() => {
    if (!writer) return
    function handleStorage(event: StorageEvent) {
      if (event.key !== null && event.key !== STORAGE_KEY) return
      if (event.key !== null) {
        writer?.notifyExternalChange(event.newValue)
        return
      }
      // key null: o armazenamento foi limpo; relê para comparar.
      let value: string | null | undefined
      try {
        value = localStorage.getItem(STORAGE_KEY)
      } catch {
        value = undefined
      }
      writer?.notifyExternalChange(value)
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [writer])

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

  /**
   * Acrescenta uma conta comum. Devolve a mensagem de erro (ex.: limite de contas
   * atingido, nada é gravado) ou null quando a conta foi adicionada.
   */
  function addBill(areaId: string, input: BillInput): string | null {
    const result = addCommonBill(data, areaId, input)
    if (!result.ok) return result.error
    setData(result.data)
    return null
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
    requestRecheck('deleted')
  }

  function togglePaid(areaId: string, id: string) {
    updateArea(areaId, (area) => ({
      ...area,
      bills: area.bills.map((bill) => (bill.id === id ? { ...bill, paid: !bill.paid } : bill)),
    }))
  }

  /** Resumo da cópia das contas comuns de um mês para a confirmação. Não altera os dados. */
  function planCopyBillsFrom(areaId: string, fromMonth: MonthKey) {
    return planCopyBills(data, areaId, fromMonth)
  }

  /**
   * Copia só contas comuns: as de séries são geradas pela própria série. Revalida com os
   * dados atuais o que foi aceito (`confirmation`; sem ela, nenhum ajuste de divisão).
   * Tudo ou nada: devolve a mensagem de erro (limite, área sem ativos, pagador, divisão
   * que mudou), sem gravar nada, ou null quando copiou numa única alteração.
   */
  function copyBills(
    areaId: string,
    fromMonth: MonthKey,
    toMonth: MonthKey,
    confirmation?: CopyConfirmation,
  ): string | null {
    const result = copyCommonBills(data, areaId, fromMonth, toMonth, undefined, confirmation)
    if (!result.ok) return result.error
    if (result.data !== data) setData(result.data)
    return null
  }

  function deleteExamples() {
    updateHome((home) => ({ ...home, bills: home.bills.filter((bill) => !bill.isExample) }))
    requestRecheck('deleted')
  }

  /** Atualiza o perfil exibido (nome e cor) na área indicada. O id e as contas não mudam. */
  function updateMember(areaId: string, id: string, changes: Pick<Member, 'name' | 'color'>) {
    updateArea(areaId, (area) => ({
      ...area,
      members: area.members.map((member) =>
        member.id === id ? { ...member, name: changes.name, color: changes.color } : member,
      ),
    }))
  }

  /**
   * Adiciona um membro à área indicada. Áreas individuais não têm membros, e uma área
   * com MAX_MEMBERS não recebe mais ninguém (os dados salvos deixariam de ser válidos).
   */
  function addMember(areaId: string, member: Member) {
    updateArea(areaId, (area) =>
      area.type === 'individual' || area.members.length >= MAX_MEMBERS
        ? area
        : { ...area, members: [...area.members, member] },
    )
  }

  /**
   * Exclui um membro da área somente se ele não participa de nenhuma conta dela (inclusive
   * recorrentes e parceladas) e não é o último.
   */
  function deleteMember(areaId: string, id: string) {
    updateArea(areaId, (area) => {
      const hasShares = area.bills.some((bill) =>
        bill.shares.some((share) => share.memberId === id),
      )
      if (hasShares || isMemberInSeries(id, area.series) || area.members.length <= 1) return area
      return { ...area, members: area.members.filter((member) => member.id !== id) }
    })
  }

  /**
   * Cria uma área compartilhada vazia. O nome já deve ter sido validado (validateAreaName).
   * Áreas individuais não são criadas: a única é a fixa "Minhas contas".
   */
  function addArea(name: string) {
    setData((current) => ({
      ...current,
      areas: [...current.areas, createArea(name, 'shared', current.areas)],
    }))
  }

  /** Exclui uma área e todos os seus dados. "Gastos da casa" nunca é excluída. */
  function deleteArea(areaId: string) {
    setData((current) => removeArea(current, areaId))
    requestRecheck('full')
  }

  /**
   * Cria uma conta recorrente ou parcelada e grava a primeira ocorrência.
   * Devolve o erro para o formulário quando a criação não é possível.
   */
  function addSeries(areaId: string, input: NewSeriesInput): SeriesChangeResult {
    const result = createSeries(data, areaId, input, today)
    if (result.ok) setData(result.data)
    return result
  }

  /**
   * Aplica o resultado de uma ação sobre uma ocorrência de série. Com o aviso de limite
   * ativo, pede a reavaliação indicada. Devolve o resultado para a tela mostrar o erro.
   */
  function applyOccurrenceChange(result: SeriesChangeResult, kind: Recheck): SeriesChangeResult {
    if (result.ok && result.data !== data) {
      setData(result.data)
      requestRecheck(kind)
    }
    return result
  }

  /** Paga uma prevista: grava a ocorrência do mês já paga. */
  function payProjected(areaId: string, seriesId: string, month: MonthKey): SeriesChangeResult {
    return applyOccurrenceChange(
      payProjectedOccurrence(data, areaId, seriesId, month),
      'resolved',
    )
  }

  /** Exclui uma ocorrência (gravada ou prevista) sem mexer na série. Pagas não são excluídas. */
  function deleteOccurrence(areaId: string, seriesId: string, month: MonthKey): SeriesChangeResult {
    return applyOccurrenceChange(deleteSeriesOccurrence(data, areaId, seriesId, month), 'deleted')
  }

  /** Edita "só esta" ocorrência (gravada ou prevista) sem mexer na série. */
  function editOccurrence(
    areaId: string,
    seriesId: string,
    month: MonthKey,
    input: OccurrenceInput,
  ): SeriesChangeResult {
    return applyOccurrenceChange(
      editSeriesOccurrence(data, areaId, seriesId, month, input),
      'resolved',
    )
  }

  /** Resumo de "esta e as seguintes" para a confirmação. Não altera os dados. */
  function planSeriesEditFrom(
    areaId: string,
    seriesId: string,
    month: MonthKey,
    input: SeriesEditInput,
  ) {
    return planSeriesEdit(data, areaId, seriesId, month, input)
  }

  /**
   * Aplica "esta e as seguintes" depois da confirmação. Revalida tudo com os dados
   * atuais; não cria registros nem muda o período da série, então o aviso de limite
   * não precisa de reavaliação.
   */
  function editSeriesFrom(
    areaId: string,
    seriesId: string,
    month: MonthKey,
    input: SeriesEditInput,
    choice: OverriddenChoice | null,
  ): SeriesChangeResult {
    const result = applySeriesEdit(data, areaId, seriesId, month, input, choice)
    if (result.ok && result.data !== data) setData(result.data)
    return result
  }

  /** Resumo do encerramento para a confirmação. Não altera os dados. */
  function planEndSeriesFrom(areaId: string, seriesId: string, lastMonth: MonthKey) {
    return planEndSeries(data, areaId, seriesId, lastMonth, today)
  }

  /**
   * Encerra uma recorrência depois da confirmação, revalidando com os dados atuais.
   * Pode excluir registros e tirar meses pendentes do período, por isso pede a
   * reavaliação do aviso de limite como as outras exclusões.
   */
  function endSeries(
    areaId: string,
    seriesId: string,
    lastMonth: MonthKey,
    choice: PendingAfterEndChoice | null,
  ): SeriesChangeResult {
    return applyOccurrenceChange(
      applyEndSeries(data, areaId, seriesId, lastMonth, today, choice),
      'deleted',
    )
  }

  /** Resumo da nova quantidade de parcelas para a confirmação. Não altera os dados. */
  function planInstallmentCountFrom(areaId: string, seriesId: string, newCount: number) {
    return planInstallmentCount(data, areaId, seriesId, newCount, today)
  }

  /**
   * Muda a quantidade de parcelas depois da confirmação, revalidando com os dados atuais.
   * Um aumento pode alcançar meses que já passaram, então a avaliação completa da
   * gravação automática roda em seguida (só com leitura normal, tudo ou nada), e a
   * mudança e as parcelas criadas vão juntas numa única gravação. Se o limite de contas
   * impedir, a quantidade muda, nada é criado e o aviso de limite aparece.
   */
  function changeInstallmentCount(
    areaId: string,
    seriesId: string,
    newCount: number,
    /** Quem paga as parcelas novas quando a divisão ficaria sem participante ativo. */
    payer?: string,
  ): SeriesChangeResult {
    const result = applyInstallmentCount(data, areaId, seriesId, newCount, today, payer)
    if (!result.ok || result.data === data) return result
    if (!canMaterialize) {
      setData(result.data)
      return result
    }
    const materialized = materializeDue(result.data, today)
    setData(materialized.data)
    setPending(pendingOf(materialized))
    // A avaliação completa acima substitui qualquer reavaliação pedida antes.
    setRecheck(null)
    return { ok: true, data: materialized.data }
  }

  /** Resumo da desativação de um participante para a confirmação. Não altera os dados. */
  function planDeactivation(areaId: string, memberId: string, protectedMemberId: string | null) {
    return planMemberDeactivation(data, areaId, memberId, today, protectedMemberId)
  }

  /**
   * Desativa um participante depois da confirmação, revalidando tudo com os dados atuais
   * (inclusive quem assume cada série). Uma única gravação. Não cria registros nem muda
   * períodos, então o aviso de limite não precisa de reavaliação.
   */
  function deactivateMember(
    areaId: string,
    memberId: string,
    protectedMemberId: string | null,
    payers: PayerChoices,
  ): SeriesChangeResult {
    const result = applyMemberDeactivation(data, areaId, memberId, today, protectedMemberId, payers)
    if (result.ok && result.data !== data) setData(result.data)
    return result
  }

  /**
   * Substitui todos os dados de uma vez (usado ao restaurar um backup já validado e
   * confirmado). Depois, grava as ocorrências que já chegaram ao mês atual.
   */
  function replaceAllData(next: FinanceData) {
    if (!canMaterialize) {
      setData(next)
      return
    }
    const materialized = materializeDue(next, today)
    setData(materialized.data)
    setPending(pendingOf(materialized))
    // A avaliação completa acima substitui qualquer reavaliação pedida antes.
    setRecheck(null)
  }

  const home = getHomeArea(data)

  return {
    data,
    storageIssue: initial.issue,
    /** A gravação automática não gravou nada porque passaria do limite de contas. */
    materializeLimitExceeded: pending !== null,
    /**
     * Situação da gravação protegida nesta aba. Uma alteração só está gravada com
     * 'saved'; com conflito, falha de leitura ou sem suporte, nada mais é gravado.
     */
    persistenceStatus: persistence,
    saveStateOf,
    areas: data.areas,
    /** Membros e contas da área "Gastos da casa", usados pela interface atual. */
    members: home.members,
    bills: home.bills,
    addBill,
    updateBill,
    deleteBill,
    togglePaid,
    copyBills,
    planCopyBillsFrom,
    deleteExamples,
    updateMember,
    addMember,
    deleteMember,
    addArea,
    deleteArea,
    addSeries,
    payProjected,
    deleteOccurrence,
    editOccurrence,
    planSeriesEditFrom,
    editSeriesFrom,
    planEndSeriesFrom,
    endSeries,
    planInstallmentCountFrom,
    changeInstallmentCount,
    planDeactivation,
    deactivateMember,
    replaceAllData,
  }
}
