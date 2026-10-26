import { useId, useState } from 'react'
import type { Member } from '../types'
import {
  describeSeriesEditOrigin,
  diffBillData,
  hasDifferences,
  type BillData,
  type BillDataDiff,
  type SeriesEditBase,
} from '../utils/billForm'
import { formatMonthLabel, formatMonthList, formatMonthName } from '../utils/dates'
import { formatBRL } from '../utils/money'
import type { OverriddenChoice, SeriesEditInput, SeriesEditPlan } from '../utils/series'
import { Modal } from './Modal'

interface SeriesEditConfirmDialogProps {
  /** Nome da conta, como aparece na lista. */
  billName: string
  /** Mês da ocorrência escolhida. */
  month: string
  plan: SeriesEditPlan
  /** Valores finais enviados pelo formulário: são eles que a nova versão usa. */
  input: SeriesEditInput
  /** Base escolhida no formulário quando os valores foram enviados. */
  base: SeriesEditBase
  /** Dados da conta selecionada, como estavam ao abrir o formulário. */
  accountData: BillData
  /** Participantes da área, para os nomes na divisão. */
  members: Member[]
  /** Aplica a alteração. Devolve uma mensagem de erro, ou null quando aplicou. */
  onConfirm: (choice: OverriddenChoice | null) => string | null
  /** Volta ao formulário sem alterar nada. */
  onCancel: () => void
}

function plural(count: number, singular: string, pluralForm: string) {
  return count === 1 ? singular : pluralForm
}

/** "Valor: R$ 100,00 → R$ 120,00", um item por campo; na divisão, por participante. */
function DiffItems({ diff, nameOf }: { diff: BillDataDiff; nameOf: (id: string) => string }) {
  const money = (cents: number | null) => (cents === null ? '' : formatBRL(cents))
  return (
    <>
      {diff.name && (
        <li>
          Nome: {diff.name.from} → {diff.name.to}
        </li>
      )}
      {diff.totalCents && (
        <li>
          Valor: {formatBRL(diff.totalCents.from)} → {formatBRL(diff.totalCents.to)}
        </li>
      )}
      {diff.dueDay && (
        <li>
          Vencimento: dia {diff.dueDay.from} → dia {diff.dueDay.to}
        </li>
      )}
      {diff.shares.length > 0 && (
        <li>
          Divisão:{' '}
          {diff.shares
            .map((item) =>
              item.from === null
                ? `${nameOf(item.memberId)} entra com ${money(item.to)}`
                : item.to === null
                  ? `${nameOf(item.memberId)} (${money(item.from)}) sai`
                  : `${nameOf(item.memberId)} ${money(item.from)} → ${money(item.to)}`,
            )
            .join('; ')}
        </li>
      )}
    </>
  )
}

/** Nomes dos campos alterados, para "alterado depois: valor, divisão". */
function changedFields(diff: BillDataDiff): string {
  const fields: string[] = []
  if (diff.name) fields.push('nome')
  if (diff.totalCents) fields.push('valor')
  if (diff.dueDay) fields.push('vencimento')
  if (diff.shares.length > 0) fields.push('divisão')
  return fields.join(', ')
}

