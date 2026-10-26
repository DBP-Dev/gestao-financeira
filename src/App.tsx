import { useState } from 'react'
import './App.css'
import { AccountGroup } from './components/AccountGroup'
import { AppHeader } from './components/AppHeader'
import { AreaCard } from './components/AreaCard'
import { AreaFormDialog, type AreaFormValues } from './components/AreaFormDialog'
import { BackupDialog } from './components/BackupDialog'
import { BillFormDialog, type EditScope, type SeriesChoice } from './components/BillFormDialog'
import { BillList } from './components/BillList'
import { ConfirmDialog } from './components/ConfirmDialog'
import { EndSeriesDialog } from './components/EndSeriesDialog'
import { InstallmentCountDialog } from './components/InstallmentCountDialog'
import { CopyBillsDialog } from './components/CopyBillsDialog'
import { NoticeDialog } from './components/NoticeDialog'
import { SeriesEditConfirmDialog } from './components/SeriesEditConfirmDialog'
import { FamilyArea } from './components/FamilyArea'
import { FamilyMembers } from './components/FamilyMembers'
import { IndividualSummary } from './components/IndividualSummary'
import { MonthSummary } from './components/MonthSummary'
import { PersonalPanel } from './components/PersonalPanel'
import { DeleteMemberDialog } from './components/DeleteMemberDialog'
import { MemberFormDialog, type MemberFormValues } from './components/MemberFormDialog'
import { PersistenceWarning } from './components/PersistenceWarning'
import { StorageWarning } from './components/StorageWarning'
import { useAreaSelf } from './hooks/useAreaSelf'
import { useCurrentMember } from './hooks/useCurrentMember'
import { useFinanceStore, type BillInput } from './hooks/useFinanceStore'
import { useToday } from './hooks/useToday'
import type { Area, Bill, FinanceData, Member } from './types'
import {
  HOME_AREA_ID,
  MAX_AREAS,
  MY_ACCOUNTS_AREA_ID,
  canDeleteArea,
  getHomeArea,
} from './utils/areas'
import { getBillsTotals } from './utils/billTotals'
import { getDueAlerts } from './utils/dueAlerts'
import { getMemberShareTotals, getPersonalMonthSummary } from './utils/personal'
import {
  PAID_OCCURRENCE_DELETE_MESSAGE,
  billsForMonth,
  endMonthOptions,
  isProjectedBill,
  isValidMonth,
  minInstallmentCount,
  seriesDataAt,
  seriesEditStartMonth,
  seriesLabelFor,
  type SeriesEditInput,
  type SeriesEditPlan,
} from './utils/series'
import { confirmationFor, type CopyBillsPlan } from './utils/commonBills'
import type { BillData, SeriesEditBase } from './utils/billForm'
import {
  feedbackClassName,
  saveFeedback,
  type SaveFeedback,
  type SaveState,
} from './utils/saveFeedback'
import {
  addMonths,
  effectiveDueDay,
  formatMonthLabel,
  formatMonthName,
  getBillStatus,
  isDueSoon,
} from './utils/dates'
import { MAX_MEMBERS, createMember, getMemberRemoval } from './utils/members'

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/** Toda conta pertence a uma área: o formulário e a exclusão sabem qual é. */
type BillFormState =
  | { mode: 'new'; areaId: string }
  | { mode: 'edit'; areaId: string; bill: Bill }
  | null
/**
 * Mensagem de uma ação que altera os dados. `data` é o estado que a ação produziu (ligado
 * na renderização seguinte); a mensagem só diz "salva" depois que ele foi gravado.
 */
interface ActionFeedback {
  /** O que foi feito, sem ponto final (ex.: "Membro adicionado"). */
  text: string
  data?: FinanceData
}

/** Todo membro pertence a uma área compartilhada: o formulário e a exclusão sabem qual é. */
type MemberFormState =
  | { mode: 'new'; areaId: string }
  | { mode: 'edit'; areaId: string; member: Member }
  | null

