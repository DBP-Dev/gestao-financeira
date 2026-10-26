import { useId, useState } from 'react'
import type { Member } from '../types'
import type { CopyBillsPlan } from '../utils/commonBills'
import { formatBRL } from '../utils/money'
import { Modal } from './Modal'

interface CopyBillsDialogProps {
  /** "setembro" */
  fromMonthName: string
  /** "outubro" */
  toMonthName: string
  /** Resumo calculado ao abrir: há pelo menos uma divisão a ajustar. */
  plan: CopyBillsPlan
  /** Participantes da área, para os nomes de desativados e de quem pode pagar. */
  members: Member[]
  /**
   * Copia, revalidando com os dados atuais. `payer`: quem assume as contas sem
   * participante ativo. Devolve uma mensagem de erro, ou null quando copiou.
   */
  onConfirm: (payer: string | undefined) => string | null
  /** Fecha sem copiar nada. */
  onCancel: () => void
}

function plural(count: number, singular: string, pluralForm: string) {
  return count === 1 ? singular : pluralForm
}

/** Confirmação da cópia do mês anterior quando alguma divisão tem participante desativado. */
export function CopyBillsDialog({
  fromMonthName,
  toMonthName,
  plan,
  members,
  onConfirm,
  onCancel,
}: CopyBillsDialogProps) {
  const [payer, setPayer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fieldId = useId()
  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? id
  const payerMissing = plan.needsPayer && payer === ''

  return (
    <Modal
      title={`Copiar as contas de ${fromMonthName} para ${toMonthName}?`}
      onClose={onCancel}
      size="small"
    >
      <div className="modal__body">
        <div className="field">
          <p className="field__label">
            {plural(
              plan.inactiveMemberIds.length,
              'Participante desativado nestas contas: ',
              'Participantes desativados nestas contas: ',
            )}
            {plan.inactiveMemberIds.map(nameOf).join(', ')}
          </p>
          <p className="field__hint">
            Participantes desativados não entram nas contas copiadas.{' '}
            {plan.redistributesAmongActive && plan.needsPayer
              ? 'Onde ainda há participantes ativos na divisão, a parte de quem está desativado é repartida igualmente entre eles. Onde ninguém ativo ficou, quem você escolher abaixo assume o valor inteiro.'
              : plan.needsPayer
                ? 'Ninguém ativo ficou na divisão: quem você escolher abaixo assume o valor inteiro.'
                : 'A parte de quem está desativado é repartida igualmente entre os participantes ativos que já estavam na divisão; ninguém mais é incluído.'}
          </p>
        </div>

        <div className="field">
          <p className="field__label">
            {plural(
              plan.adjusted.length,
              'Esta conta será copiada com a divisão ajustada:',
              'Estas contas serão copiadas com a divisão ajustada:',
            )}
          </p>
          <ul className="series-edit-summary">
            {plan.adjusted.map((item) => (
              <li key={item.billId}>
                {item.name}: {formatBRL(item.totalCents)}
                {item.kind === 'payer' ? ' (quem você escolher assume o valor inteiro)' : ''}
              </li>
            ))}
          </ul>
        </div>

        {plan.needsPayer && (
          <div className="field">
            <label htmlFor={`${fieldId}-payer`} className="field__label">
              Quem paga as contas sem participante ativo?
            </label>
            <select
              id={`${fieldId}-payer`}
              className="input"
              value={payer}
              onChange={(event) => {
                setPayer(event.target.value)
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
        )}

        <p className="field__hint">
          Os totais continuam os mesmos. As contas de {fromMonthName}, inclusive as pagas, não
          mudam.
        </p>
      </div>
      <div className="modal__footer">
        {error && (
          <p className="modal__footer-message" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="button button--ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={payerMissing}
          onClick={() => setError(onConfirm(plan.needsPayer ? payer : undefined))}
        >
          Copiar contas
        </button>
      </div>
    </Modal>
  )
}
