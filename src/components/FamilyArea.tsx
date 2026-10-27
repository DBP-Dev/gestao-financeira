import { useId, useState, type ReactNode } from 'react'
import type { Bill } from '../domain/types'
import { getBillsTotals } from '../domain/billTotals'
import { formatBRL } from '../domain/money'

interface FamilyAreaProps {
  /** Nome exibido no cabeçalho. Padrão: a área fixa "Gastos da casa". */
  name?: string
  /** Texto abaixo do nome. Padrão: quantidade de membros (`memberCount`). */
  meta?: ReactNode
  memberCount?: number
  /** Contas do mês selecionado (mesma lista usada pelo resumo completo). */
  bills: Bill[]
  /** Avisos de vencimento exibidos no lugar de total e pendente do cabeçalho (pode ser vazio). */
  notices?: ReactNode
  /**
   * Quando os avisos substituem total e pendente: "always" (aberta e recolhida) ou
   * "expanded" (só aberta; recolhida mostra total e pendente).
   */
  noticesWhen?: 'always' | 'expanded'
  /**
   * Se informado, o segundo indicador vira "Minha parte" no lugar de "Pendente":
   * soma das parcelas do usuário no mês (centavos) ou null quando não se sabe quem é ele ("—").
   */
  myShareCents?: number | null
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
  notices,
  noticesWhen = 'always',
  myShareCents,
  children,
}: FamilyAreaProps) {
  // Sempre começa recolhida ao abrir ou recarregar o aplicativo.
  const [expanded, setExpanded] = useState(false)
  const showNotices = notices !== undefined && (noticesWhen === 'always' || expanded)
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
          </span>
          {showNotices ? (
            <span className="area__notices">{notices}</span>
          ) : (
            <span className="area__figures">
              <span className="area__figure">
                <span className="area__figure-label">Total do mês</span>
                <span className="area__figure-value">{formatBRL(totalCents)}</span>
              </span>
              {myShareCents === undefined ? (
                <span className="area__figure">
                  <span className="area__figure-label">Pendente</span>
                  <span className="area__figure-value">{formatBRL(pendingCents)}</span>
                </span>
              ) : (
                <span className="area__figure">
                  <span className="area__figure-label">Minha parte</span>
                  <span className="area__figure-value">
                    {myShareCents === null ? '—' : formatBRL(myShareCents)}
                  </span>
                </span>
              )}
            </span>
          )}
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
