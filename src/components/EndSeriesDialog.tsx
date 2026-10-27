import { useId, useState } from 'react'
import type { MonthKey } from '../domain/types'
import { formatMonthLabel } from '../domain/dates'
import { formatBRL } from '../domain/money'
import type { EndSeriesPlan, PendingAfterEndChoice } from '../domain/series'
import { Modal } from './Modal'

interface EndSeriesDialogProps {
  /** Nome da conta, como aparece na lista. */
  billName: string
  /** Meses que podem ser escolhidos como último mês, em ordem. */
  options: MonthKey[]
  /** Mês sugerido: o da conta selecionada. */
  initialMonth: MonthKey
  /** Resumo do encerramento para o mês escolhido (não altera nada). */
  planFor: (lastMonth: MonthKey) => { ok: true; plan: EndSeriesPlan } | { ok: false; error: string }
  /** Encerra. Devolve uma mensagem de erro, ou null quando encerrou. */
  onConfirm: (lastMonth: MonthKey, choice: PendingAfterEndChoice | null) => string | null
  /** Volta ao formulário sem alterar nada. */
  onCancel: () => void
}

/** "dezembro de 2026" */
function monthText(month: MonthKey): string {
  return formatMonthLabel(month).toLowerCase()
}

function plural(count: number, singular: string, pluralForm: string) {
  return count === 1 ? singular : pluralForm
}

/** Escolha do último mês de uma recorrência, com o resumo do que muda e a confirmação. */
export function EndSeriesDialog({
  billName,
  options,
  initialMonth,
  planFor,
  onConfirm,
  onCancel,
}: EndSeriesDialogProps) {
  const [lastMonth, setLastMonth] = useState<MonthKey>(
    options.includes(initialMonth) ? initialMonth : options[options.length - 1],
  )
  const [choice, setChoice] = useState<PendingAfterEndChoice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fieldId = useId()

  const planned = planFor(lastMonth)
  const plan = planned.ok ? planned.plan : null
  const needsChoice = (plan?.pendingAfter.length ?? 0) > 0

  function changeMonth(month: MonthKey) {
    setLastMonth(month)
    // A lista de pendentes muda com o mês: a escolha precisa ser feita de novo.
    setChoice(null)
    setError(null)
  }

  return (
    <Modal title={`Encerrar a recorrência “${billName}”?`} onClose={onCancel} size="small">
      <div className="modal__body">
        <div className="field">
          <label htmlFor={`${fieldId}-month`} className="field__label">
            Último mês a cobrar
          </label>
          <select
            id={`${fieldId}-month`}
            className="input"
            value={lastMonth}
            onChange={(event) => changeMonth(event.target.value)}
          >
            {options.map((month) => (
              <option key={month} value={month}>
                {formatMonthLabel(month)}
              </option>
            ))}
          </select>
        </div>

        {!planned.ok && (
          <p className="field__error" role="alert">
            {planned.error}
          </p>
        )}

        {plan && (
          <ul className="series-edit-summary">
            <li className="series-edit-summary__warning">
              A recorrência termina em {monthText(plan.lastMonth)}: nenhuma conta será criada
              depois disso. O encerramento não pode ser desfeito.
            </li>
            <li>
              Contas pagas nunca são excluídas.
              {plan.paidAfterCount > 0 &&
                ` ${plan.paidAfterCount} ${plural(
                  plan.paidAfterCount,
                  'conta paga depois do último mês continua guardada.',
                  'contas pagas depois do último mês continuam guardadas.',
                )}`}
            </li>
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
            {plan.discardedSkippedMonths.length > 0 && (
              <li>
                {plural(
                  plan.discardedSkippedMonths.length,
                  'O mês excluído depois do fim (',
                  'Os meses excluídos depois do fim (',
                )}
                {plan.discardedSkippedMonths.map(monthText).join(', ')}
                {plural(
                  plan.discardedSkippedMonths.length,
                  ') deixa de ser guardado, porque nenhuma conta será criada ali.',
                  ') deixam de ser guardados, porque nenhuma conta será criada ali.',
                )}
              </li>
            )}
          </ul>
        )}

        {plan && needsChoice && (
          <fieldset className="field fieldset">
            <legend className="field__label">
              {plural(
                plan.pendingAfter.length,
                'Esta conta pendente fica depois do último mês:',
                'Estas contas pendentes ficam depois do último mês:',
              )}
            </legend>
            <ul className="series-edit-summary">
              {plan.pendingAfter.map((item) => (
                <li key={item.month}>
                  {formatMonthLabel(item.month)}: {formatBRL(item.totalCents)}
                </li>
              ))}
            </ul>
            <label className="checkbox">
              <input
                type="radio"
                name={`${fieldId}-choice`}
                checked={choice === 'keep'}
                onChange={() => setChoice('keep')}
              />
              <span>{plural(plan.pendingAfter.length, 'Manter essa conta', 'Manter essas contas')}</span>
            </label>
            <label className="checkbox">
              <input
                type="radio"
                name={`${fieldId}-choice`}
                checked={choice === 'delete'}
                onChange={() => setChoice('delete')}
              />
              <span>{plural(plan.pendingAfter.length, 'Excluir essa conta', 'Excluir essas contas')}</span>
            </label>
          </fieldset>
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
          disabled={!plan || (needsChoice && choice === null)}
          onClick={() => setError(onConfirm(lastMonth, needsChoice ? choice : null))}
        >
          Encerrar recorrência
        </button>
      </div>
    </Modal>
  )
}
