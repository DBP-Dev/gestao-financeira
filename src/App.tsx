import { useState } from 'react'
import './App.css'
import { AppHeader } from './components/AppHeader'
import { BackupDialog } from './components/BackupDialog'
import { BillFormDialog } from './components/BillFormDialog'
import { BillList } from './components/BillList'
import { ConfirmDialog } from './components/ConfirmDialog'
import { FamilyMembers } from './components/FamilyMembers'
import { MonthSummary } from './components/MonthSummary'
import { RenameMemberDialog } from './components/RenameMemberDialog'
import { useFinanceStore, type BillInput } from './hooks/useFinanceStore'
import { useToday } from './hooks/useToday'
import type { Bill, Member } from './types'
import { addMonths, formatMonthName } from './utils/dates'

type BillFormState = { mode: 'new' } | { mode: 'edit'; bill: Bill } | null

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
  const [memberToRename, setMemberToRename] = useState<Member | null>(null)
  const [confirmClearExamples, setConfirmClearExamples] = useState(false)
  const [showBackup, setShowBackup] = useState(false)

  const monthBills = store.bills.filter((bill) => bill.month === month)
  const previousMonth = addMonths(month, -1)
  const previousMonthHasBills = store.bills.some((bill) => bill.month === previousMonth)
  const hasExamples = store.bills.some((bill) => bill.isExample)

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

        <MonthSummary bills={monthBills} />

        <FamilyMembers
          members={store.members}
          bills={monthBills}
          onRename={setMemberToRename}
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

      {showBackup && (
        <BackupDialog
          data={store.data}
          onRestore={store.replaceAllData}
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

      {memberToRename && (
        <RenameMemberDialog
          member={memberToRename}
          onSave={(name) => {
            store.renameMember(memberToRename.id, name)
            setMemberToRename(null)
          }}
          onCancel={() => setMemberToRename(null)}
        />
      )}
    </div>
  )
}

export default App
