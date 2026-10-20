import { useId, useState, type FormEvent } from 'react'
import type { BillInput } from '../hooks/useFinanceStore'
import type { Bill, Member, MonthKey } from '../types'
import {
  analyzeDraft,
  createDraft,
  orderMemberIds,
  type BillDraft,
  type SplitMode,
} from '../utils/billForm'
import { formatMonthName } from '../utils/dates'
import { centsToInput, formatBRL, parseMoneyInput, splitEvenly } from '../utils/money'
import { Avatar } from './Avatar'
import { Modal } from './Modal'

interface BillFormDialogProps {
  bill?: Bill
  month: MonthKey
  /** Participantes da área da conta (vazio em áreas individuais). */
  members: Member[]
  /** Nome da área onde a conta será salva. */
  areaName: string
  /** Conta de área individual: sem pessoas nem divisão. */
  individual?: boolean
  onSave: (input: BillInput) => void
  onCancel: () => void
}

const NAME_SUGGESTIONS = [
  'Aluguel',
  'Água',
  'Condomínio',
  'Energia',
  'Gás',
  'Internet',
  'Mercado',
  'Plano de saúde',
  'Celular',
  'Farmácia',
]

const DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => index + 1)

/** Ao sair do campo, mostra o valor no formato brasileiro (ex.: "1500" → "1500,00"). */
function tidyMoney(text: string): string {
  const cents = parseMoneyInput(text)
  return cents === null ? text : centsToInput(cents)
}

