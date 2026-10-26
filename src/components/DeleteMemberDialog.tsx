import { useId, useState } from 'react'
import type { Member } from '../types'
import { formatMonthLabel } from '../utils/dates'
import type { MemberRemoval } from '../utils/members'
import { formatBRL } from '../utils/money'
import type { DeactivationBill, DeactivationPlan, PayerChoices } from '../utils/series'
import { ConfirmDialog } from './ConfirmDialog'
import { Modal } from './Modal'

interface DeleteMemberDialogProps {
  member: Member
  /** Participantes da área, para mostrar os nomes de quem pode assumir. */
  members: Member[]
  /** Excluir, desativar ou bloquear (getMemberRemoval). */
  removal: MemberRemoval
  /** Resumo da desativação (só no modo "desativar"). */
  deactivation: { ok: true; plan: DeactivationPlan } | { ok: false; error: string } | null
  /** Exclusão definitiva (participante sem histórico). */
  onConfirm: () => void
  /** Desativa. Devolve uma mensagem de erro, ou null quando desativou. */
  onDeactivate: (payers: PayerChoices) => string | null
  onCancel: () => void
}

/** "novembro de 2026" */
function monthText(month: string): string {
  return formatMonthLabel(month).toLowerCase()
}

function BillItems({ bills }: { bills: DeactivationBill[] }) {
  return (
    <ul className="series-edit-summary">
      {bills.map((bill) => (
        <li key={bill.billId}>
          {bill.name} — {formatMonthLabel(bill.month)}: {formatBRL(bill.totalCents)}
        </li>
      ))}
    </ul>
  )
}

/** Confirma a exclusão, conduz a desativação ou explica por que nenhuma é permitida. */
export function DeleteMemberDialog({
  member,
  members,
  removal,
  deactivation,
  onConfirm,
  onDeactivate,
  onCancel,
}: DeleteMemberDialogProps) {
  const [payers, setPayers] = useState<PayerChoices>({})
  const [error, setError] = useState<string | null>(null)
  const fieldId = useId()

  if (removal.mode === 'delete') {
    return (
      <ConfirmDialog
        title={`Excluir “${member.name}”?`}
        message="Este membro não participa de nenhuma conta. A exclusão não pode ser desfeita."
        confirmLabel="Sim, excluir"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
  }

  const reasons =
    removal.mode === 'blocked'
      ? removal.reasons
      : deactivation && !deactivation.ok
        ? [deactivation.error]
        : []
  if (reasons.length > 0 || !deactivation || !deactivation.ok) {
    return (
      <Modal title={`Não é possível remover “${member.name}”`} onClose={onCancel} size="small">
        <div className="modal__body">
          <ul className="blockers" role="alert">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p className="confirm__message">Nenhum dado foi alterado.</p>
        </div>
        <div className="modal__footer">
          <button type="button" className="button button--primary" onClick={onCancel} data-autofocus>
            Entendi
          </button>
        </div>
      </Modal>
    )
  }

  const { plan } = deactivation
  const nameOf = (id: string) => members.find((item) => item.id === id)?.name ?? id
  const needingPayer = plan.affectedSeries.filter((item) => item.needsPayer)
  const missingPayer = needingPayer.some((item) => payers[item.seriesId] === undefined)

  return (
    <Modal title={`Desativar “${member.name}”?`} onClose={onCancel} size="small">
      <div className="modal__body">
        <p className="confirm__message">
          {member.name} participa de contas guardadas, por isso o cadastro será{' '}
          <strong>desativado</strong> em vez de excluído.
        </p>
        <ul className="series-edit-summary">
          <li>
            A partir de <strong>{monthText(plan.effectiveMonth)}</strong>, {member.name} sai das
            divisões das contas recorrentes e parceladas. A parte de {member.name} é repartida
            igualmente entre os demais participantes ativos.
          </li>
          <li>
            O mês atual e os anteriores continuam iguais; para corrigir uma conta deste mês, use
            Editar nela.
          </li>
          <li>Contas pagas e o histórico não mudam, e {member.name} continua aparecendo neles.</li>
          <li className="series-edit-summary__warning">
            Não há como reativar participantes nesta versão do aplicativo.
          </li>
        </ul>

        {needingPayer.map((item) => (
          <div className="field" key={item.seriesId}>
            <label htmlFor={`${fieldId}-${item.seriesId}`} className="field__label">
              Quem assume “{item.name}”? (hoje só {member.name} paga esta conta)
            </label>
            <select
              id={`${fieldId}-${item.seriesId}`}
              className="input"
              value={payers[item.seriesId] ?? ''}
              onChange={(event) => {
                setPayers({ ...payers, [item.seriesId]: event.target.value })
                setError(null)
              }}
            >
              <option value="" disabled>
                Escolha um participante
              </option>
              {plan.payerCandidates.map((id) => (
                <option key={id} value={id}>
                  {nameOf(id)}
                </option>
              ))}
            </select>
          </div>
        ))}

        {plan.recalculated.length > 0 && (
          <div className="field">
            <p className="field__label">
              Contas recorrentes e parceladas que serão recalculadas
            </p>
            <BillItems bills={plan.recalculated} />
            <p className="field__hint">
              São contas já guardadas e pendentes a partir de {monthText(plan.effectiveMonth)}.
              A parte de {member.name} passa aos demais (ou a quem você escolheu acima).
            </p>
          </div>
        )}

        {plan.commonBillsKept.length > 0 && (
          <div className="field">
            <p className="field__label">Contas comuns que não serão alteradas</p>
            <BillItems bills={plan.commonBillsKept} />
            <p className="field__hint">
              {member.name} continua nessas contas. Para mudar a divisão, use Editar em cada uma.
            </p>
          </div>
        )}
      </div>
      <div className="modal__footer">
        {error && (
          <p className="modal__footer-message" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="button button--ghost" onClick={onCancel} data-autofocus>
          Cancelar
        </button>
        <button
          type="button"
          className="button button--danger"
          disabled={missingPayer}
          onClick={() => setError(onDeactivate(payers))}
        >
          Desativar participante
        </button>
      </div>
    </Modal>
  )
}
