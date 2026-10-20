const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

/** Formata centavos como reais: 150000 → "R$ 1.500,00". */
export function formatBRL(cents: number): string {
  return brlFormatter.format(cents / 100)
}

/** Converte centavos para o texto usado nos campos: 150000 → "1500,00". */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}

/**
 * Lê um valor digitado pela pessoa e devolve em centavos.
 * Aceita "1.500,00", "1500,5", "1500", "R$ 120,00" e "120.50".
 * Devolve null quando o texto não é um valor válido.
 */
export function parseMoneyInput(text: string): number | null {
  const cleaned = text.replace(/[R$\s]/g, '')
  if (!cleaned) return null

  let normalized: string
  if (cleaned.includes(',')) {
    // Padrão brasileiro: ponto separa milhar e vírgula separa centavos.
    normalized = cleaned.replace(/\./g, '').replace(',', '.')
  } else {
    const parts = cleaned.split('.')
    const looksLikeDecimal = parts.length === 2 && parts[1].length <= 2
    normalized = looksLikeDecimal ? cleaned : cleaned.replace(/\./g, '')
  }

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  return Math.round(Number(normalized) * 100)
}

/**
 * Divide um valor igualmente entre várias pessoas.
 * Os centavos que sobram vão para as primeiras pessoas,
 * garantindo que a soma seja sempre igual ao total.
 */
export function splitEvenly(totalCents: number, count: number): number[] {
  if (count <= 0) return []
  const base = Math.floor(totalCents / count)
  const remainder = totalCents - base * count
  return Array.from({ length: count }, (_, index) =>
    index < remainder ? base + 1 : base,
  )
}
