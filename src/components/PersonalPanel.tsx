import { useId } from 'react'
import type { Member, Today } from '../domain/types'
import { formatAlertDate, visibleAlerts, type DueAlert, type DueAlerts } from '../domain/dueAlerts'
import { formatBRL } from '../domain/money'
import type { PersonalMonthSummary } from '../domain/personal'
import { Avatar } from './Avatar'

interface PersonalPanelProps {
  /** Resumo do mês selecionado (getPersonalMonthSummary); null enquanto não há perfil. */
  summary: PersonalMonthSummary | null
  /** Contas em atraso e próximas do vencimento (getDueAlerts); null enquanto não há perfil. */
  alerts: DueAlerts | null
  /** Data de hoje, para mostrar o ano só quando o vencimento é de outro ano. */
  today: Today
  members: Member[]
  /** Integrante atual (useCurrentMember), ou null quando ainda não foi escolhido. */
  member: Member | null
  onChooseMember: (id: string) => void
}

/**
 * Cartão com a sua parte nas contas do mês (o mês já aparece no cabeçalho). Somente
 * leitura. Sem perfil, pede para escolher quem é você.
 */
export function PersonalPanel({
  summary,
  alerts,
  today,
  members,
  member,
  onChooseMember,
}: PersonalPanelProps) {
  const titleId = useId()
  const selectId = useId()

  if (!member) {
    return (
      <section className="personal-panel personal-panel--choose" aria-labelledby={titleId}>
        <h2 id={titleId} className="personal-panel__title">
          Meu painel
        </h2>
        <p className="personal-panel__hint">
          Não encontramos o integrante “Eu” nos dados. Escolha quem é você para ver a sua parte
          das contas. Essa escolha fica salva só neste aparelho.
        </p>
        <div className="field personal-panel__choose">
          <label htmlFor={selectId} className="field__label">
            Quem é você?
          </label>
          <select
            id={selectId}
            className="input"
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) onChooseMember(event.target.value)
            }}
          >
            <option value="" disabled>
              Escolha um integrante
            </option>
            {members.filter((option) => !option.inactive).map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
      </section>
    )
  }

  if (!summary) return null

  const message =
    summary.monthTotalCents === 0
      ? 'Nenhuma conta neste mês.'
      : summary.shareCents === 0
        ? 'Nenhuma conta sua neste mês.'
        : null
  const hasAlerts = alerts !== null && (alerts.overdue.length > 0 || alerts.dueSoon.length > 0)

  return (
    <section className="personal-panel" aria-labelledby={titleId}>
      <div className="personal-panel__identity">
        <Avatar member={member} size="small" />
        <h2 id={titleId} className="personal-panel__title">
          {member.name}
        </h2>
      </div>

      <div className="personal-panel__share">
        <span className="personal-panel__label">Sua parte</span>
        <strong className="personal-panel__share-value">{formatBRL(summary.shareCents)}</strong>
      </div>

      <dl className="personal-panel__totals">
        <div className="personal-panel__total">
          <dt>Pago</dt>
          <dd>{formatBRL(summary.paidCents)}</dd>
        </div>
        <div className="personal-panel__total personal-panel__total--pending">
          <dt>Pendente</dt>
          <dd>{formatBRL(summary.pendingCents)}</dd>
        </div>
      </dl>

      <div className="personal-panel__notes">
        {hasAlerts && (
          <div className="personal-panel__alerts">
            <AlertSection title="Contas em atraso" items={alerts.overdue} today={today} late />
            <AlertSection title="Próximas do vencimento" items={alerts.dueSoon} today={today} />
          </div>
        )}
        {message && <p className="personal-panel__hint">{message}</p>}
        <p className="personal-panel__grand-total">
          Total de todas as contas do mês: <strong>{formatBRL(summary.monthTotalCents)}</strong>
        </p>
      </div>
    </section>
  )
}

/** Uma seção de alertas: só aparece com itens; mostra até três e conta os demais. */
function AlertSection({
  title,
  items,
  today,
  late = false,
}: {
  title: string
  items: DueAlert[]
  today: Today
  late?: boolean
}) {
  const titleId = useId()
  if (items.length === 0) return null
  const { shown, hidden } = visibleAlerts(items)
  return (
    <section
      className={late ? 'personal-alerts personal-alerts--late' : 'personal-alerts'}
      aria-labelledby={titleId}
    >
      <h3 id={titleId} className="personal-alerts__title">
        {title}
      </h3>
      <ul className="personal-alerts__list">
        {shown.map((item) => (
          <li key={`${item.areaId}:${item.billId}`} className="personal-alerts__item">
            <span className="personal-alerts__bill">
              <span className="personal-alerts__area">{item.areaName}</span> · {item.billName}
            </span>
            <span className="personal-alerts__date">{formatAlertDate(item, today)}</span>
          </li>
        ))}
      </ul>
      {hidden > 0 && <p className="personal-alerts__more">e mais {hidden}</p>}
    </section>
  )
}
