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
import { MonthSummary } from './components/MonthSummary'
import { PersonalPanel } from './components/PersonalPanel'
import { DeleteMemberDialog } from './components/DeleteMemberDialog'
import { MemberFormDialog, type MemberFormValues } from './components/MemberFormDialog'
import { StorageWarning } from './components/StorageWarning'
import { useCurrentMember } from './hooks/useCurrentMember'
import { useFinanceStore, type BillInput } from './hooks/useFinanceStore'
import { useToday } from './hooks/useToday'
import type { Area, AreaType, Bill, Member } from './types'
import { HOME_AREA_ID, MAX_AREAS, canDeleteArea } from './utils/areas'
import { addMonths, effectiveDueDay, formatMonthName, getBillStatus } from './utils/dates'
import { MAX_MEMBERS, createMember, getMemberDeletionBlockers } from './utils/members'

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/** Toda conta pertence a uma área: o formulário e a exclusão sabem qual é. */
type BillFormState =
  | { mode: 'new'; areaId: string }
  | { mode: 'edit'; areaId: string; bill: Bill }
  | null
type MemberFormState = { mode: 'new' } | { mode: 'edit'; member: Member } | null

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
  const [memberToDelete, setMemberToDelete] = useState<Member | null>(null)
  const [memberFeedback, setMemberFeedback] = useState<string | null>(null)
  const currentMember = useCurrentMember(store.members)
  const [confirmClearExamples, setConfirmClearExamples] = useState(false)
  const [showBackup, setShowBackup] = useState(false)
  const [areaFormType, setAreaFormType] = useState<AreaType | null>(null)
  const [areaFeedback, setAreaFeedback] = useState<{ type: AreaType; text: string } | null>(
    null,
  )

  // Cada box mostra só as áreas do seu tipo; "Gastos da casa" é exibida pelo FamilyArea.
  const individualAreas = store.areas.filter((area) => area.type === 'individual')
  const otherSharedAreas = store.areas.filter(
    (area) => area.type === 'shared' && area.id !== HOME_AREA_ID,
  )
  const canAddArea = store.areas.length < MAX_AREAS

  function handleCreateArea({ name, type }: AreaFormValues) {
    store.addArea(name, type)
    setAreaFeedback({ type, text: `✓ Área “${name}” criada com sucesso.` })
    setAreaFormType(null)
  }

  function newAreaButton(type: AreaType) {
    return (
      <button
        type="button"
        className="button button--small button--ghost"
        onClick={() => setAreaFormType(type)}
        disabled={!canAddArea}
      >
        ＋ Nova área
      </button>
    )
  }

  function areaFeedbackFor(type: AreaType) {
    return (
      <p className="members__feedback" role="status">
        {areaFeedback?.type === type && (
          <span className="backup-message backup-message--ok">{areaFeedback.text}</span>
        )}
      </p>
    )
  }

  const monthBills = store.bills.filter((bill) => bill.month === month)
  // Meses anteriores ao selecionado: nunca se misturam com os totais do mês.
  const overdueBills = store.bills
    .filter((bill) => bill.month < month && getBillStatus(bill, today) === 'late')
    .sort(
      (a, b) =>
        a.month.localeCompare(b.month) || effectiveDueDay(a) - effectiveDueDay(b),
    )
  const previousMonth = addMonths(month, -1)
  const previousMonthHasBills = store.bills.some((bill) => bill.month === previousMonth)
  const hasExamples = store.bills.some((bill) => bill.isExample)

  function handleSaveMember({ name, color }: MemberFormValues) {
    if (memberForm?.mode === 'edit') {
      const { member } = memberForm
      const nameChanged = name !== member.name
      const colorChanged = color !== member.color
      if (nameChanged || colorChanged) {
        store.updateMember(member.id, { name, color })
        setMemberFeedback(
          nameChanged && colorChanged
            ? '✓ Membro atualizado com sucesso.'
            : nameChanged
              ? '✓ Nome atualizado com sucesso.'
              : '✓ Cor atualizada com sucesso.',
        )
      }
    } else {
      store.addMember(createMember(name, store.members, color))
      setMemberFeedback('✓ Membro adicionado com sucesso.')
    }
    setMemberForm(null)
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
        notice={
          needsParticipants &&
          noParticipantsAreaId === area.id && (
            <p className="backup-message backup-message--error" role="alert">
              Para criar contas nesta área compartilhada, é preciso cadastrar participantes
              nela antes. Os participantes de “Gastos da casa” não são usados em outras áreas.
            </p>
          )
        }
      />
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
          title="Contas individuais"
          description="Despesas pessoais"
          action={newAreaButton('individual')}
        >
          {areaFeedbackFor('individual')}
          {individualAreas.length === 0 ? (
            <p className="account-group__empty">Nenhuma área individual foi criada ainda.</p>
          ) : (
            individualAreas.map((area) => (
              <AreaCard key={area.id} area={area} onDelete={() => setAreaToDelete(area)}>
                {renderAreaBills(area)}
              </AreaCard>
            ))
          )}
        </AccountGroup>

        <AccountGroup
          icon="people"
          title="Contas compartilhadas"
          description="Despesas divididas entre pessoas"
          action={newAreaButton('shared')}
        >
          {areaFeedbackFor('shared')}
          <FamilyArea
            memberCount={store.members.length}
            bills={monthBills}
            overdueCount={overdueBills.length}
          >
            <MonthSummary
              bills={monthBills}
              overdueBills={overdueBills}
              onMarkPaid={(bill) => store.togglePaid(HOME_AREA_ID, bill.id)}
            />

            <FamilyMembers
              members={store.members}
              bills={monthBills}
              feedback={memberFeedback}
              canAdd={store.members.length < MAX_MEMBERS}
              onAdd={() => setMemberForm({ mode: 'new' })}
              onEdit={(member) => setMemberForm({ mode: 'edit', member })}
              onDelete={setMemberToDelete}
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
          {otherSharedAreas.map((area) => (
            <AreaCard key={area.id} area={area} onDelete={() => setAreaToDelete(area)}>
              {renderAreaBills(area)}
            </AreaCard>
          ))}
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

      {areaFormType && (
        <AreaFormDialog
          initialType={areaFormType}
          areas={store.areas}
          onSave={handleCreateArea}
          onCancel={() => setAreaFormType(null)}
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
            setAreaFeedback({
              type: areaToDelete.type,
              text: `✓ Área “${areaToDelete.name}” excluída com sucesso.`,
            })
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

      {memberForm && (
        <MemberFormDialog
          member={memberForm.mode === 'edit' ? memberForm.member : undefined}
          members={store.members}
          onSave={handleSaveMember}
          onCancel={() => setMemberForm(null)}
        />
      )}

      {memberToDelete && (
        <DeleteMemberDialog
          member={memberToDelete}
          blockers={getMemberDeletionBlockers(
            memberToDelete,
            store.members,
            store.bills,
            currentMember.member?.id ?? null,
          )}
          onConfirm={() => {
            store.deleteMember(memberToDelete.id)
            setMemberFeedback('✓ Membro excluído com sucesso.')
            setMemberToDelete(null)
          }}
          onCancel={() => setMemberToDelete(null)}
        />
      )}
    </div>
  )
}

export default App
