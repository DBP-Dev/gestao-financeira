import type { ReactNode } from 'react'
import type { Area, Bill } from '../types'
import { AREA_TYPE_LABEL } from '../utils/areas'
import { FamilyArea } from './FamilyArea'

interface AreaCardProps {
  area: Area
  /** Contas desta área no mês selecionado (para total e pendente do cabeçalho). */
  monthBills: Bill[]
  /** Avisos de vencimento exibidos no lugar de total e pendente do cabeçalho. */
  notices?: ReactNode
  /** Quando os avisos aparecem: "always" ou só com a área aberta ("expanded"). */
  noticesWhen?: 'always' | 'expanded'
  /** "Minha parte" no lugar de "Pendente" (null = não se sabe quem é o usuário: "—"). */
  myShareCents?: number | null
  /** Conteúdo da área (lista de contas, com a ação "Excluir área"). Só dados da própria área. */
  children: ReactNode
}

function describeArea(area: Area): string {
  if (area.type === 'individual') return AREA_TYPE_LABEL.individual
  const count = area.members.length
  const participants =
    count === 0 ? 'Nenhum participante ainda' : count === 1 ? '1 participante' : `${count} participantes`
  return `${AREA_TYPE_LABEL.shared} · ${participants}`
}

/** Área criada pela pessoa, com o mesmo comportamento recolhível de "Gastos da casa". */
export function AreaCard({
  area,
  monthBills,
  notices,
  noticesWhen,
  myShareCents,
  children,
}: AreaCardProps) {
  return (
    <FamilyArea
      name={area.name}
      meta={describeArea(area)}
      bills={monthBills}
      notices={notices}
      noticesWhen={noticesWhen}
      myShareCents={myShareCents}
    >
      {children}
    </FamilyArea>
  )
}
