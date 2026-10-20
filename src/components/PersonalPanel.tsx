import { useId } from 'react'
import type { Bill, Member } from '../types'
import { formatBRL } from '../utils/money'
import { getMemberShareTotals } from '../utils/personal'
import { Avatar } from './Avatar'

interface PersonalPanelProps {
  /** Contas do mês selecionado (mesma lista usada pela Área Família). */
  bills: Bill[]
  members: Member[]
  monthName: string
  /** Integrante atual (useCurrentMember), ou null quando ainda não foi escolhido. */
  member: Member | null
  onChooseMember: (id: string) => void
}

interface PersonalArea {
  id: string
  label: string
  totalCents: number
  pendingCents: number
}

/** Cartão com a parte do integrante atual nas contas do mês. Somente leitura. */
export function PersonalPanel({
  bills,
  members,
  monthName,
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
          ! Não encontramos o integrante “Eu” nos dados. Escolha quem é você para ver a sua parte
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
            {members.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
      </section>
    )
  }

  const family = getMemberShareTotals(member.id, bills)
  // Por enquanto só existe a Área Família; novas áreas entrarão nesta lista.
  const areas: PersonalArea[] = [{ id: 'familia', label: 'Gastos da casa', ...family }]
  const totalCents = areas.reduce((sum, area) => sum + area.totalCents, 0)
  const pendingCents = areas.reduce((sum, area) => sum + area.pendingCents, 0)
  const barLabel =
    totalCents > 0
      ? `Distribuição da sua parte: ${areas
          .map((area) => `${area.label} ${formatBRL(area.totalCents)}`)
          .join(', ')}`
      : 'Nenhuma conta sua neste mês'

  return (
    <section className="personal-panel" aria-labelledby={titleId}>
      <div className="personal-panel__identity">
        <Avatar member={member} size="large" />
        <div>
          <h2 id={titleId} className="personal-panel__title">
            Meu painel · {member.name}
          </h2>
          <p className="personal-panel__hint">Sua parte das contas de {monthName}</p>
        </div>
      </div>

      <ul className="personal-panel__areas">
        {areas.map((area) => (
          <li key={area.id} className="personal-area">
            <span className="personal-area__name">{area.label}</span>
            <strong className="personal-area__total">{formatBRL(area.totalCents)}</strong>
            {area.totalCents === 0 ? (
              <span className="member-card__muted">Sem contas suas</span>
            ) : area.pendingCents === 0 ? (
              <span className="tag tag--paid">✓ Tudo pago</span>
            ) : (
              <span className="tag tag--pending">○ Falta {formatBRL(area.pendingCents)}</span>
            )}
          </li>
        ))}
      </ul>

      <dl className="personal-panel__totals">
        <div className="personal-panel__total">
          <dt>Meu total</dt>
          <dd>{formatBRL(totalCents)}</dd>
        </div>
        <div className="personal-panel__total personal-panel__total--pending">
          <dt>Pendente</dt>
          <dd>{formatBRL(pendingCents)}</dd>
        </div>
      </dl>

      <div className="personal-panel__distribution">
        <div className="segmented-bar" role="img" aria-label={barLabel}>
          {totalCents > 0 &&
            areas
              .filter((area) => area.totalCents > 0)
              .map((area) => (
                <span
                  key={area.id}
                  className={`segmented-bar__segment segmented-bar__segment--${area.id}`}
                  // A largura é proporcional aos centavos, sem arredondar porcentagens.
                  style={{ flexGrow: area.totalCents }}
                />
              ))}
        </div>
        {totalCents === 0 ? (
          <p className="personal-panel__hint">Nenhuma conta sua em {monthName}.</p>
        ) : (
          <ul className="legend" aria-hidden="true">
            {areas.map((area) => (
              <li key={area.id} className="legend__item">
                <span className={`legend__dot segmented-bar__segment--${area.id}`} />
                {area.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
