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

/** R$ 1 bilhão: maior valor aceito no formulário e no backup. */
export const MAX_AMOUNT_CENTS = 100_000_000_000

/** Inteiro com pontos de milhar corretos: "1.500", "12.345.678". */
const GROUPED_THOUSANDS = /^\d{1,3}(\.\d{3})+$/
/** Brasileiro: "1500,50", "1.500,5", ",50" (vírgula com 1 ou 2 casas). */
const BRAZILIAN = /^(\d*|\d{1,3}(?:\.\d{3})+),(\d{1,2})$/
/** Americano já aceito antes: "120.50", "1.5", ".50" (um ponto com 1 ou 2 casas). */
const DOT_DECIMAL = /^(\d*)\.(\d{1,2})$/

/**
 * Lê um valor digitado pela pessoa e devolve em centavos.
 * Aceita "1500", "1.500", "1.500,00", "1500,5", ",50", "R$ 1.234,56" e "120.50".
 * Devolve null para texto vazio, malformado ou ambíguo ("1.5.0", "1.2,50", "0,001")
 * e para valores acima de R$ 1 bilhão.
 */
export function parseMoneyInput(text: string): number | null {
  const cleaned = text.trim().replace(/^R\$\s*/i, '')
  if (!cleaned) return null

  let integerPart: string
  let decimalPart = ''
  const brazilian = BRAZILIAN.exec(cleaned)
  const dotDecimal = DOT_DECIMAL.exec(cleaned)

  if (brazilian) {
    integerPart = brazilian[1].replace(/\./g, '')
    decimalPart = brazilian[2]
  } else if (/^\d+$/.test(cleaned) || GROUPED_THOUSANDS.test(cleaned)) {
    integerPart = cleaned.replace(/\./g, '')
  } else if (dotDecimal) {
    integerPart = dotDecimal[1]
    decimalPart = dotDecimal[2]
  } else {
    return null
  }

  if (!integerPart && !decimalPart) return null

  // Limita o tamanho antes de converter, para nunca perder precisão.
  const digits = integerPart.replace(/^0+/, '')
  if (digits.length > 12) return null

  const cents = Number(digits || '0') * 100 + Number(decimalPart.padEnd(2, '0') || '0')
  return cents <= MAX_AMOUNT_CENTS ? cents : null
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
