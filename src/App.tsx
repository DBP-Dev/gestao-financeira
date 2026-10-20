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
import type { AreaType, Bill, Member } from './types'
import { HOME_AREA_ID, MAX_AREAS } from './utils/areas'
import { addMonths, effectiveDueDay, formatMonthName, getBillStatus } from './utils/dates'
import { MAX_MEMBERS, createMember, getMemberDeletionBlockers } from './utils/members'

type BillFormState = { mode: 'new' } | { mode: 'edit'; bill: Bill } | null
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
  const [billToDelete, setBillToDelete] = useState<Bill | null>(null)
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
      store.updateBill(billForm.bill.id, input)
    } else {
      store.addBill(input)
    }
    setBillForm(null)
  }

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
            individualAreas.map((area) => <AreaCard key={area.id} area={area} />)
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
              onMarkPaid={(bill) => store.togglePaid(bill.id)}
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
              onAdd={() => setBillForm({ mode: 'new' })}
              onCopyPreviousMonth={() => store.copyBills(previousMonth, month)}
              onTogglePaid={(bill) => store.togglePaid(bill.id)}
              onEdit={(bill) => setBillForm({ mode: 'edit', bill })}
              onDelete={setBillToDelete}
            />
          </FamilyArea>
          {otherSharedAreas.map((area) => (
            <AreaCard key={area.id} area={area} />
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

      {billForm && (
        <BillFormDialog
          bill={billForm.mode === 'edit' ? billForm.bill : undefined}
          month={month}
          members={store.members}
          onSave={handleSaveBill}
          onCancel={() => setBillForm(null)}
        />
      )}

      {billToDelete && (
        <ConfirmDialog
          title="Excluir conta?"
          message={
            <>
              A conta <strong>{billToDelete.name}</strong> será removida deste mês. Essa
              ação não pode ser desfeita.
            </>
          }
          confirmLabel="Sim, excluir"
          onConfirm={() => {
            store.deleteBill(billToDelete.id)
            setBillToDelete(null)
          }}
          onCancel={() => setBillToDelete(null)}
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