/** Confirma "esta e as seguintes" com o resumo do que muda e do que fica igual. */
export function SeriesEditConfirmDialog({
  billName,
  month,
  plan,
  input,
  base,
  accountData,
  members,
  onConfirm,
  onCancel,
}: SeriesEditConfirmDialogProps) {
  const [choice, setChoice] = useState<OverriddenChoice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const groupId = useId()
  const needsChoice = plan.overriddenCount > 0
  const nameOf = (id: string) => members.find((member) => member.id === id)?.name ?? id
  const effective = formatMonthName(plan.effectiveMonth)
  const selectedMonth = formatMonthName(month)
  const projectedFrom =
    plan.projectedChangesFrom === null ? '' : formatMonthLabel(plan.projectedChangesFrom).toLowerCase()
  // A origem e as diferenças vêm dos valores enviados, nunca só do botão escolhido.
  const origin = describeSeriesEditOrigin(input, plan.baseline, accountData, base)
  const seriesDiff = diffBillData(plan.baseline, input)

  return (
    <Modal title={`Alterar “${billName}” a partir de ${effective}?`} onClose={onCancel} size="small">
      <div className="modal__body">
        <p className="field__hint">
          {origin.kind === 'series' && `Valores: os dados atuais da série em ${effective}.`}
          {origin.kind === 'account' &&
            `Valores: os dados desta conta de ${selectedMonth}${plan.selectedOverridden ? ' (editada individualmente)' : ''}.`}
          {origin.kind === 'edited' &&
            `Valores: editados no formulário a partir dos dados ${origin.base === 'series' ? 'da série' : 'desta conta'}. Alterado depois: ${changedFields(origin.changes)}.`}
          {hasDifferences(seriesDiff) && ` Eles passam a valer a partir de ${effective}.`}
        </p>

        {hasDifferences(seriesDiff) ? (
          <>
            <p className="field__label">O que muda em relação à série em {effective}:</p>
            <ul className="series-edit-summary">
              <DiffItems diff={seriesDiff} nameOf={nameOf} />
            </ul>
          </>
        ) : (
          // Só no mês de vigência: versões programadas depois têm o aviso próprio abaixo.
          <p className="field__hint">Os dados da série em {effective} não mudam.</p>
        )}

        <ul className="series-edit-summary">
          <li>
            {plan.selectedOutcome === 'paid'
              ? `Esta conta de ${selectedMonth} está paga e continua igual${plan.selectedOverridden ? ' e continua marcada como editada individualmente' : ''}.`
              : plan.selectedOverridden
                ? `Esta conta de ${selectedMonth} passa a seguir a série e deixa de ser marcada como editada individualmente.`
                : `Esta conta de ${selectedMonth} passa a seguir os novos dados.`}
          </li>
          {plan.updatedMonths.length > 0 && (
            <li>
              {plural(
                plan.updatedMonths.length,
                'Conta já gravada e pendente que será atualizada: ',
                'Contas já gravadas e pendentes que serão atualizadas: ',
              )}
              {formatMonthList(plan.updatedMonths)}.
            </li>
          )}
          {plan.paidKeptMonths.length > 0 && (
            <li>
              {plural(
                plan.paidKeptMonths.length,
                'Conta paga que continua com os dados antigos: ',
                'Contas pagas que continuam com os dados antigos: ',
              )}
              {formatMonthList(plan.paidKeptMonths)}.
            </li>
          )}
          {/* Só quando alguma conta prevista realmente muda. */}
          {(plan.projectedChangedMonths.length > 0 || plan.projectedChangesFrom !== null) && (
            <li>
              {plan.projectedChangedMonths.length === 0
                ? `As contas previstas de ${projectedFrom} em diante já aparecem com os novos dados.`
                : `Contas previstas que já aparecem com os novos dados: ${formatMonthList(plan.projectedChangedMonths)}${plan.projectedChangesFrom !== null ? ` e todas de ${projectedFrom} em diante` : ''}.`}
            </li>
          )}
          {plan.replacedVersionMonths.length > 0 && (
            <li className="series-edit-summary__warning" role="alert">
              {plural(
                plan.replacedVersionMonths.length,
                'A alteração já programada para ',
                'As alterações já programadas para ',
              )}
              {formatMonthList(plan.replacedVersionMonths)}{' '}
              {plural(plan.replacedVersionMonths.length, 'será substituída.', 'serão substituídas.')}
            </li>
          )}
        </ul>

        {needsChoice && (
          <fieldset className="field fieldset">
            <legend className="field__label" id={groupId}>
              {plan.overriddenCount}{' '}
              {plural(
                plan.overriddenCount,
                'conta seguinte foi editada individualmente',
                'contas seguintes foram editadas individualmente',
              )}{' '}
              ({formatMonthList(plan.overriddenMonths)}).{' '}
              {plural(plan.overriddenCount, 'O que fazer com ela?', 'O que fazer com elas?')}
            </legend>
            <label className="checkbox">
              <input
                type="radio"
                name={groupId}
                checked={choice === 'preserve'}
                onChange={() => setChoice('preserve')}
              />
              <span>Preservar as alterações individuais</span>
            </label>
            <label className="checkbox">
              <input
                type="radio"
                name={groupId}
                checked={choice === 'replace'}
                onChange={() => setChoice('replace')}
              />
              <span>Substituir pelos novos dados</span>
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
          className="button button--primary"
          disabled={needsChoice && choice === null}
          onClick={() => setError(onConfirm(needsChoice ? choice : null))}
        >
          Confirmar alteração
        </button>
      </div>
    </Modal>
  )
}
