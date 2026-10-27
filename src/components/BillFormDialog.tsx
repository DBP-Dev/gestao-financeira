import { useId, useState, type FormEvent } from 'react'
import type { BillInput } from '../hooks/useFinanceStore'
import type { Bill, Member, MonthKey, SeriesKind } from '../domain/types'
import {
  analyzeDraft,
  createDraft,
  draftFromSeriesData,
  draftMatchesSeriesData,
  orderMemberIds,
  type BillData,
  type BillDraft,
  type BillKind,
  type SeriesEditBase,
  type SplitMode,
} from '../utils/billForm'
import { formatMonthName } from '../domain/dates'
import { centsToInput, formatBRL, parseMoneyInput, splitEvenly } from '../domain/money'
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
  /** Recorrentes e parceladas só começam no mês atual ou num mês futuro. */
  allowSeries?: boolean
  /**
   * Edição de uma ocorrência de série: o rótulo da série ("Recorrente" ou "Parcela 3/10"),
   * se a conta ainda é prevista (salvar "só esta" grava a ocorrência), se é parcelada, e o
   * mês em que "esta e as seguintes" passaria a valer (null quando não há contas seguintes).
   */
  occurrence?: {
    label: string
    projected: boolean
    installment: boolean
    seriesEffectiveMonth: MonthKey | null
    /** Recorrente em aberto: pode ser encerrada (séries encerradas não mudam mais). */
    canEnd: boolean
    /** Dados da série no mês em que "esta e as seguintes" passaria a valer. */
    seriesData: BillData | null
    /** A conta foi editada individualmente ("só esta"). */
    overridden: boolean
  } | null
  /** Abre o encerramento da recorrência (por cima do formulário). */
  onEndSeries?: () => void
  /** Abre a mudança da quantidade de parcelas (por cima do formulário). */
  onChangeInstallments?: () => void
  /**
   * Salva a conta. `series` vem preenchido quando o tipo é recorrente ou parcelado.
   * `scope` diz, na edição de uma ocorrência de série, se vale só para ela ou para ela e
   * as seguintes; `base`, qual base estava escolhida para a nova versão. Devolve uma
   * mensagem de erro quando não for possível salvar (o formulário continua aberto).
   */
  onSave: (
    input: BillInput,
    series: SeriesChoice | null,
    scope: EditScope,
    base: SeriesEditBase,
  ) => string | null
  onCancel: () => void
}

/** Alcance da edição de uma ocorrência de série. */
export type EditScope = 'single' | 'series'

/** Tipo de série escolhido no formulário ao criar a conta. */
export interface SeriesChoice {
  kind: SeriesKind
  installmentCount?: number
}

