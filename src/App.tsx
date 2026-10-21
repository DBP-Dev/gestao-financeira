import { useState } from 'react'
import './App.css'
import { AccountGroup } from './components/AccountGroup'
import { AppHeader } from './components/AppHeader'
import { AreaCard } from './components/AreaCard'
import { AreaFormDialog, type AreaFormValues } from './components/AreaFormDialog'
import { BackupDialog } from './components/BackupDialog'
import { BillFormDialog } from './components/BillFormDialog'
import { BillList } from './components/BillList'
import { ConfirmDialog } from './components/ConfirmDialog'
import { FamilyArea } from './components/FamilyArea'
import { FamilyMembers } from './components/FamilyMembers'
import { IndividualSummary } from './components/IndividualSummary'
import { MonthSummary } from './components/MonthSummary'
import { PersonalPanel } from './components/PersonalPanel'
import { DeleteMemberDialog } from './components/DeleteMemberDialog'
import { MemberFormDialog, type MemberFormValues } from './components/MemberFormDialog'
import { StorageWarning } from './components/StorageWarning'
import { useAreaSelf } from './hooks/useAreaSelf'
import { useCurrentMember } from './hooks/useCurrentMember'
import { useFinanceStore, type BillInput } from './hooks/useFinanceStore'
import { useToday } from './hooks/useToday'
import type { Area, Bill, Member } from './types'
import { HOME_AREA_ID, MAX_AREAS, MY_ACCOUNTS_AREA_ID, canDeleteArea } from './utils/areas'
import { getBillsTotals } from './utils/billTotals'
import { getMemberShareTotals } from './utils/personal'
import {
  addMonths,
  effectiveDueDay,
  formatMonthLabel,
  formatMonthName,
  getBillStatus,
  isDueSoon,
} from './utils/dates'
import { MAX_MEMBERS, createMember, getMemberDeletionBlockers } from './utils/members'

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/** Toda conta pertence a uma área: o formulário e a exclusão sabem qual é. */
type BillFormState =
  | { mode: 'new'; areaId: string }
  | { mode: 'edit'; areaId: string; bill: Bill }
  | null
/** Todo membro pertence a uma área compartilhada: o formulário e a exclusão sabem qual é. */
type MemberFormState =
  | { mode: 'new'; areaId: string }
  | { mode: 'edit'; areaId: string; member: Member }
  | null

