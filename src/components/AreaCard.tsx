import type { ReactNode } from 'react'
import type { Area } from '../types'
import { AREA_TYPE_LABEL } from '../utils/areas'

interface AreaCardProps {
  area: Area
  /** Abre a confirmação de exclusão da área. */
  onDelete: () => void
  /** Conteúdo da área (lista de contas). Mostra só dados da própria área. */
  children: ReactNode
}

/** Cartão de uma área criada pela pessoa. */
export function AreaCard({ area, onDelete, children }: AreaCardProps) {
  const memberCount = area.members.length
  return (
    <article className="area-card" aria-label={`Área ${area.name}`}>
      <div className="area-card__header">
        <h3 className="area-card__name">{area.name}</h3>
        <div className="area-card__header-actions">
          <span className="tag">{AREA_TYPE_LABEL[area.type]}</span>
          <button
            type="button"
            className="button button--small button--ghost button--danger-text"
            onClick={onDelete}
            aria-label={`Excluir a área ${area.name}`}
          >
            Excluir área
          </button>
        </div>
      </div>
      {area.type === 'shared' && (
        <p className="area-card__meta">
          {memberCount === 0
            ? 'Nenhum participante ainda'
            : memberCount === 1
              ? '1 participante'
              : `${memberCount} participantes`}
        </p>
      )}
      <div className="area-card__content">{children}</div>
    </article>
  )
}
