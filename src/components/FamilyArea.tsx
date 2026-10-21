import { useId, useState, type ReactNode } from 'react'
import type { Bill } from '../types'
import { getBillsTotals } from '../utils/billTotals'
import { formatBRL } from '../utils/money'

interface FamilyAreaProps {
  /** Nome exibido no cabeçalho. Padrão: a área fixa "Gastos da casa". */
  name?: string
  /** Texto abaixo do nome. Padrão: quantidade de membros (`memberCount`). */
  meta?: ReactNode
  memberCount?: number
  /** Contas do mês selecionado (mesma lista usada pelo resumo completo). */
  bills: Bill[]
  /** Quantidade de contas atrasadas de meses anteriores (mesma lista do alerta completo). */
  overdueCount: number
  /** Conteúdo completo da área: resumo, membros e contas. */
  children: ReactNode
}

/**
 * Área recolhível: cabeçalho compacto e conteúdo completo ao expandir.
 * O título é sempre h3, pois toda área fica dentro de uma box ("Contas individuais"
 * ou "Contas compartilhadas"), cujo título é h2.
 */
export function FamilyArea({
  name = 'Gastos da casa',
  meta,
  memberCount = 0,
  bills,
  overdueCount,
  children,
}: FamilyAreaProps) {
  // Sempre começa recolhida ao abrir ou recarregar o aplicativo.
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()
  const { totalCents, pendingCents } = getBillsTotals(bills)

  return (
    <section className={`area ${expanded ? 'area--expanded' : ''}`}>
      <h3 className="area__heading">
        <button
          type="button"
          className="area__toggle"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((current) => !current)}
        >
          <span className="area__identity">
            <span className="area__name">{name}</span>
            <span className="area__meta">
              {meta ?? (memberCount === 1 ? '1 membro' : `${memberCount} membros`)}
            </span>
            {overdueCount > 0 && (
              <span className="tag tag--late area__overdue">
                ! {overdueCount === 1 ? '1 conta atrasada' : `${overdueCount} contas atrasadas`}
              </span>
            )}
          </span>
          <span className="area__figures">
            <span className="area__figure">
              <span className="area__figure-label">Total do mês</span>
              <span className="area__figure-value">{formatBRL(totalCents)}</span>
            </span>
            <span className="area__figure">
              <span className="area__figure-label">Pendente</span>
              <span className="area__figure-value">{formatBRL(pendingCents)}</span>
            </span>
          </span>
          <svg
            className="area__chevron"
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </h3>

      <div id={contentId} className="area__content" hidden={!expanded}>
        {expanded && children}
      </div>
    </section>
  )
}