const KIND_OPTIONS: { value: BillKind; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'recurring', label: 'Recorrente' },
  { value: 'installment', label: 'Parcelada' },
]

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
  allowSeries = true,
  occurrence = null,
  onEndSeries,
  onChangeInstallments,
  onSave,
  onCancel,
}: BillFormDialogProps) {
  // Dados da conta como estavam ao abrir: "Usar dados desta conta" e a volta para
  // "Só esta" (com a base da série) restauram exatamente estes valores.
  const [originalDraft] = useState<BillDraft>(() => createDraft(bill))
  const [draft, setDraft] = useState<BillDraft>(originalDraft)
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [scope, setScope] = useState<EditScope>('single')
  /** Base escolhida agora para a nova versão (não guarda histórico de cliques). */
  const [base, setBase] = useState<SeriesEditBase>('account')
  const fieldId = useId()
  const isSeriesScope = Boolean(occurrence) && scope === 'series'
  const seriesData = occurrence?.seriesData ?? null
  const draftMatchesSeries =
    seriesData !== null && draftMatchesSeriesData(draft, seriesData, individual)
  // Com a base da série escolhida, o bloco fica visível mesmo sem diferença: voltar para
  // "Só esta" restaura os dados desta conta, e o aviso disso não pode sumir.
  const showBaseChoice =
    isSeriesScope &&
    seriesData !== null &&
    (base === 'series' ||
      !draftMatchesSeries ||
      !draftMatchesSeriesData(originalDraft, seriesData, individual))
  const inactiveInShares = isSeriesScope
    ? draft.memberIds
        .map((id) => members.find((member) => member.id === id))
        .filter((member): member is Member => Boolean(member?.inactive))
    : []

  const analysis = analyzeDraft(draft, individual)
  const { errors } = analysis
  const isEditing = Boolean(bill)
  const isSeries = !isEditing && draft.kind !== 'normal'
  const selectedCount = draft.memberIds.length
  const showCustomValues = draft.splitMode === 'custom' && selectedCount > 1

  /** Troca de base ou de alcance: mensagens de erro anteriores não valem mais. */
  function replaceDraft(next: BillDraft, nextBase: SeriesEditBase) {
    setDraft(next)
    setBase(nextBase)
    setSubmitAttempted(false)
    setSaveError(null)
  }

  function chooseScope(next: EditScope) {
    // Voltar para "só esta" com a base da série restaura os dados da conta (edições
    // feitas depois também se perdem). Com a base da conta, os campos ficam como estão.
    if (next === 'single' && scope === 'series' && base === 'series') {
      replaceDraft(originalDraft, 'account')
    }
    setScope(next)
  }

  function applySeriesData() {
    if (!seriesData) return
    // O pagamento não faz parte da série: fica como está.
    replaceDraft({ ...draftFromSeriesData(seriesData), paid: draft.paid }, 'series')
  }

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

    let series: SeriesChoice | null = null
    if (isSeries) {
      series =
        draft.kind === 'installment'
          ? { kind: 'installment', installmentCount: analysis.installmentCount ?? undefined }
          : { kind: 'recurring' }
    }
    const error = onSave(
      {
        name: draft.name.trim(),
        month: bill?.month ?? month,
        totalCents: analysis.totalCents,
        dueDay: Number(draft.dueDay),
        shares: analysis.shares,
        paid: draft.paid,
      },
      series,
      scope,
      base,
    )
    setSaveError(error)
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

          {isEditing && occurrence && bill && (
            <fieldset className="field fieldset">
              <legend className="field__label">O que alterar?</legend>
              <div className="segmented" role="group" aria-label="O que alterar?">
                <button
                  type="button"
                  className={`segmented__option ${scope === 'single' ? 'segmented__option--active' : ''}`}
                  aria-pressed={scope === 'single'}
                  onClick={() => chooseScope('single')}
                >
                  Só esta conta
                </button>
                <button
                  type="button"
                  className={`segmented__option ${scope === 'series' ? 'segmented__option--active' : ''}`}
                  aria-pressed={scope === 'series'}
                  disabled={occurrence.seriesEffectiveMonth === null}
                  onClick={() => chooseScope('series')}
                >
                  Esta e as seguintes
                </button>
              </div>
              <p className="field__hint">
                Conta de {formatMonthName(bill.month)} — <strong>{occurrence.label}</strong>.{' '}
                {scope === 'single'
                  ? 'A alteração vale só para esta conta; a série continua igual nos outros meses.'
                  : occurrence.seriesEffectiveMonth !== bill.month
                    ? `Esta conta já está paga e continua igual. Os novos dados valem a partir de ${formatMonthName(occurrence.seriesEffectiveMonth ?? bill.month)}, para as próximas contas da série. Contas pagas não mudam.`
                    : `Os novos dados valem a partir de ${formatMonthName(bill.month)}, para esta e as próximas contas da série. Contas pagas não mudam.`}
                {scope === 'single' &&
                  occurrence.projected &&
                  ' Ao salvar, esta conta prevista passa a ser gravada.'}
                {occurrence.seriesEffectiveMonth === null &&
                  ' “Esta e as seguintes” não está disponível: não há contas seguintes nesta série.'}
              </p>
              {occurrence.canEnd && onEndSeries && (
                <button
                  type="button"
                  className="button button--small button--ghost button--danger-text bill-form__end"
                  onClick={onEndSeries}
                >
                  Encerrar recorrência…
                </button>
              )}
              {occurrence.installment && onChangeInstallments && (
                <button
                  type="button"
                  className="button button--small button--ghost bill-form__end"
                  onClick={onChangeInstallments}
                >
                  Alterar quantidade de parcelas…
                </button>
              )}
            </fieldset>
          )}

          {showBaseChoice && seriesData && occurrence?.seriesEffectiveMonth && (
            <fieldset className="field fieldset">
              <legend className="field__label">Base da nova versão</legend>
              <div className="segmented" role="group" aria-label="Base da nova versão">
                <button
                  type="button"
                  className={`segmented__option ${base === 'series' ? 'segmented__option--active' : ''}`}
                  aria-pressed={base === 'series'}
                  onClick={applySeriesData}
                >
                  Usar dados da série
                </button>
                <button
                  type="button"
                  className={`segmented__option ${base === 'account' ? 'segmented__option--active' : ''}`}
                  aria-pressed={base === 'account'}
                  onClick={() => replaceDraft(originalDraft, 'account')}
                >
                  Usar dados desta conta
                </button>
              </div>
              <p className="field__hint">
                {draftMatchesSeries
                  ? `Os campos estão com os dados da série em ${formatMonthName(occurrence.seriesEffectiveMonth)}.`
                  : `Os campos abaixo não são os dados da série em ${formatMonthName(occurrence.seriesEffectiveMonth)}. Ao confirmar, eles passam a valer para as próximas contas.`}
                {occurrence.overridden && ' Esta conta foi editada individualmente.'}
                {base === 'series' &&
                  ' Se você voltar para “Só esta conta”, os campos voltam aos dados desta conta.'}
              </p>
            </fieldset>
          )}

          {inactiveInShares.length > 0 && (
            <p className="field__error" role="alert">
              {inactiveInShares.length === 1
                ? 'A divisão inclui um participante desativado nesta área: '
                : 'A divisão inclui participantes desativados nesta área: '}
              {inactiveInShares.map((member) => member.name).join(', ')}. Na nova versão só
              entram participantes ativos: ajuste a divisão antes de salvar.
            </p>
          )}

          {!isEditing && (
            <fieldset className="field fieldset">
              <legend className="field__label">Tipo da conta</legend>
              <div className="segmented segmented--three" role="group" aria-label="Tipo da conta">
                {KIND_OPTIONS.map((option) => {
                  const disabled = option.value !== 'normal' && !allowSeries
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`segmented__option ${draft.kind === option.value ? 'segmented__option--active' : ''}`}
                      aria-pressed={draft.kind === option.value}
                      disabled={disabled}
                      onClick={() => update({ kind: option.value })}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
              <p className="field__hint">
                {!allowSeries
                  ? 'Contas recorrentes e parceladas só podem começar no mês atual ou em um mês futuro.'
                  : draft.kind === 'recurring'
                    ? 'Repete todo mês, a partir deste mês. Os próximos meses aparecem como previstos.'
                    : draft.kind === 'installment'
                      ? 'Uma parcela por mês, a partir deste mês. As próximas aparecem como previstas.'
                      : 'Aparece somente neste mês.'}
              </p>
            </fieldset>
          )}

          {isSeries && draft.kind === 'installment' && (
            <div className="field">
              <label htmlFor={`${fieldId}-installments`} className="field__label">
                Quantidade de parcelas
              </label>
              <input
                id={`${fieldId}-installments`}
                className="input input--short"
                inputMode="numeric"
                placeholder="De 2 a 120"
                value={draft.installmentCount}
                onChange={(event) => update({ installmentCount: event.target.value })}
                aria-invalid={submitAttempted && Boolean(errors.installmentCount)}
              />
              {submitAttempted && errors.installmentCount && (
                <p className="field__error">{errors.installmentCount}</p>
              )}
            </div>
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
                {(isSeries && draft.kind === 'installment') ||
                (isSeriesScope && occurrence?.installment)
                  ? 'Valor de cada parcela'
                  : isSeriesScope
                    ? 'Valor de cada conta'
                    : occurrence
                      ? 'Valor desta conta'
                      : 'Valor total'}
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

          {/* "Esta e as seguintes" não muda pagamentos: isso fica no cartão ou em "só esta". */}
          {!isSeriesScope && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.paid}
                onChange={(event) => update({ paid: event.target.checked })}
              />
              <span>Esta conta já foi paga</span>
            </label>
          )}
          {isSeries && (
            <p className="field__hint">
              Vale só para a primeira conta, de {formatMonthName(month)}. As próximas começam
              pendentes.
            </p>
          )}
        </div>

        <div className="modal__footer">
          {submitAttempted && !analysis.isValid && (
            <p className="modal__footer-message">Confira os campos destacados acima.</p>
          )}
          {saveError && (
            <p className="modal__footer-message" role="alert">
              {saveError}
            </p>
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
