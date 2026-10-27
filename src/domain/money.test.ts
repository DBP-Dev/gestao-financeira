import { describe, expect, it } from 'vitest'
import { splitEvenly } from './money'

describe('splitEvenly', () => {
  it('divide igualmente quando não sobram centavos', () => {
    expect(splitEvenly(10000, 4)).toEqual([2500, 2500, 2500, 2500])
  })

  it('dá os centavos que sobram às primeiras pessoas, sem mudar a soma', () => {
    const parts = splitEvenly(10001, 2)
    expect(parts).toEqual([5001, 5000])
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(10001)
  })

  it('não divide entre zero pessoas', () => {
    expect(splitEvenly(10000, 0)).toEqual([])
  })
})