function App() {
  const store = useFinanceStore()
  const today = useToday()
  const [month, setMonth] = useState(today.month)
  const [lastTodayMonth, setLastTodayMonth] = useState(today.month)

  // Na virada do mês, quem estava vendo o mês atual passa para o novo mês atual.
  if (today.month !== lastTodayMonth) {
    setLastTodayMonth(today.month)
    if (month === lastTodayMonth) setMonth(today.month)
  }
  const [billForm, setBillForm] = useState<BillFormState>(null)
  const [billToDelete, setBillToDelete] = useState<{ areaId: string; bill: Bill } | null>(null)
  const [areaToDelete, setAreaToDelete] = useState<Area | null>(null)
  /** Área compartilhada sem participantes em que a pessoa tentou adicionar uma conta. */
  const [noParticipantsAreaId, setNoParticipantsAreaId] = useState<string | null>(null)
  const [memberForm, setMemberForm] = useState<MemberFormState>(null)
  const [memberToDelete, setMemberToDelete] = useState<{ areaId: string; member: Member } | null>(
    null,
  )
  const [memberFeedback, setMemberFeedback] = useState<{ areaId: string; text: string } | null>(
    null,
  )
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
  const [areaFeedback, setAreaFeedback] = useState<string | null>(null)

  const memberFormArea = memberForm
    ? store.areas.find((area) => area.id === memberForm.areaId)
    : null
  const memberToDeleteArea = memberToDelete
    ? store.areas.find((area) => area.id === memberToDelete.areaId)
    : null

  // Cada box mostra só as áreas do seu tipo; "Gastos da casa" é exibida pelo FamilyArea.
  // A única área individual é "Minhas contas" (o validador recusa outras).
  const individualAreas = store.areas.filter((area) => area.type === 'individual')
  const otherSharedAreas = store.areas.filter(
    (area) => area.type === 'shared' && area.id !== HOME_AREA_ID,
  )
  const canAddArea = store.areas.length < MAX_AREAS

  // Resumo do mês das contas individuais.
  const individualBills = individualAreas.flatMap((area) => area.bills)
  const individualMonthTotals = getBillsTotals(
    individualBills.filter((bill) => bill.month === month),
  )

  function handleCreateArea({ name }: AreaFormValues) {
    store.addArea(name)
    setAreaFeedback(`✓ Área “${name}” criada com sucesso.`)
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

  const monthBills = store.bills.filter((bill) => bill.month === month)
  const overdueBills = getOverdueBills(store.bills)
  const previousMonth = addMonths(month, -1)
  const previousMonthHasBills = store.bills.some((bill) => bill.month === previousMonth)
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
              ? '✓ Membro atualizado com sucesso.'
              : nameChanged
                ? '✓ Nome atualizado com sucesso.'
                : '✓ Cor atualizada com sucesso.',
        })
      }
    } else {
      store.addMember(areaId, createMember(name, memberFormArea.members, color))
      setMemberFeedback({ areaId, text: '✓ Membro adicionado com sucesso.' })
    }
    setMemberForm(null)
  }

  /** Seção de membros de uma área compartilhada, com ações só sobre os membros dela. */
  function renderMembers(area: Area, title?: string) {
    return (
      <FamilyMembers
        title={title}
        members={area.members}
        bills={area.bills.filter((bill) => bill.month === month)}
        feedback={memberFeedback?.areaId === area.id ? memberFeedback.text : null}
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

  function handleSaveBill(input: BillInput) {
    if (billForm?.mode === 'edit') {
      store.updateBill(billForm.areaId, billForm.bill.id, input)
    } else if (billForm) {
      store.addBill(billForm.areaId, input)
    }
    setBillForm(null)
  }

  /** Lista de contas de uma área nova, com as mesmas ações da lista de "Gastos da casa". */
  function renderAreaBills(area: Area) {
    const areaMonthBills = area.bills.filter((bill) => bill.month === month)
    const needsParticipants = area.type === 'shared' && area.members.length === 0
    return (
      <BillList
        bills={areaMonthBills}
        members={area.members}
        today={today}
        monthName={formatMonthName(month)}
        previousMonthName={formatMonthName(previousMonth)}
        canCopyPreviousMonth={area.bills.some((bill) => bill.month === previousMonth)}
        onAdd={() =>
          needsParticipants
            ? setNoParticipantsAreaId(area.id)
            : setBillForm({ mode: 'new', areaId: area.id })
        }
        onCopyPreviousMonth={() => store.copyBills(area.id, previousMonth, month)}
        onTogglePaid={(bill) => store.togglePaid(area.id, bill.id)}
        onEdit={(bill) => setBillForm({ mode: 'edit', areaId: area.id, bill })}
        onDelete={(bill) => setBillToDelete({ areaId: area.id, bill })}
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
              Adicione participantes na seção acima para cadastrar contas nesta área
              compartilhada.
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
    const areaMonthBills = area.bills.filter((bill) => bill.month === month)
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
        overdueCount={areaOverdueBills.length}
        overdueLabel={isMyAccounts ? 'Meses anteriores' : undefined}
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

  return (
    <div className="app">
      <AppHeader month={month} currentMonth={today.month} onChangeMonth={setMonth} />

      <main className="app__content">
        {store.storageIssue && <StorageWarning issue={store.storageIssue} />}

        <PersonalPanel
          bills={monthBills}
          members={store.members}
          monthName={formatMonthName(month)}
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
              <span className="backup-message backup-message--ok">{areaFeedback}</span>
            )}
          </p>
          <FamilyArea
            memberCount={store.members.length}
            bills={monthBills}
            overdueCount={overdueBills.length}
            overdueLabel="Meses anteriores"
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
              feedback={memberFeedback?.areaId === HOME_AREA_ID ? memberFeedback.text : null}
              canAdd={store.members.length < MAX_MEMBERS}
              onAdd={() => setMemberForm({ mode: 'new', areaId: HOME_AREA_ID })}
              onEdit={(member) => setMemberForm({ mode: 'edit', areaId: HOME_AREA_ID, member })}
              onDelete={(member) => setMemberToDelete({ areaId: HOME_AREA_ID, member })}
            />

            <BillList
              bills={monthBills}
              members={store.members}
              today={today}
              monthName={formatMonthName(month)}
              previousMonthName={formatMonthName(previousMonth)}
              canCopyPreviousMonth={previousMonthHasBills}
              onAdd={() => setBillForm({ mode: 'new', areaId: HOME_AREA_ID })}
              onCopyPreviousMonth={() => store.copyBills(HOME_AREA_ID, previousMonth, month)}
              onTogglePaid={(bill) => store.togglePaid(HOME_AREA_ID, bill.id)}
              onEdit={(bill) => setBillForm({ mode: 'edit', areaId: HOME_AREA_ID, bill })}
              onDelete={(bill) => setBillToDelete({ areaId: HOME_AREA_ID, bill })}
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
          onRestore={(restored) => {
            store.replaceAllData(restored)
            setMemberFeedback(null)
            setAreaFeedback(null)
          }}
          onClose={() => setShowBackup(false)}
        />
      )}

      {billForm && billFormArea && (
        <BillFormDialog
          bill={billForm.mode === 'edit' ? billForm.bill : undefined}
          month={month}
          members={billFormArea.members}
          areaName={billFormArea.name}
          individual={billFormArea.type === 'individual'}
          onSave={handleSaveBill}
          onCancel={() => setBillForm(null)}
        />
      )}

      {billToDelete && (
        <ConfirmDialog
          title="Excluir conta?"
          message={
            <>
              A conta <strong>{billToDelete.bill.name}</strong> será removida deste mês. Essa
              ação não pode ser desfeita.
            </>
          }
          confirmLabel="Sim, excluir"
          onConfirm={() => {
            store.deleteBill(billToDelete.areaId, billToDelete.bill.id)
            setBillToDelete(null)
          }}
          onCancel={() => setBillToDelete(null)}
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
            setAreaFeedback(`✓ Área “${areaToDelete.name}” excluída com sucesso.`)
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
          blockers={getMemberDeletionBlockers(
            memberToDelete.member,
            memberToDeleteArea.members,
            memberToDeleteArea.bills,
            // O painel pessoal usa só os membros de "Gastos da casa".
            memberToDelete.areaId === HOME_AREA_ID ? (currentMember.member?.id ?? null) : null,
          )}
          onConfirm={() => {
            store.deleteMember(memberToDelete.areaId, memberToDelete.member.id)
            setMemberFeedback({
              areaId: memberToDelete.areaId,
              text: '✓ Membro excluído com sucesso.',
            })
            setMemberToDelete(null)
          }}
          onCancel={() => setMemberToDelete(null)}
        />
      )}
    </div>
  )
}

export default App
