import { useId, useState } from 'react'
import type { Member } from '../types'
import { formatMonthLabel } from '../utils/dates'
import { formatBRL } from '../utils/money'
import type { InstallmentCountPlan } from '../utils/series'
import { Modal } from './Modal'

interface InstallmentCountDialogProps {
  /** Nome da conta, como aparece na lista. */
  billName: string
  currentCount: number
  /** Menor quantidade aceita (2, ou a maior parcela já paga). */
  minCount: number
  /** Participantes da área, para os nomes de desativados e de quem pode pagar. */
  members: Member[]
  /** Resumo para a quantidade digitada (não altera nada). */
  planFor: (count: number) => { ok: true; plan: InstallmentCountPlan } | { ok: false; error: string }
  /**
   * Aplica. `payer`: quem paga as parcelas novas quando a divisão ficaria sem participante
   * ativo. Devolve uma mensagem de erro, ou null quando aplicou.
   */
  onConfirm: (count: number, payer: string | undefined) => string | null
  /** Volta ao formulário sem alterar nada. */
  onCancel: () => void
}

/** "junho de 2027" */
function monthText(month: string): string {
  return formatMonthLabel(month).toLowerCase()
}

function plural(count: number, singular: string, pluralForm: string) {
  return count === 1 ? singular : pluralForm
}

