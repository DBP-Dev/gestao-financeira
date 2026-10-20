import type { Area } from '../types'
import { AREA_TYPE_LABEL } from '../utils/areas'

interface AreaCardProps {
  area: Area
}

/**
 * Cartão de uma área criada pela pessoa. Mostra só os dados da própria área.
 * O lançamento de contas em novas áreas ainda não existe, então não há botões
 * nem valores simulados.
 */
export function AreaCard({ area }: AreaCardProps) {
  const memberCount = area.members.length
  return (
    <article className="area-card" aria-label={`Área ${area.name}`}>
      <div className="area-card__header">
        <h3 className="area-card__name">{area.name}</h3>
        <span className="tag">{AREA_TYPE_LABEL[area.type]}</span>
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
      <p className="area-card__empty">
        {area.bills.length === 0
          ? 'Nenhuma conta nesta área ainda. O lançamento de contas em novas áreas ainda não está disponível.'
          : `${area.bills.length} contas nesta área.`}
      </p>
    </article>
  )
}