export function BillFormDialog({
  bill,
  month,
  members,
  areaName,
  individual = false,
  onSave,
  onCancel,
}: BillFormDialogProps) {
  const [draft, setDraft] = useState<BillDraft>(() => createDraft(bill))
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const fieldId = useId()

  const analysis = analyzeDraft(draft, individual)
  const { errors } = analysis
  const isEditing = Boolean(bill)
  const selectedCount = draft.memberIds.length
  const showCustomValues = draft.splitMode === 'custom' && selectedCount > 1

  function update(changes: Partial<BillDraft>) {
    setDraft((current) => ({ ...current, ...changes }))
  }

  function toggleMember(memberId: string) {
    setDraft((current) => {
      const isSelected = current.memberIds.includes(memberId)
      const nextIds = isSelected
        ? current.memberIds.filter((id) => id !== memberId)
        : orderMemberIds([...current.memberIds, memberId], members)
      return { ...current, memberIds: nextIds }
    })
  }

  function changeSplitMode(mode: SplitMode) {
    setDraft((current) => {
      // Clicar no modo que já está ativo não deve mudar nada.
      if (current.splitMode === mode) return current
      if (mode === 'custom') {
        // Começa a personalização a partir da divisão igual, para facilitar.
        const totalCents = parseMoneyInput(current.total)
        const amounts =
          totalCents !== null ? splitEvenly(totalCents, current.memberIds.length) : []
        const customAmounts = { ...current.customAmounts }
        current.memberIds.forEach((id, index) => {
          customAmounts[id] = amounts[index] !== undefined ? centsToInput(amounts[index]) : ''
        })
        return { ...current, splitMode: mode, customAmounts }
      }
      return { ...current, splitMode: mode }
    })
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitAttempted(true)
    if (!analysis.isValid || !analysis.shares || analysis.totalCents === null) return

    onSave({
      name: draft.name.trim(),
      month: bill?.month ?? month,
      totalCents: analysis.totalCents,
      dueDay: Number(draft.dueDay),
      shares: analysis.shares,
      paid: draft.paid,
    })
  }

  const memberById = (id: string) => members.find((member) => member.id === id)

  return (
    <Modal title={isEditing ? 'Editar conta' : 'Nova conta'} onClose={onCancel}>
      <form onSubmit={handleSubmit} noValidate className="bill-form">
        <div className="modal__body">
          {!isEditing && (
            <p className="bill-form__intro">
              Esta conta será adicionada em <strong>{formatMonthName(month)}</strong>, na
              área <strong>{areaName}</strong>.
            </p>
          )}

          <div className="field">
            <label htmlFor={`${fieldId}-name`} className="field__label">
              Nome da conta
            </label>
            <input
              id={`${fieldId}-name`}
              data-autofocus
              className="input"
              list={`${fieldId}-suggestions`}
              value={draft.name}
              maxLength={40}
              placeholder="Ex.: Água, Aluguel, Mercado"
              onChange={(event) => update({ name: event.target.value })}
              aria-invalid={submitAttempted && Boolean(errors.name)}
            />
            <datalist id={`${fieldId}-suggestions`}>
              {NAME_SUGGESTIONS.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
            {submitAttempted && errors.name && <p className="field__error">{errors.name}</p>}
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor={`${fieldId}-total`} className="field__label">
                Valor total
              </label>
              <div className="money-input">
                <span className="money-input__prefix" aria-hidden="true">
                  R$
                </span>
                <input
                  id={`${fieldId}-total`}
                  className="input"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={draft.total}
                  onChange={(event) => update({ total: event.target.value })}
                  onBlur={() => update({ total: tidyMoney(draft.total) })}
                  aria-invalid={submitAttempted && Boolean(errors.total)}
                />
              </div>
              {submitAttempted && errors.total && (
                <p className="field__error">{errors.total}</p>
              )}
            </div>

            <div className="field">
              <label htmlFor={`${fieldId}-day`} className="field__label">
                Dia do vencimento
              </label>
              <select
                id={`${fieldId}-day`}
                className="input"
                value={draft.dueDay}
                onChange={(event) => update({ dueDay: event.target.value })}
              >
                {DAY_OPTIONS.map((day) => (
                  <option key={day} value={day}>
                    Dia {day}
                  </option>
                ))}
              </select>
              {submitAttempted && errors.dueDay && (
                <p className="field__error">{errors.dueDay}</p>
              )}
            </div>
          </div>

          {/* Áreas individuais não têm pessoas nem divisão. */}
          {!individual && (
            <>
              <fieldset className="field fieldset">
                <legend className="field__label">Quem vai pagar?</legend>
                <p className="field__hint">Toque nas pessoas para escolher uma ou mais.</p>
                <div className="member-picker">
                  {members.map((member) => {
                    const isSelected = draft.memberIds.includes(member.id)
                    return (
                      <button
                        key={member.id}
                        type="button"
                        className={`member-chip ${isSelected ? 'member-chip--selected' : ''}`}
                        aria-pressed={isSelected}
                        onClick={() => toggleMember(member.id)}
                      >
                        <Avatar member={member} size="small" />
                        {member.name}
                        {isSelected && <span aria-hidden="true">✓</span>}
                      </button>
                    )
                  })}
                </div>
                {submitAttempted && errors.members && (
                  <p className="field__error">{errors.members}</p>
                )}
              </fieldset>

              {selectedCount === 1 && (
                <div className="split-box">
                  <p className="split-box__single">
                    <Avatar member={memberById(draft.memberIds[0])!} size="small" />
                    <span>
                      <strong>{memberById(draft.memberIds[0])?.name}</strong> paga o valor
                      inteiro
                      {analysis.totalCents ? `: ${formatBRL(analysis.totalCents)}` : '.'}
                    </span>
                  </p>
                </div>
              )}

              {selectedCount > 1 && (
                <div className="split-box">
                  <div className="segmented" role="group" aria-label="Como dividir">
                    <button
                      type="button"
                      className={`segmented__option ${draft.splitMode === 'equal' ? 'segmented__option--active' : ''}`}
                      aria-pressed={draft.splitMode === 'equal'}
                      onClick={() => changeSplitMode('equal')}
                    >
                      Dividir igualmente
                    </button>
                    <button
                      type="button"
                      className={`segmented__option ${draft.splitMode === 'custom' ? 'segmented__option--active' : ''}`}
                      aria-pressed={draft.splitMode === 'custom'}
                      onClick={() => changeSplitMode('custom')}
                    >
                      Escolher valores
                    </button>
                  </div>

                  {!showCustomValues && (
                    <ul className="split-list">
                      {draft.memberIds.map((memberId, index) => {
                        const member = memberById(memberId)
                        if (!member) return null
                        const amount = analysis.shares?.[index]?.amountCents
                        return (
                          <li key={memberId} className="split-list__item">
                            <Avatar member={member} size="small" />
                            <span className="split-list__name">{member.name}</span>
                            <span className="split-list__value">
                              {amount !== undefined ? formatBRL(amount) : '—'}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  {showCustomValues && (
                    <>
                      <ul className="split-list">
                        {draft.memberIds.map((memberId) => {
                          const member = memberById(memberId)
                          if (!member) return null
                          const inputId = `${fieldId}-share-${memberId}`
                          const amountError = errors.memberAmounts[memberId]
                          const value = draft.customAmounts[memberId] ?? ''
                          return (
                            <li key={memberId} className="split-list__item">
                              <Avatar member={member} size="small" />
                              <label htmlFor={inputId} className="split-list__name">
                                {member.name}
                              </label>
                              <div className="split-list__input">
                                <div className="money-input money-input--small">
                                  <span className="money-input__prefix" aria-hidden="true">
                                    R$
                                  </span>
                                  <input
                                    id={inputId}
                                    className="input"
                                    inputMode="decimal"
                                    placeholder="0,00"
                                    value={value}
                                    onChange={(event) =>
                                      update({
                                        customAmounts: {
                                          ...draft.customAmounts,
                                          [memberId]: event.target.value,
                                        },
                                      })
                                    }
                                    onBlur={() =>
                                      update({
                                        customAmounts: {
                                          ...draft.customAmounts,
                                          [memberId]: tidyMoney(value),
                                        },
                                      })
                                    }
                                    aria-invalid={Boolean(amountError) && value !== ''}
                                  />
                                </div>
                                {amountError && (value !== '' || submitAttempted) && (
                                  <span className="field__error field__error--inline">
                                    {amountError}
                                  </span>
                                )}
                              </div>
                            </li>
                          )
                        })}
                      </ul>

                      <div
                        className={`sum-status ${analysis.sumMatches ? 'sum-status--ok' : 'sum-status--error'}`}
                        role="status"
                      >
                        <span>
                          Soma das partes: <strong>{formatBRL(analysis.customSumCents)}</strong>
                          {analysis.totalCents ? ` de ${formatBRL(analysis.totalCents)}` : ''}
                        </span>
                        {errors.sum && <span>{errors.sum}</span>}
                        {analysis.sumMatches && <span>✓ Tudo certo, a soma fecha com o total.</span>}
                        {!errors.sum && !analysis.sumMatches && (
                          <span>Preencha o valor total e a parte de cada pessoa.</span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.paid}
              onChange={(event) => update({ paid: event.target.checked })}
            />
            <span>Esta conta já foi paga</span>
          </label>
        </div>

        <div className="modal__footer">
          {submitAttempted && !analysis.isValid && (
            <p className="modal__footer-message">Confira os campos destacados acima.</p>
          )}
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={showCustomValues && !analysis.sumMatches}
          >
            {isEditing ? 'Salvar alterações' : 'Adicionar conta'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