/** Nova quantidade de parcelas, com o resumo do que muda e a confirmação. */
export function InstallmentCountDialog({
  billName,
  currentCount,
  minCount,
  members,
  planFor,
  onConfirm,
  onCancel,
}: InstallmentCountDialogProps) {
  const [text, setText] = useState(String(currentCount))
  const [payer, setPayer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fieldId = useId()
  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? id

  const count = /^\s*\d+\s*$/.test(text) ? Number(text) : null
  const planned = count === null ? null : planFor(count)
  const plan = planned?.ok ? planned.plan : null
  const inputError =
    count === null ? 'Informe a quantidade de parcelas, de 2 a 120.' : planned?.ok ? null : planned?.error
  const minReason =
    minCount > 2 ? `mínimo ${minCount}, porque a parcela ${minCount} já está paga` : 'mínimo 2'
  const payerMissing = Boolean(plan?.needsPayer) && payer === ''

  return (
    <Modal title={`Alterar a quantidade de parcelas de “${billName}”?`} onClose={onCancel} size="small">
      <div className="modal__body">
        <div className="field">
          <label htmlFor={`${fieldId}-count`} className="field__label">
            Quantidade de parcelas
          </label>
          <input
            id={`${fieldId}-count`}
            className="input input--short"
            inputMode="numeric"
            value={text}
            data-autofocus
            onChange={(event) => {
              setText(event.target.value)
              setError(null)
            }}
            aria-invalid={Boolean(inputError)}
          />
          <p className="field__hint">
            Hoje: {currentCount} parcelas. De {minCount} a 120 ({minReason}).
          </p>
          {inputError && <p className="field__error">{inputError}</p>}
        </div>

        {plan && plan.hasChanges && (
          <ul className="series-edit-summary">
            <li>
              A compra passa a ter <strong>{plan.newCount} parcelas</strong>, terminando em{' '}
              {monthText(plan.newLastMonth)}. A numeração das parcelas não muda, e contas pagas
              não mudam.
            </li>
            {plan.newCount > plan.currentCount && (
              <li>
                {plan.addedCount}{' '}
                {plural(plan.addedCount, 'parcela nova aparece', 'parcelas novas aparecem')} no
                fim. Parcelas excluídas continuam excluídas.
              </li>
            )}
            {plan.pastCreatedCount > 0 && (
              <li className="series-edit-summary__warning" role="alert">
                {plan.pastCreatedCount}{' '}
                {plural(
                  plan.pastCreatedCount,
                  'delas é de um mês que já passou e será criada como pendente (atrasada).',
                  'delas são de meses que já passaram e serão criadas como pendentes (atrasadas).',
                )}
              </li>
            )}
            {plan.removedProjectedCount > 0 && (
              <li>
                {plan.removedProjectedCount}{' '}
                {plural(
                  plan.removedProjectedCount,
                  'parcela prevista acima do novo total deixa de aparecer.',
                  'parcelas previstas acima do novo total deixam de aparecer.',
                )}
              </li>
            )}
            {plan.discardedVersionMonths.length > 0 && (
              <li className="series-edit-summary__warning" role="alert">
                {plural(
                  plan.discardedVersionMonths.length,
                  'A alteração programada para ',
                  'As alterações programadas para ',
                )}
                {plan.discardedVersionMonths.map(monthText).join(', ')}{' '}
                {plural(plan.discardedVersionMonths.length, 'será descartada.', 'serão descartadas.')}
              </li>
            )}
          </ul>
        )}

        {plan && plan.inactiveMemberIds.length > 0 && (
          <div className="field">
            <p className="field__label">
              {plural(
                plan.inactiveMemberIds.length,
                'Participante desativado nesta compra: ',
                'Participantes desativados nesta compra: ',
              )}
              {plan.inactiveMemberIds.map(nameOf).join(', ')}
            </p>
            <p className="field__hint">
              {plan.fixesNewInstallments && plan.recalculated.length > 0
                ? 'Isso vale para as parcelas novas e para as parcelas já guardadas listadas abaixo.'
                : plan.fixesNewInstallments
                  ? 'Isso vale para as parcelas novas.'
                  : 'Nenhuma parcela nova será criada: só as parcelas já guardadas listadas abaixo terão a divisão recalculada.'}{' '}
              {plan.redistributesAmongActive && plan.needsPayer
                ? 'Onde ainda há participantes ativos na divisão, a parte de quem está desativado é repartida igualmente entre eles. Onde ninguém ativo ficou, quem você escolher abaixo assume o valor inteiro.'
                : plan.needsPayer
                  ? 'Ninguém ativo ficou na divisão: quem você escolher abaixo assume o valor inteiro.'
                  : 'A parte de quem está desativado é repartida igualmente entre os participantes ativos que já estavam na divisão; ninguém mais é incluído.'}{' '}
              As parcelas anteriores e as pagas não mudam.
            </p>
          </div>
        )}

        {plan && plan.needsPayer && (
          <div className="field">
            <label htmlFor={`${fieldId}-payer`} className="field__label">
              {plan.fixesNewInstallments
                ? 'Quem paga as parcelas novas?'
                : 'Quem paga as parcelas recalculadas?'}
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
            <p className="field__hint">
              Quem for escolhido assume 100% do valor das parcelas em que ninguém ativo ficou na
              divisão.
            </p>
          </div>
        )}

        {plan && plan.recalculated.length > 0 && (
          <div className="field">
            <p className="field__label">
              {plural(
                plan.recalculated.length,
                'Esta parcela já guardada e pendente terá a divisão recalculada:',
                'Estas parcelas já guardadas e pendentes terão a divisão recalculada:',
              )}
            </p>
            <ul className="series-edit-summary">
              {plan.recalculated.map((item) => (
                <li key={item.billId}>
                  Parcela {item.installmentNumber} ({monthText(item.month)}):{' '}
                  {formatBRL(item.totalCents)}
                </li>
              ))}
            </ul>
            <p className="field__hint">
              Só a divisão muda: valor, vencimento e edições feitas em cada parcela continuam.
            </p>
          </div>
        )}

        {/* Com a mesma quantidade nada é aplicado: não há o que listar como removido. */}
        {plan && plan.hasChanges && plan.removed.length > 0 && (
          <div className="field">
            <p className="field__label">
              {plural(
                plan.removed.length,
                'Esta parcela pendente será removida ao confirmar:',
                'Estas parcelas pendentes serão removidas ao confirmar:',
              )}
            </p>
            <ul className="series-edit-summary">
              {plan.removed.map((item) => (
                <li key={item.month}>
                  Parcela {item.installmentNumber} ({monthText(item.month)}):{' '}
                  {formatBRL(item.totalCents)}
                </li>
              ))}
            </ul>
            <p className="field__hint">
              {plural(
                plan.removed.length,
                'Se a quantidade aumentar de novo, esse mês volta como parcela nova.',
                'Se a quantidade aumentar de novo, esses meses voltam como parcelas novas.',
              )}
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
        <button type="button" className="button button--ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button
          type="button"
          className={`button ${plan && plan.hasChanges && plan.removed.length > 0 ? 'button--danger' : 'button--primary'}`}
          disabled={!plan || !plan.hasChanges || payerMissing}
          onClick={() =>
            count !== null &&
            setError(onConfirm(count, plan?.needsPayer && payer !== '' ? payer : undefined))
          }
        >
          Alterar quantidade
        </button>
      </div>
    </Modal>
  )
}