function App() {
  const today = useToday()
  const store = useFinanceStore(today)
  const [month, setMonth] = useState(today.month)
  const [lastTodayMonth, setLastTodayMonth] = useState(today.month)

  // Na virada do mês, quem estava vendo o mês atual passa para o novo mês atual.
  if (today.month !== lastTodayMonth) {
    setLastTodayMonth(today.month)
    if (month === lastTodayMonth) setMonth(today.month)
  }
  const [billForm, setBillForm] = useState<BillFormState>(null)
  const [billToDelete, setBillToDelete] = useState<{ areaId: string; bill: Bill } | null>(null)
  /**
   * Confirmação de "esta e as seguintes", aberta por cima do formulário. Cancelar volta
   * ao formulário sem alterar nada; o resumo só é exibido, a aplicação revalida tudo.
   */
  const [seriesEditConfirm, setSeriesEditConfirm] = useState<{
    areaId: string
    seriesId: string
    month: string
    billName: string
    input: SeriesEditInput
    plan: SeriesEditPlan
    /** Base escolhida no formulário e os dados da conta selecionada, para a origem. */
    base: SeriesEditBase
    accountData: BillData
  } | null>(null)
  /** Encerramento de uma recorrência, aberto por cima do formulário de edição. */
  const [endSeriesFor, setEndSeriesFor] = useState<{
    areaId: string
    seriesId: string
    billName: string
    month: string
  } | null>(null)
  /** Mudança da quantidade de parcelas, aberta por cima do formulário de edição. */
  const [installmentsFor, setInstallmentsFor] = useState<{
    areaId: string
    seriesId: string
    billName: string
  } | null>(null)
  /** Cópia do mês anterior com divisões a ajustar (participantes desativados). */
  const [copyFor, setCopyFor] = useState<{
    areaId: string
    fromMonth: string
    toMonth: string
    plan: CopyBillsPlan
  } | null>(null)
  /** Explicação de uma ação que não foi feita (ex.: excluir uma ocorrência paga). */
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null)
  const [areaToDelete, setAreaToDelete] = useState<Area | null>(null)
  /** Área compartilhada sem participantes em que a pessoa tentou adicionar uma conta. */
  const [noParticipantsAreaId, setNoParticipantsAreaId] = useState<string | null>(null)
  const [memberForm, setMemberForm] = useState<MemberFormState>(null)
  const [memberToDelete, setMemberToDelete] = useState<{ areaId: string; member: Member } | null>(
    null,
  )
  const [memberFeedback, setMemberFeedback] = useState<
    ({ areaId: string } & ActionFeedback) | null
  >(null)
  const currentMember = useCurrentMember(store.members)
  // "Eu" nas áreas compartilhadas criadas (escolha deste aparelho, fora do backup).
  const areaSelf = useAreaSelf(store.areas, store.storageIssue === null)

  /**
   * "Minha parte" de uma área compartilhada: soma das parcelas registradas do usuário nas
   * contas do mês (pagas e pendentes). null quando não se sabe quem é ele na área.
   * "Gastos da casa" usa o perfil do painel pessoal; as outras áreas, o "Sou eu" delas.
   */
  function getMyShareCents(areaId: string, monthAreaBills: Bill[]): number | null {
    const selfId =
      areaId === HOME_AREA_ID ? (currentMember.member?.id ?? null) : areaSelf.getSelfId(areaId)
    if (selfId === null) return null
    return getMemberShareTotals(selfId, monthAreaBills).totalCents
  }
  const [confirmClearExamples, setConfirmClearExamples] = useState(false)
  const [showBackup, setShowBackup] = useState(false)
  const [showAreaForm, setShowAreaForm] = useState(false)
  /** Mensagem da última criação ou exclusão de área (só há áreas compartilhadas novas). */
  const [areaFeedback, setAreaFeedback] = useState<ActionFeedback | null>(null)
  /** Resultado da restauração de backup: só é anunciada como salva depois da confirmação. */
  const [restoreFeedback, setRestoreFeedback] = useState<{ data?: FinanceData } | null>(null)

  // Liga cada mensagem ao estado dos dados que a ação produziu: a ação e a mensagem são
  // aplicadas juntas, então os dados desta renderização já são os de depois da ação.
  if (memberFeedback && !memberFeedback.data) {
    setMemberFeedback({ ...memberFeedback, data: store.data })
  }
  if (areaFeedback && !areaFeedback.data) setAreaFeedback({ ...areaFeedback, data: store.data })
  if (restoreFeedback && !restoreFeedback.data) setRestoreFeedback({ data: store.data })

  /** Situação da gravação do estado ligado à mensagem. */
  function saveStateFor(target: FinanceData | undefined): SaveState {
    return target ? store.saveStateOf(target) : 'saving'
  }

  /** Mensagem da ação: "salva" só depois que a gravação protegida confirmou. */
  function feedbackOf(item: ActionFeedback): SaveFeedback {
    return saveFeedback(item.text, saveStateFor(item.data))
  }

  const memberFormArea = memberForm
    ? store.areas.find((area) => area.id === memberForm.areaId)
    : null
  const memberToDeleteArea = memberToDelete
    ? store.areas.find((area) => area.id === memberToDelete.areaId)
    : null
  // O painel pessoal usa só os membros de "Gastos da casa": esse perfil fica protegido.
  const protectedMemberId =
    memberToDelete?.areaId === HOME_AREA_ID ? (currentMember.member?.id ?? null) : null
  // Excluir (sem histórico), desativar (com histórico ou séries) ou bloquear.
  const memberRemoval =
    memberToDelete && memberToDeleteArea
      ? getMemberRemoval(
          memberToDeleteArea.members.find((member) => member.id === memberToDelete.member.id) ??
            memberToDelete.member,
          memberToDeleteArea.members,
          memberToDeleteArea.bills,
          memberToDeleteArea.series,
          protectedMemberId,
          memberToDeleteArea.id === HOME_AREA_ID,
        )
      : null

  // Cada box mostra só as áreas do seu tipo; "Gastos da casa" é exibida pelo FamilyArea.
  // A única área individual é "Minhas contas" (o validador recusa outras).
  const individualAreas = store.areas.filter((area) => area.type === 'individual')
  const otherSharedAreas = store.areas.filter(
    (area) => area.type === 'shared' && area.id !== HOME_AREA_ID,
  )
  const canAddArea = store.areas.length < MAX_AREAS

  /**
   * Contas do mês selecionado na área: as gravadas e as previstas das séries.
   * O mês sempre vem do seletor do app; por segurança, um mês inválido não gera previsões.
   */
  function monthBillsOf(area: Area): Bill[] {
    return isValidMonth(month)
      ? billsForMonth(area, month)
      : area.bills.filter((bill) => bill.month === month)
  }

  // Resumo do mês das contas individuais (inclui as previstas).
  const individualMonthTotals = getBillsTotals(individualAreas.flatMap(monthBillsOf))

  // Painel pessoal (só com perfil): sua parte em todas as áreas do mês e o total geral.
  // "Gastos da casa" usa o perfil; as outras compartilhadas, o "Sou eu" delas.
  const personalSelfId = (area: Area) =>
    area.id === HOME_AREA_ID ? (currentMember.member?.id ?? null) : areaSelf.getSelfId(area.id)
  const personalSummary = currentMember.member
    ? getPersonalMonthSummary(
        store.areas.map((area) => ({ area, bills: monthBillsOf(area) })),
        personalSelfId,
      )
    : null
  // Alertas do painel: as mesmas contas de "Sua parte", pela data de hoje (não pelo mês
  // selecionado). Só com perfil, como o resumo.
  const personalAlerts = currentMember.member
    ? getDueAlerts(store.areas, today, personalSelfId)
    : null

  function handleCreateArea({ name }: AreaFormValues) {
    store.addArea(name)
    setAreaFeedback({ text: `Área “${name}” criada` })
    setShowAreaForm(false)
  }

  /**
   * Contas atrasadas de meses anteriores ao mês de referência (nunca entram nos totais do
   * mês). Padrão: o mês selecionado. "Minhas contas" usa o mês atual real.
   */
  function getOverdueBills(bills: Bill[], referenceMonth = month) {
    return bills
      .filter((bill) => bill.month < referenceMonth && getBillStatus(bill, today) === 'late')
      .sort(
        (a, b) =>
          a.month.localeCompare(b.month) || effectiveDueDay(a) - effectiveDueDay(b),
      )
  }

  const homeArea = getHomeArea(store.data)
  // Totais, listas, cartões e painel pessoal incluem as previstas; notificações e alertas
  // de atraso continuam usando só as contas gravadas (store.bills).
  const monthBills = monthBillsOf(homeArea)
  const overdueBills = getOverdueBills(store.bills)
  const previousMonth = addMonths(month, -1)

  /** O mês anterior tem contas comuns para copiar (as de séries não são copiadas). */
  function hasCommonBillsIn(area: Area, targetMonth: string): boolean {
    return area.bills.some((bill) => bill.month === targetMonth && bill.seriesId === undefined)
  }
  const hasExamples = store.bills.some((bill) => bill.isExample)

  function handleSaveMember({ name, color }: MemberFormValues) {
    if (!memberForm || !memberFormArea) return
    const { areaId } = memberForm
    if (memberForm.mode === 'edit') {
      const { member } = memberForm
      const nameChanged = name !== member.name
      const colorChanged = color !== member.color
      if (nameChanged || colorChanged) {
        store.updateMember(areaId, member.id, { name, color })
        setMemberFeedback({
          areaId,
          text:
            nameChanged && colorChanged
              ? 'Membro atualizado'
              : nameChanged
                ? 'Nome atualizado'
                : 'Cor atualizada',
        })
      }
    } else {
      store.addMember(areaId, createMember(name, memberFormArea.members, color))
      setMemberFeedback({ areaId, text: 'Membro adicionado' })
    }
    setMemberForm(null)
  }

  /** Seção de membros de uma área compartilhada, com ações só sobre os membros dela. */
  function renderMembers(area: Area, title?: string) {
    return (
      <FamilyMembers
        title={title}
        members={area.members}
        bills={monthBillsOf(area)}
        feedback={memberFeedback?.areaId === area.id ? feedbackOf(memberFeedback) : null}
        canAdd={area.members.length < MAX_MEMBERS}
        onAdd={() => setMemberForm({ mode: 'new', areaId: area.id })}
        onEdit={(member) => setMemberForm({ mode: 'edit', areaId: area.id, member })}
        onDelete={(member) => setMemberToDelete({ areaId: area.id, member })}
        selfMemberId={areaSelf.getSelfId(area.id)}
        onToggleSelf={(member) =>
          areaSelf.chooseSelf(
            area.id,
            areaSelf.getSelfId(area.id) === member.id ? null : member.id,
          )
        }
      />
    )
  }

  /** Devolve uma mensagem de erro (o formulário continua aberto) ou null quando salvou. */
  function handleSaveBill(
    input: BillInput,
    series: SeriesChoice | null,
    scope: EditScope,
    base: SeriesEditBase,
  ): string | null {
    if (!billForm) return null
    if (billForm.mode === 'edit' && billForm.bill.seriesId !== undefined && scope === 'series') {
      // "Esta e as seguintes": calcula o resumo e pede confirmação. Nada é gravado aqui.
      const seriesInput: SeriesEditInput = {
        name: input.name,
        totalCents: input.totalCents,
        dueDay: input.dueDay,
        shares: input.shares,
      }
      const planned = store.planSeriesEditFrom(
        billForm.areaId,
        billForm.bill.seriesId,
        billForm.bill.month,
        seriesInput,
      )
      if (!planned.ok) return planned.error
      if (!planned.plan.hasChanges) {
        setBillForm(null)
        return null
      }
      setSeriesEditConfirm({
        areaId: billForm.areaId,
        seriesId: billForm.bill.seriesId,
        month: billForm.bill.month,
        billName: billForm.bill.name,
        input: seriesInput,
        plan: planned.plan,
        base,
        accountData: {
          name: billForm.bill.name,
          totalCents: billForm.bill.totalCents,
          dueDay: billForm.bill.dueDay,
          shares: billForm.bill.shares,
        },
      })
      return null
    }
    if (billForm.mode === 'edit' && billForm.bill.seriesId !== undefined) {
      // Ocorrência de série: "só esta", sem mexer na série. Mês, série e parcela ficam fixos.
      const result = store.editOccurrence(
        billForm.areaId,
        billForm.bill.seriesId,
        billForm.bill.month,
        {
          name: input.name,
          totalCents: input.totalCents,
          dueDay: input.dueDay,
          shares: input.shares,
          paid: input.paid,
        },
      )
      if (!result.ok) return result.error
    } else if (billForm.mode === 'edit') {
      store.updateBill(billForm.areaId, billForm.bill.id, input)
    } else if (series) {
      const result = store.addSeries(billForm.areaId, {
        kind: series.kind,
        installmentCount: series.installmentCount,
        startMonth: input.month,
        name: input.name,
        totalCents: input.totalCents,
        dueDay: input.dueDay,
        shares: input.shares,
        firstPaid: input.paid,
      })
      if (!result.ok) return result.error
    } else {
      const error = store.addBill(billForm.areaId, input)
      if (error) return error
    }
    setBillForm(null)
    return null
  }

  /**
   * Copia as contas comuns do mês anterior, tudo ou nada. Sem divisão a ajustar, copia
   * direto; com participante desativado em alguma divisão, pede a confirmação antes.
   */
  function handleCopyPreviousMonth(areaId: string) {
    const planned = store.planCopyBillsFrom(areaId, previousMonth)
    const error = !planned.ok
      ? planned.error
      : planned.plan.adjusted.length === 0
        ? store.copyBills(areaId, previousMonth, month)
        : null
    if (error) {
      setNotice({ title: 'Não foi possível copiar as contas', message: error })
      return
    }
    if (planned.ok && planned.plan.adjusted.length > 0) {
      setCopyFor({ areaId, fromMonth: previousMonth, toMonth: month, plan: planned.plan })
    }
  }

  /** Prevista: grava a ocorrência já paga. Gravada: alterna entre paga e pendente. */
  function handleTogglePaid(areaId: string, bill: Bill) {
    if (!isProjectedBill(bill)) {
      store.togglePaid(areaId, bill.id)
      return
    }
    const result = store.payProjected(areaId, bill.seriesId, bill.month)
    if (!result.ok) {
      setNotice({ title: `Não foi possível marcar “${bill.name}” como paga`, message: result.error })
    }
  }

  /** Ocorrência paga não é excluída: a pessoa precisa marcá-la como pendente antes. */
  function handleDeleteRequest(areaId: string, bill: Bill) {
    if (bill.seriesId !== undefined && bill.paid) {
      setNotice({
        title: `Não é possível excluir “${bill.name}”`,
        message: PAID_OCCURRENCE_DELETE_MESSAGE,
      })
      return
    }
    setBillToDelete({ areaId, bill })
  }

  function handleConfirmDelete(areaId: string, bill: Bill) {
    setBillToDelete(null)
    if (bill.seriesId === undefined) {
      store.deleteBill(areaId, bill.id)
      return
    }
    const result = store.deleteOccurrence(areaId, bill.seriesId, bill.month)
    if (!result.ok) setNotice({ title: `Não foi possível excluir “${bill.name}”`, message: result.error })
  }

  /** Lista de contas de uma área nova, com as mesmas ações da lista de "Gastos da casa". */
  function renderAreaBills(area: Area) {
    const areaMonthBills = monthBillsOf(area)
    const needsParticipants =
      area.type === 'shared' && !area.members.some((member) => !member.inactive)
    return (
      <BillList
        bills={areaMonthBills}
        series={area.series}
        members={area.members}
        today={today}
        monthName={formatMonthName(month)}
        previousMonthName={formatMonthName(previousMonth)}
        canCopyPreviousMonth={hasCommonBillsIn(area, previousMonth)}
        onAdd={() =>
          needsParticipants
            ? setNoParticipantsAreaId(area.id)
            : setBillForm({ mode: 'new', areaId: area.id })
        }
        onCopyPreviousMonth={() => handleCopyPreviousMonth(area.id)}
        onTogglePaid={(bill) => handleTogglePaid(area.id, bill)}
        onEdit={(bill) => setBillForm({ mode: 'edit', areaId: area.id, bill })}
        onDelete={(bill) => handleDeleteRequest(area.id, bill)}
        actions={
          // Áreas individuais não são excluídas pela interface; "Minhas contas" é fixa.
          area.type === 'shared' &&
          canDeleteArea(area.id) && (
            <button
              type="button"
              className="button button--small button--ghost button--danger-text"
              onClick={() => setAreaToDelete(area)}
              aria-label={`Excluir a área ${area.name}`}
            >
              Excluir área
            </button>
          )
        }
        notice={
          needsParticipants &&
          noParticipantsAreaId === area.id && (
            <p className="backup-message backup-message--error" role="alert">
              {area.members.length === 0
                ? 'Adicione participantes na seção acima para cadastrar contas nesta área compartilhada.'
                : 'É preciso ter pelo menos um participante ativo para cadastrar contas nesta área. Adicione um participante na seção acima.'}
            </p>
          )
        }
      />
    )
  }

  /**
   * Avisos de vencimento do cabeçalho de uma área: vencidas no mês selecionado e contas que
   * vencem nos próximos 3 dias (contando hoje). Só contas não pagas; vencidas não contam como
   * próximas. "Minhas contas" mostra sempre; áreas compartilhadas, só abertas.
   */
  function renderDueNotices(bills: Bill[]) {
    const lateCount = bills.filter(
      (bill) => bill.month === month && getBillStatus(bill, today) === 'late',
    ).length
    const dueSoonCount = bills.filter((bill) => isDueSoon(bill, today)).length
    return (
      <>
        {lateCount > 0 && (
          <span className="area__notice area__notice--late">
            {lateCount === 1 ? 'Você possui uma conta vencida.' : 'Você possui contas vencidas.'}
          </span>
        )}
        {dueSoonCount > 0 && (
          <span className="area__notice">
            {dueSoonCount === 1
              ? 'Você possui uma conta próxima do vencimento.'
              : 'Você possui contas próximas do vencimento.'}
          </span>
        )}
      </>
    )
  }

  /** Área criada pela pessoa: totais, pendências e atrasadas calculados só com as contas dela. */
  function renderAreaCard(area: Area) {
    const isMyAccounts = area.id === MY_ACCOUNTS_AREA_ID
    const areaMonthBills = monthBillsOf(area)
    // "Minhas contas": referência é o mais recente entre o mês atual real e o selecionado.
    // Assim a lista não depende de meses passados selecionados e, num mês futuro, inclui as
    // contas do mês atual que já venceram (getBillStatus continua decidindo o atraso).
    const referenceMonth = isMyAccounts && today.month > month ? today.month : month
    const areaOverdueBills = getOverdueBills(area.bills, referenceMonth)
    return (
      <AreaCard
        key={area.id}
        area={area}
        monthBills={areaMonthBills}
        notices={renderDueNotices(area.bills)}
        noticesWhen={isMyAccounts ? 'always' : 'expanded'}
        myShareCents={area.type === 'shared' ? getMyShareCents(area.id, areaMonthBills) : undefined}
      >
        <MonthSummary
          bills={areaMonthBills}
          overdueBills={areaOverdueBills}
          onMarkPaid={(bill) => store.togglePaid(area.id, bill.id)}
          areaName={area.name}
          overdueTitle={isMyAccounts ? 'Contas em atraso de meses anteriores.' : undefined}
        />
        {area.type === 'shared' && renderMembers(area, 'Participantes')}
        {renderAreaBills(area)}
      </AreaCard>
    )
  }

  const billFormArea = billForm ? store.areas.find((area) => area.id === billForm.areaId) : null
  // Edição "só esta" de uma ocorrência de série (gravada ou prevista).
  const editingOccurrence =
    billForm?.mode === 'edit' && billForm.bill.seriesId !== undefined ? billForm.bill : null
  const editingSeries =
    editingOccurrence && billFormArea
      ? billFormArea.series.find((series) => series.id === editingOccurrence.seriesId)
      : undefined
  const seriesEffectiveMonth =
    editingOccurrence && editingSeries
      ? seriesEditStartMonth(editingSeries, editingOccurrence)
      : null
  // Dados da série no mês de vigência, exatamente como estão (base de "esta e as seguintes").
  const editingSeriesData =
    editingSeries && seriesEffectiveMonth ? seriesDataAt(editingSeries, seriesEffectiveMonth) : null
  const occurrenceInfo =
    editingOccurrence && billFormArea
      ? {
          label: seriesLabelFor(editingOccurrence, billFormArea.series) ?? 'Conta da série',
          projected: isProjectedBill(editingOccurrence),
          installment: editingSeries?.kind === 'installment',
          seriesEffectiveMonth,
          canEnd: editingSeries?.kind === 'recurring' && editingSeries.lastMonth === undefined,
          seriesData: editingSeriesData,
          overridden: editingOccurrence.overridden === true,
        }
      : null
  const copyArea = copyFor ? store.areas.find((area) => area.id === copyFor.areaId) : undefined
  const installmentsArea = installmentsFor
    ? store.areas.find((area) => area.id === installmentsFor.areaId)
    : undefined
  const installmentsSeries = installmentsFor
    ? installmentsArea?.series.find((series) => series.id === installmentsFor.seriesId)
    : undefined
  const endingSeries = endSeriesFor
    ? store.areas
        .find((area) => area.id === endSeriesFor.areaId)
        ?.series.find((series) => series.id === endSeriesFor.seriesId)
    : undefined
  // Na ocorrência, a divisão aceita os participantes ativos e quem já está nela.
  // Contas novas só oferecem participantes ativos; na edição, quem já está na conta continua
  // aceito ("esta e as seguintes" confere de novo e aceita só ativos).
  const editingBill = billForm?.mode === 'edit' ? billForm.bill : null
  // Quem está na divisão da série também aparece, para "Usar dados da série" não esconder
  // nenhuma parte (mesmo desativado: a validação de "esta e as seguintes" pede ajuste).
  const billFormMembers = (billFormArea?.members ?? []).filter(
    (member) =>
      !member.inactive ||
      (editingBill?.shares.some((share) => share.memberId === member.id) ?? false) ||
      (editingSeriesData?.shares.some((share) => share.memberId === member.id) ?? false),
  )

  return (
    <div className="app">
      <AppHeader month={month} currentMonth={today.month} onChangeMonth={setMonth} />

      <main className="app__content">
        {store.storageIssue && <StorageWarning issue={store.storageIssue} />}
        <PersistenceWarning status={store.persistenceStatus} />
        {store.materializeLimitExceeded && (
          <p className="backup-message backup-message--error" role="alert">
            Não foi possível criar as próximas contas recorrentes e parceladas: o limite de
            20.000 contas guardadas foi atingido.
          </p>
        )}

        <PersonalPanel
          summary={personalSummary}
          alerts={personalAlerts}
          today={today}
          members={store.members}
          member={currentMember.member}
          onChooseMember={currentMember.chooseMember}
        />

        {hasExamples && (
          <div className="notice" role="note">
            <p>
              <strong>Bem-vindo!</strong> As contas marcadas como “Exemplo” têm valores
              fictícios, só para você conhecer o aplicativo. Fique à vontade para editar ou
              apagar.
            </p>
            <button
              type="button"
              className="button button--small button--ghost"
              onClick={() => setConfirmClearExamples(true)}
            >
              Apagar exemplos
            </button>
          </div>
        )}

        <AccountGroup
          icon="person"
          title={currentMember.member?.name ?? 'Contas individuais'}
          description="Despesas pessoais"
          variant="individual"
          action={
            <IndividualSummary
              monthLabel={formatMonthLabel(month).toLocaleLowerCase('pt-BR')}
              monthTotalCents={individualMonthTotals.totalCents}
              monthPendingCents={individualMonthTotals.pendingCents}
            />
          }
        >
          {individualAreas.map(renderAreaCard)}
        </AccountGroup>

        <AccountGroup
          icon="people"
          title="Contas compartilhadas"
          description="Despesas divididas entre pessoas"
          action={
            <button
              type="button"
              className="button button--small button--ghost"
              onClick={() => setShowAreaForm(true)}
              disabled={!canAddArea}
            >
              ＋ Nova área
            </button>
          }
        >
          <p className="members__feedback" role="status">
            {areaFeedback && (
              <span className={feedbackClassName(feedbackOf(areaFeedback).tone)}>
                {feedbackOf(areaFeedback).text}
              </span>
            )}
          </p>
          <FamilyArea
            memberCount={store.members.length}
            bills={monthBills}
            notices={renderDueNotices(store.bills)}
            noticesWhen="expanded"
            myShareCents={getMyShareCents(HOME_AREA_ID, monthBills)}
          >
            <MonthSummary
              bills={monthBills}
              overdueBills={overdueBills}
              onMarkPaid={(bill) => store.togglePaid(HOME_AREA_ID, bill.id)}
              overdueTitle="Contas em atraso de meses anteriores."
            />

            <FamilyMembers
              members={store.members}
              bills={monthBills}
              feedback={memberFeedback?.areaId === HOME_AREA_ID ? feedbackOf(memberFeedback) : null}
              canAdd={store.members.length < MAX_MEMBERS}
              onAdd={() => setMemberForm({ mode: 'new', areaId: HOME_AREA_ID })}
              onEdit={(member) => setMemberForm({ mode: 'edit', areaId: HOME_AREA_ID, member })}
              onDelete={(member) => setMemberToDelete({ areaId: HOME_AREA_ID, member })}
            />

            <BillList
              bills={monthBills}
              series={homeArea.series}
              members={store.members}
              today={today}
              monthName={formatMonthName(month)}
              previousMonthName={formatMonthName(previousMonth)}
              canCopyPreviousMonth={hasCommonBillsIn(homeArea, previousMonth)}
              onAdd={() => setBillForm({ mode: 'new', areaId: HOME_AREA_ID })}
              onCopyPreviousMonth={() => handleCopyPreviousMonth(HOME_AREA_ID)}
              onTogglePaid={(bill) => handleTogglePaid(HOME_AREA_ID, bill)}
              onEdit={(bill) => setBillForm({ mode: 'edit', areaId: HOME_AREA_ID, bill })}
              onDelete={(bill) => handleDeleteRequest(HOME_AREA_ID, bill)}
            />
          </FamilyArea>
          {otherSharedAreas.map(renderAreaCard)}
        </AccountGroup>
      </main>

      <footer className="app__footer">
        <p>Seus dados ficam salvos apenas neste navegador, neste aparelho.</p>
        <button
          type="button"
          className="button button--small button--ghost"
          onClick={() => setShowBackup(true)}
        >
          Backup dos dados
        </button>
      </footer>

      {showAreaForm && (
        <AreaFormDialog
          areas={store.areas}
          onSave={handleCreateArea}
          onCancel={() => setShowAreaForm(false)}
        />
      )}

      {showBackup && (
        <BackupDialog
          data={store.data}
          restoreSaveState={restoreFeedback ? saveStateFor(restoreFeedback.data) : null}
          onRestore={(restored) => {
            store.replaceAllData(restored)
            setRestoreFeedback({})
            setMemberFeedback(null)
            setAreaFeedback(null)
          }}
          onClose={() => {
            setShowBackup(false)
            setRestoreFeedback(null)
          }}
        />
      )}

      {billForm && billFormArea && (
        <BillFormDialog
          bill={billForm.mode === 'edit' ? billForm.bill : undefined}
          month={month}
          members={billFormMembers}
          areaName={billFormArea.name}
          individual={billFormArea.type === 'individual'}
          allowSeries={month >= today.month}
          occurrence={occurrenceInfo}
          onEndSeries={
            editingOccurrence && editingSeries
              ? () =>
                  setEndSeriesFor({
                    areaId: billForm.areaId,
                    seriesId: editingSeries.id,
                    billName: editingOccurrence.name,
                    month: editingOccurrence.month,
                  })
              : undefined
          }
          onChangeInstallments={
            editingOccurrence && editingSeries
              ? () =>
                  setInstallmentsFor({
                    areaId: billForm.areaId,
                    seriesId: editingSeries.id,
                    billName: editingOccurrence.name,
                  })
              : undefined
          }
          onSave={handleSaveBill}
          onCancel={() => setBillForm(null)}
        />
      )}

      {seriesEditConfirm && (
        <SeriesEditConfirmDialog
          billName={seriesEditConfirm.billName}
          month={seriesEditConfirm.month}
          plan={seriesEditConfirm.plan}
          input={seriesEditConfirm.input}
          base={seriesEditConfirm.base}
          accountData={seriesEditConfirm.accountData}
          members={store.areas.find((area) => area.id === seriesEditConfirm.areaId)?.members ?? []}
          onConfirm={(choice) => {
            const { areaId, seriesId, month: occurrenceMonth, input } = seriesEditConfirm
            const result = store.editSeriesFrom(areaId, seriesId, occurrenceMonth, input, choice)
            if (!result.ok) return result.error
            setSeriesEditConfirm(null)
            setBillForm(null)
            return null
          }}
          onCancel={() => setSeriesEditConfirm(null)}
        />
      )}

      {endSeriesFor && endingSeries && (
        <EndSeriesDialog
          billName={endSeriesFor.billName}
          options={endMonthOptions(endingSeries, today)}
          initialMonth={endSeriesFor.month}
          planFor={(lastMonth) =>
            store.planEndSeriesFrom(endSeriesFor.areaId, endSeriesFor.seriesId, lastMonth)
          }
          onConfirm={(lastMonth, choice) => {
            const result = store.endSeries(
              endSeriesFor.areaId,
              endSeriesFor.seriesId,
              lastMonth,
              choice,
            )
            if (!result.ok) return result.error
            setEndSeriesFor(null)
            setBillForm(null)
            return null
          }}
          onCancel={() => setEndSeriesFor(null)}
        />
      )}

      {installmentsFor && installmentsArea && installmentsSeries?.installmentCount !== undefined && (
        <InstallmentCountDialog
          billName={installmentsFor.billName}
          currentCount={installmentsSeries.installmentCount}
          minCount={minInstallmentCount(installmentsSeries, installmentsArea.bills)}
          members={installmentsArea.members}
          planFor={(count) =>
            store.planInstallmentCountFrom(installmentsFor.areaId, installmentsFor.seriesId, count)
          }
          onConfirm={(count, payer) => {
            const result = store.changeInstallmentCount(
              installmentsFor.areaId,
              installmentsFor.seriesId,
              count,
              payer,
            )
            if (!result.ok) return result.error
            setInstallmentsFor(null)
            setBillForm(null)
            return null
          }}
          onCancel={() => setInstallmentsFor(null)}
        />
      )}

      {copyFor && copyArea && (
        <CopyBillsDialog
          fromMonthName={formatMonthName(copyFor.fromMonth)}
          toMonthName={formatMonthName(copyFor.toMonth)}
          plan={copyFor.plan}
          members={copyArea.members}
          onConfirm={(payer) => {
            const error = store.copyBills(
              copyFor.areaId,
              copyFor.fromMonth,
              copyFor.toMonth,
              confirmationFor(copyFor.plan, payer),
            )
            if (error) return error
            setCopyFor(null)
            return null
          }}
          onCancel={() => setCopyFor(null)}
        />
      )}

      {billToDelete && (
        <ConfirmDialog
          title="Excluir conta?"
          message={
            billToDelete.bill.seriesId === undefined ? (
              <>
                A conta <strong>{billToDelete.bill.name}</strong> será removida deste mês. Essa
                ação não pode ser desfeita.
              </>
            ) : (
              <>
                {isProjectedBill(billToDelete.bill) ? 'A conta prevista ' : 'A conta '}
                <strong>{billToDelete.bill.name}</strong> de{' '}
                {formatMonthName(billToDelete.bill.month)} será excluída e não será criada de
                novo. Os outros meses da série continuam iguais. Essa ação não pode ser
                desfeita.
              </>
            )
          }
          confirmLabel="Sim, excluir"
          onConfirm={() => handleConfirmDelete(billToDelete.areaId, billToDelete.bill)}
          onCancel={() => setBillToDelete(null)}
        />
      )}

      {notice && (
        <NoticeDialog
          title={notice.title}
          message={notice.message}
          onClose={() => setNotice(null)}
        />
      )}

      {areaToDelete && canDeleteArea(areaToDelete.id) && (
        <ConfirmDialog
          title={`Excluir a área “${areaToDelete.name}”?`}
          message={
            <>
              A área <strong>{areaToDelete.name}</strong> será excluída permanentemente, junto
              com todos os seus participantes e lançamentos (
              {areaToDelete.type === 'shared' &&
                `${plural(areaToDelete.members.length, 'participante', 'participantes')} e `}
              {plural(areaToDelete.bills.length, 'lançamento', 'lançamentos')}, contando todos os
              meses). Essa ação não pode ser desfeita.
            </>
          }
          confirmLabel="Sim, excluir área"
          onConfirm={() => {
            store.deleteArea(areaToDelete.id)
            if (noParticipantsAreaId === areaToDelete.id) setNoParticipantsAreaId(null)
            setAreaFeedback({ text: `Área “${areaToDelete.name}” excluída` })
            setAreaToDelete(null)
          }}
          onCancel={() => setAreaToDelete(null)}
        />
      )}

      {confirmClearExamples && (
        <ConfirmDialog
          title="Apagar contas de exemplo?"
          message="Todas as contas marcadas como “Exemplo” serão removidas. As contas que você criou ou editou continuam aqui."
          confirmLabel="Sim, apagar exemplos"
          onConfirm={() => {
            store.deleteExamples()
            setConfirmClearExamples(false)
          }}
          onCancel={() => setConfirmClearExamples(false)}
        />
      )}

      {memberForm && memberFormArea && (
        <MemberFormDialog
          member={memberForm.mode === 'edit' ? memberForm.member : undefined}
          members={memberFormArea.members}
          onSave={handleSaveMember}
          onCancel={() => setMemberForm(null)}
        />
      )}

      {memberToDelete && memberToDeleteArea && (
        <DeleteMemberDialog
          member={memberToDelete.member}
          members={memberToDeleteArea.members}
          removal={memberRemoval ?? { mode: 'blocked', reasons: [] }}
          deactivation={
            memberRemoval?.mode === 'deactivate'
              ? store.planDeactivation(
                  memberToDelete.areaId,
                  memberToDelete.member.id,
                  protectedMemberId,
                )
              : null
          }
          onDeactivate={(payers) => {
            const result = store.deactivateMember(
              memberToDelete.areaId,
              memberToDelete.member.id,
              protectedMemberId,
              payers,
            )
            if (!result.ok) return result.error
            setMemberFeedback({ areaId: memberToDelete.areaId, text: 'Participante desativado' })
            setMemberToDelete(null)
            return null
          }}
          onConfirm={() => {
            store.deleteMember(memberToDelete.areaId, memberToDelete.member.id)
            setMemberFeedback({ areaId: memberToDelete.areaId, text: 'Membro excluído' })
            setMemberToDelete(null)
          }}
          onCancel={() => setMemberToDelete(null)}
        />
      )}
    </div>
  )
}

export default App
