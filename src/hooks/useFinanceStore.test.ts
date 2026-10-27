// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bill, FinanceData, Today } from '../domain/types'
import {
  COPY_PAYER_MISSING_MESSAGE,
  COPY_SHARES_CHANGED_MESSAGE,
  confirmationFor,
} from '../domain/commonBills'
import { STORAGE_LOCK_NAME, type LockManagerLike } from '../utils/storageSync'
import { useFinanceStore, type BillInput } from './useFinanceStore'

/** Testes do hook com a gravação protegida: uma aba, outra aba simulada e a trava. */

const KEY = 'gestao-financeira:dados:v1'
const OCTOBER: Today = { month: '2026-10', day: 22 }
const NOVEMBER: Today = { month: '2026-11', day: 1 }

const member = (id: string, name: string) => ({ id, name, emoji: '🙂', color: '#d8ecff' })
const shares = [
  { memberId: 'h1', amountCents: 5000 },
  { memberId: 'h2', amountCents: 5000 },
]

function academia(startMonth = '2026-10') {
  return {
    id: 's-academia',
    kind: 'recurring' as const,
    startMonth,
    versions: [{ fromMonth: startMonth, name: 'Academia', totalCents: 10000, dueDay: 10, shares }],
    skippedMonths: [],
  }
}

function data(homeBills: Bill[] = [], series = [academia()], mineBills: Bill[] = []): FinanceData {
  return {
    version: 3,
    areas: [
      {
        id: 'gastos-da-casa',
        name: 'Gastos da casa',
        type: 'shared',
        members: [member('h1', 'Ana'), member('h2', 'Bia')],
        bills: homeBills,
        series,
      },
      { id: 'minhas-contas', name: 'Minhas contas', type: 'individual', members: [], bills: mineBills, series: [] },
    ],
  }
}

const octoberAcademia: Bill = {
  id: 'a10', name: 'Academia', month: '2026-10', totalCents: 10000, dueDay: 10, shares, paid: false, seriesId: 's-academia',
}

const luz: BillInput = { name: 'Luz', month: '2026-10', totalCents: 8000, dueDay: 5, shares, paid: false }

/** Trava exclusiva em ordem de chegada, como o Web Locks. */
function fakeLocks(): LockManagerLike {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    request(_name, callback) {
      const run = tail.then(() => callback())
      tail = run.catch(() => undefined)
      return run
    },
  }
}

let locks: LockManagerLike | undefined
let writes: number
/** O setItem verdadeiro, guardado antes de qualquer espião. */
const realSetItem = Storage.prototype.setItem

function setLocks(value: LockManagerLike | undefined) {
  locks = value
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true })
}

beforeEach(() => {
  localStorage.clear()
  setLocks(fakeLocks())
  writes = 0
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === KEY) writes++
    realSetItem.call(this, key, value)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Deixa a trava e as gravações assíncronas terminarem. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function store(initial: FinanceData | string | null, today: Today = OCTOBER) {
  if (initial !== null) {
    localStorage.setItem(KEY, typeof initial === 'string' ? initial : JSON.stringify(initial))
  }
  writes = 0
  return renderHook(({ day }) => useFinanceStore(day), { initialProps: { day: today } })
}

const stored = () => localStorage.getItem(KEY)
const parsed = () => JSON.parse(stored() ?? 'null') as FinanceData

describe('gravação protegida no hook', () => {
  it('uma aba: cada ação grava uma vez e a gravação seguinte usa a nova base', async () => {
    const { result } = store(data([octoberAcademia]))
    await settle()
    expect(writes).toBe(0)
    act(() => {
      result.current.addBill('gastos-da-casa', luz)
    })
    expect(result.current.persistenceStatus).toBe('saving')
    await settle()
    expect(writes).toBe(1)
    expect(result.current.persistenceStatus).toBe('saved')
    act(() => {
      result.current.addBill('gastos-da-casa', { ...luz, name: 'Água' })
    })
    await settle()
    expect(writes).toBe(2)
    expect(parsed().areas[0].bills.map((bill) => bill.name)).toEqual(['Academia', 'Luz', 'Água'])
  })

  it('outra aba gravou (sem evento): a ação não sobrescreve e a aba para de gravar', async () => {
    const { result } = store(data([octoberAcademia]))
    await settle()
    localStorage.setItem(KEY, 'da outra aba')
    writes = 0
    act(() => {
      result.current.addBill('gastos-da-casa', luz)
    })
    await settle()
    expect(stored()).toBe('da outra aba')
    expect(writes).toBe(0)
    expect(result.current.persistenceStatus).toBe('conflict')
    act(() => {
      result.current.addBill('gastos-da-casa', { ...luz, name: 'Água' })
    })
    await settle()
    expect(writes).toBe(0)
  })

  it('virada do mês: grava novembro uma vez; com outra aba à frente, não sobrescreve', async () => {
    const tab = store(data([octoberAcademia]))
    await settle()
    tab.rerender({ day: NOVEMBER })
    await settle()
    expect(writes).toBe(1)
    expect(parsed().areas[0].bills.map((bill) => bill.month)).toEqual(['2026-10', '2026-11'])
    tab.unmount()

    localStorage.clear()
    const stale = store(data([octoberAcademia]))
    await settle()
    localStorage.setItem(KEY, 'da outra aba')
    writes = 0
    stale.rerender({ day: NOVEMBER })
    await settle()
    expect(stored()).toBe('da outra aba')
    expect(writes).toBe(0)
    expect(stale.result.current.persistenceStatus).toBe('conflict')
  })

  it('reavaliação do limite: grava com a exclusão; com outra aba à frente, não grava', async () => {
    const filler = (count: number): Bill[] =>
      Array.from({ length: count }, (_, index) => ({
        id: `f-${index}`, name: 'Fixa', month: '2020-01', totalCents: 100, dueDay: 1, shares: [], paid: true,
      }))
    const extra: Bill = { id: 'x', name: 'X', month: '2026-10', totalCents: 100, dueDay: 1, shares: [], paid: true }
    // 20.000 contas e outubro da academia pendente: o limite impede a gravação automática.
    const atLimit = data([], [academia()], [extra, ...filler(19999)])

    const fits = store(atLimit)
    await settle()
    expect(fits.result.current.materializeLimitExceeded).toBe(true)
    act(() => {
      fits.result.current.deleteBill('minhas-contas', 'x')
    })
    await settle()
    expect(writes).toBe(1)
    expect(fits.result.current.materializeLimitExceeded).toBe(false)
    expect(parsed().areas[0].bills.map((bill) => bill.month)).toEqual(['2026-10'])
    fits.unmount()

    localStorage.clear()
    const stale = store(atLimit)
    await settle()
    localStorage.setItem(KEY, 'da outra aba')
    writes = 0
    act(() => {
      stale.result.current.deleteBill('minhas-contas', 'x')
    })
    await settle()
    expect(stored()).toBe('da outra aba')
    expect(writes).toBe(0)
    expect(stale.result.current.persistenceStatus).toBe('conflict')
  }, 20000)

  it('evento storage de outra aba: para de gravar na hora', async () => {
    const { result } = store(data([octoberAcademia]))
    await settle()
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: KEY, newValue: 'da outra aba', storageArea: localStorage }),
      )
    })
    expect(result.current.persistenceStatus).toBe('conflict')
    act(() => {
      result.current.addBill('gastos-da-casa', luz)
    })
    await settle()
    expect(writes).toBe(0)
    // Evento de outra chave não afeta.
    const other = store(data([octoberAcademia]))
    await settle()
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'outra-chave', newValue: 'x', storageArea: localStorage }))
    })
    expect(other.result.current.persistenceStatus).toBe('saved')
  })

  it('falha ao conferir o armazenamento: não grava e para de gravar', async () => {
    const { result } = store(data([octoberAcademia]))
    await settle()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    act(() => {
      result.current.addBill('gastos-da-casa', luz)
    })
    await settle()
    expect(writes).toBe(0)
    expect(result.current.persistenceStatus).toBe('read-failed')
  })

  it('sem Web Locks: nada é gravado', async () => {
    setLocks(undefined)
    const { result } = store(data([octoberAcademia]))
    expect(result.current.persistenceStatus).toBe('unsupported')
    act(() => {
      result.current.addBill('gastos-da-casa', luz)
    })
    await settle()
    expect(writes).toBe(0)
  })

  it('gravações na fila são revalidadas dentro da trava', async () => {
    // Trava ocupada por outra aba; duas ações viram uma única gravação ao liberar.
    const { result } = store(data([octoberAcademia]))
    await settle()
    let release!: () => void
    void locks?.request(STORAGE_LOCK_NAME, () => new Promise<void>((resolve) => (release = resolve)))
    act(() => {
      result.current.addBill('gastos-da-casa', luz)
    })
    act(() => {
      result.current.addBill('gastos-da-casa', { ...luz, name: 'Água' })
    })
    await settle()
    expect(writes).toBe(0)
    release()
    await settle()
    expect(writes).toBe(1)
    expect(parsed().areas[0].bills).toHaveLength(3)

    // A outra aba grava enquanto segura a trava: ao entrar, o pedido encontra o texto novo.
    const stale = store(data([octoberAcademia]))
    await settle()
    let releaseStale!: () => void
    void locks?.request(STORAGE_LOCK_NAME, () => new Promise<void>((resolve) => (releaseStale = resolve)))
    act(() => {
      stale.result.current.addBill('gastos-da-casa', luz)
    })
    await settle()
    expect(stale.result.current.persistenceStatus).toBe('saving')
    localStorage.setItem(KEY, 'da outra aba')
    writes = 0
    releaseStale()
    await settle()
    expect(stored()).toBe('da outra aba')
    expect(writes).toBe(0)
    expect(stale.result.current.persistenceStatus).toBe('conflict')
  })

  it('recuperação: nada automático; a primeira ação confere com o original ilegível', async () => {
    const { result } = store('{ dados inválidos')
    await settle()
    expect(writes).toBe(0)
    expect(result.current.storageIssue?.kind).toBe('recovered')
    expect(Object.keys(localStorage).some((key) => key.startsWith(`${KEY}:recuperacao:`))).toBe(true)
    act(() => {
      result.current.addBill('gastos-da-casa', luz)
    })
    await settle()
    expect(writes).toBe(1)
    expect(result.current.persistenceStatus).toBe('saved')
  })

  it('restauração de backup também é protegida', async () => {
    const { result } = store(data([octoberAcademia]))
    await settle()
    localStorage.setItem(KEY, 'da outra aba')
    writes = 0
    act(() => {
      result.current.replaceAllData(data([], []))
    })
    await settle()
    expect(stored()).toBe('da outra aba')
    expect(writes).toBe(0)
    expect(result.current.persistenceStatus).toBe('conflict')
  })

  it('primeiro uso grava os exemplos uma vez', async () => {
    const { result } = store(null)
    await settle()
    expect(writes).toBe(1)
    expect(result.current.persistenceStatus).toBe('saved')
  })
})

describe('situação da gravação de cada ação (saveStateOf)', () => {
  it('dados abertos estão salvos; uma ação fica "salvando" até a confirmação', async () => {
    const { result } = store(data([octoberAcademia]))
    await settle()
    expect(result.current.saveStateOf(result.current.data)).toBe('saved')
    act(() => {
      result.current.addMember('gastos-da-casa', member('h9', 'Caio'))
    })
    const afterAction = result.current.data
    expect(result.current.saveStateOf(afterAction)).toBe('saving')
    await settle()
    expect(result.current.saveStateOf(afterAction)).toBe('saved')
  })

  it('conflito durante a ação: a alteração fica só na tela ("failed")', async () => {
    const { result } = store(data([octoberAcademia]))
    await settle()
    let release!: () => void
    void locks?.request(STORAGE_LOCK_NAME, () => new Promise<void>((resolve) => (release = resolve)))
    act(() => {
      result.current.addMember('gastos-da-casa', member('h9', 'Caio'))
    })
    const afterAction = result.current.data
    await settle()
    expect(result.current.saveStateOf(afterAction)).toBe('saving')
    // Outra aba grava enquanto o pedido espera a trava.
    localStorage.setItem(KEY, 'da outra aba')
    release()
    await settle()
    expect(result.current.persistenceStatus).toBe('conflict')
    expect(result.current.saveStateOf(afterAction)).toBe('failed')
    expect(stored()).toBe('da outra aba')
  })

  it('falha na gravação: "failed" até uma gravação seguinte dar certo', async () => {
    const { result } = store(data([octoberAcademia]))
    await settle()
    vi.mocked(Storage.prototype.setItem).mockImplementation(function (this: Storage, key, value) {
      if (key === KEY) throw new Error('cota cheia')
      realSetItem.call(this, key, value)
    })
    act(() => {
      result.current.addMember('gastos-da-casa', member('h9', 'Caio'))
    })
    const lost = result.current.data
    await settle()
    expect(result.current.persistenceStatus).toBe('write-failed')
    expect(result.current.saveStateOf(lost)).toBe('failed')
    expect(parsed().areas[0].members).toHaveLength(2)

    // O armazenamento volta a aceitar: a próxima ação grava tudo, inclusive a anterior.
    vi.mocked(Storage.prototype.setItem).mockImplementation(function (this: Storage, key, value) {
      realSetItem.call(this, key, value)
    })
    act(() => {
      result.current.addMember('gastos-da-casa', member('h8', 'Duda'))
    })
    const next = result.current.data
    await settle()
    expect(result.current.persistenceStatus).toBe('saved')
    expect(result.current.saveStateOf(lost)).toBe('saved')
    expect(result.current.saveStateOf(next)).toBe('saved')
    expect(parsed().areas[0].members).toHaveLength(4)
  })

  it('aba bloqueada desde a abertura (sem Web Locks): nenhuma ação é dada como salva', async () => {
    setLocks(undefined)
    const { result } = store(data([octoberAcademia]))
    act(() => {
      result.current.addMember('gastos-da-casa', member('h9', 'Caio'))
    })
    await settle()
    expect(result.current.saveStateOf(result.current.data)).toBe('failed')
  })
})

describe('I2: aumento de parcelas com participante desativado', () => {
  // Compra de agosto a outubro, dividida com Ana, que foi desativada depois.
  const shares3 = [
    { memberId: 'h1', amountCents: 5000 },
    { memberId: 'h2', amountCents: 5000 },
  ]
  function tvData(versionShares = shares3): FinanceData {
    return {
      version: 3,
      areas: [
        {
          id: 'gastos-da-casa',
          name: 'Gastos da casa',
          type: 'shared',
          members: [{ ...member('h1', 'Ana'), inactive: true }, member('h2', 'Bia'), member('h4', 'Duda')],
          bills: ['2026-08', '2026-09', '2026-10'].map((month, index) => ({
            id: `tv${index + 1}`, name: 'TV', month, totalCents: 10000, dueDay: 15,
            shares: versionShares, paid: true, seriesId: 's-tv', installmentNumber: index + 1,
          })),
          series: [{
            id: 's-tv', kind: 'installment', startMonth: '2026-08', installmentCount: 3,
            versions: [{ fromMonth: '2026-08', name: 'TV', totalCents: 10000, dueDay: 15, shares: versionShares }],
            skippedMonths: [],
          }],
        },
        { id: 'minhas-contas', name: 'Minhas contas', type: 'individual', members: [], bills: [], series: [] },
      ],
    }
  }

  it('uma única gravação, sem o desativado nas parcelas novas', async () => {
    const { result } = store(tvData())
    await settle()
    expect(writes).toBe(0)
    act(() => {
      result.current.changeInstallmentCount('gastos-da-casa', 's-tv', 5)
    })
    const afterAction = result.current.data
    expect(result.current.saveStateOf(afterAction)).toBe('saving')
    await settle()
    expect(writes).toBe(1)
    expect(result.current.saveStateOf(afterAction)).toBe('saved')
    const savedTv = parsed().areas[0].series[0]
    expect(savedTv.installmentCount).toBe(5)
    expect(savedTv.versions[1]).toMatchObject({ fromMonth: '2026-11', shares: [{ memberId: 'h2', amountCents: 10000 }] })
    // As parcelas antigas, pagas, ficam como estavam (com Ana).
    expect(parsed().areas[0].bills.filter((bill) => bill.paid)).toHaveLength(3)
  })

  it('pagador obrigatório: sem escolha nada muda; com escolha, grava', async () => {
    const onlyAna = [{ memberId: 'h1', amountCents: 10000 }]
    const { result } = store(tvData(onlyAna))
    await settle()
    let refused: ReturnType<typeof result.current.changeInstallmentCount> | undefined
    act(() => {
      refused = result.current.changeInstallmentCount('gastos-da-casa', 's-tv', 4)
    })
    await settle()
    expect(refused?.ok).toBe(false)
    expect(writes).toBe(0)
    act(() => {
      result.current.changeInstallmentCount('gastos-da-casa', 's-tv', 4, 'h4')
    })
    await settle()
    expect(writes).toBe(1)
    expect(parsed().areas[0].series[0].versions[1].shares).toEqual([{ memberId: 'h4', amountCents: 10000 }])
  })

  it('conflito com outra aba: nada é gravado, nem em parte', async () => {
    const { result } = store(tvData())
    await settle()
    localStorage.setItem(KEY, 'da outra aba')
    writes = 0
    act(() => {
      result.current.changeInstallmentCount('gastos-da-casa', 's-tv', 5)
    })
    await settle()
    expect(writes).toBe(0)
    expect(stored()).toBe('da outra aba')
    expect(result.current.saveStateOf(result.current.data)).toBe('failed')
  })

  it('falha de gravação na mudança de quantidade: nada gravado, nem em parte', async () => {
    const { result } = store(tvData())
    await settle()
    const original = stored()
    vi.mocked(Storage.prototype.setItem).mockImplementation(function (this: Storage, key, value) {
      if (key === KEY) throw new Error('cota cheia')
      realSetItem.call(this, key, value)
    })
    act(() => {
      result.current.changeInstallmentCount('gastos-da-casa', 's-tv', 5)
    })
    const afterAction = result.current.data
    await settle()
    expect(result.current.persistenceStatus).toBe('write-failed')
    expect(result.current.saveStateOf(afterAction)).toBe('failed')
    // O armazenamento ficou exatamente como antes: nem a quantidade nem a versão nova.
    expect(stored()).toBe(original)

    // O armazenamento volta a aceitar: a próxima alteração grava tudo de uma vez.
    vi.mocked(Storage.prototype.setItem).mockImplementation(function (this: Storage, key, value) {
      realSetItem.call(this, key, value)
    })
    act(() => {
      result.current.addMember('gastos-da-casa', member('h9', 'Caio'))
    })
    await settle()
    expect(result.current.saveStateOf(afterAction)).toBe('saved')
    const saved = parsed().areas[0]
    expect(saved.series[0].installmentCount).toBe(5)
    expect(saved.series[0].versions).toHaveLength(2)
    expect(saved.members.some((item) => item.id === 'h9')).toBe(true)
  })
})

describe('I3: copiar o mês anterior com participante desativado', () => {
  // Outubro: Luz (paga) de Ana e Bia; Água só de Ana. Duda também participa.
  function copyData(anaInactive = true): FinanceData {
    const ana = member('h1', 'Ana')
    return {
      version: 3,
      areas: [
        {
          id: 'gastos-da-casa',
          name: 'Gastos da casa',
          type: 'shared',
          members: [anaInactive ? { ...ana, inactive: true } : ana, member('h2', 'Bia'), member('h4', 'Duda')],
          bills: [
            {
              id: 'luz', name: 'Luz', month: '2026-10', totalCents: 9001, dueDay: 5, paid: true,
              shares: [
                { memberId: 'h1', amountCents: 4500 },
                { memberId: 'h2', amountCents: 4501 },
              ],
            },
            {
              id: 'agua', name: 'Água', month: '2026-10', totalCents: 6000, dueDay: 8, paid: false,
              shares: [{ memberId: 'h1', amountCents: 6000 }],
            },
          ],
          series: [],
        },
        { id: 'minhas-contas', name: 'Minhas contas', type: 'individual', members: [], bills: [], series: [] },
      ],
    }
  }

  function planOf(result: { current: ReturnType<typeof useFinanceStore> }) {
    const planned = result.current.planCopyBillsFrom('gastos-da-casa', '2026-10')
    if (!planned.ok) throw new Error(planned.error)
    return planned.plan
  }

  it('cópia com ajuste: uma única gravação, sem a desativada, e outubro intacto', async () => {
    const { result } = store(copyData())
    await settle()
    const original = parsed().areas[0].bills
    const plan = planOf(result)
    expect(plan.adjusted.map((item) => item.kind)).toEqual(['redistribute', 'payer'])
    let error: string | null = 'não chamado'
    act(() => {
      error = result.current.copyBills('gastos-da-casa', '2026-10', '2026-11', confirmationFor(plan, 'h4'))
    })
    const afterAction = result.current.data
    await settle()
    expect(error).toBeNull()
    expect(writes).toBe(1)
    expect(result.current.saveStateOf(afterAction)).toBe('saved')
    const bills = parsed().areas[0].bills
    expect(bills.slice(0, 2)).toEqual(original)
    expect(bills.slice(2).map((bill) => [bill.name, bill.paid, bill.shares])).toEqual([
      ['Luz', false, [{ memberId: 'h2', amountCents: 9001 }]],
      ['Água', false, [{ memberId: 'h4', amountCents: 6000 }]],
    ])
  })

  it('sem pagador escolhido: recusa e nada é gravado', async () => {
    const { result } = store(copyData())
    await settle()
    const original = stored()
    let error: string | null = null
    act(() => {
      error = result.current.copyBills('gastos-da-casa', '2026-10', '2026-11', confirmationFor(planOf(result)))
    })
    await settle()
    expect(error).toBe(COPY_PAYER_MISSING_MESSAGE)
    expect(writes).toBe(0)
    expect(stored()).toBe(original)
  })

  it('falha de gravação na cópia: nada gravado, nem em parte', async () => {
    const { result } = store(copyData())
    await settle()
    const original = stored()
    const plan = planOf(result)
    vi.mocked(Storage.prototype.setItem).mockImplementation(function (this: Storage, key, value) {
      if (key === KEY) throw new Error('cota cheia')
      realSetItem.call(this, key, value)
    })
    act(() => {
      result.current.copyBills('gastos-da-casa', '2026-10', '2026-11', confirmationFor(plan, 'h4'))
    })
    const afterAction = result.current.data
    await settle()
    expect(result.current.persistenceStatus).toBe('write-failed')
    expect(result.current.saveStateOf(afterAction)).toBe('failed')
    expect(stored()).toBe(original)

    // O armazenamento volta a aceitar: a próxima alteração grava as cópias junto.
    vi.mocked(Storage.prototype.setItem).mockImplementation(function (this: Storage, key, value) {
      realSetItem.call(this, key, value)
    })
    act(() => {
      result.current.addMember('gastos-da-casa', member('h9', 'Caio'))
    })
    await settle()
    expect(result.current.saveStateOf(afterAction)).toBe('saved')
    expect(parsed().areas[0].bills.filter((bill) => bill.month === '2026-11')).toHaveLength(2)
  })

  it('desativação entre o resumo e a confirmação: recusa sem gravar a cópia', async () => {
    const { result } = store(copyData(false))
    await settle()
    const seen = planOf(result)
    expect(seen.adjusted).toEqual([])
    act(() => {
      result.current.deactivateMember('gastos-da-casa', 'h1', null, {})
    })
    await settle()
    expect(writes).toBe(1)
    const afterDeactivation = stored()
    let error: string | null = null
    act(() => {
      error = result.current.copyBills('gastos-da-casa', '2026-10', '2026-11', confirmationFor(seen))
    })
    await settle()
    expect(error).toBe(COPY_SHARES_CHANGED_MESSAGE)
    expect(writes).toBe(1)
    expect(stored()).toBe(afterDeactivation)
  })
})

describe('M6: "esta e as seguintes" a partir de conta editada individualmente', () => {
  // Outubro foi editado só para ele (R$ 90,00, só Ana); novembro também, só Bia.
  const october: Bill = {
    ...octoberAcademia, totalCents: 9000, shares: [{ memberId: 'h1', amountCents: 9000 }], overridden: true,
  }
  const november: Bill = {
    ...octoberAcademia, id: 'a11', month: '2026-11', totalCents: 7000,
    shares: [{ memberId: 'h2', amountCents: 7000 }], overridden: true,
  }
  const seriesData = { name: 'Academia', totalCents: 10000, dueDay: 10, shares }
  const accountData = { name: 'Academia', totalCents: 9000, dueDay: 10, shares: october.shares }
  const homeOf = () => parsed().areas[0]

  function edit(
    result: { current: ReturnType<typeof useFinanceStore> },
    input: typeof seriesData,
    choice: 'preserve' | 'replace' | null = 'preserve',
  ) {
    let outcome: ReturnType<typeof result.current.editSeriesFrom> | undefined
    act(() => {
      outcome = result.current.editSeriesFrom('gastos-da-casa', 's-academia', '2026-10', input, choice)
    })
    return outcome
  }

  it('dados da série: uma gravação; a conta volta a seguir a série e a série não muda', async () => {
    const { result } = store(data([october, november]))
    await settle()
    expect(edit(result, seriesData)?.ok).toBe(true)
    await settle()
    expect(writes).toBe(1)
    const saved = homeOf()
    expect(saved.series[0].versions).toEqual(academia().versions)
    expect(saved.bills[0]).toEqual({ ...octoberAcademia })
    // "Preservar": novembro continua com a edição individual.
    expect(saved.bills[1]).toEqual(november)
  })

  it('dados desta conta e valores editados: uma gravação cada, com a versão esperada', async () => {
    const { result } = store(data([october]))
    await settle()
    edit(result, accountData, null)
    await settle()
    expect(writes).toBe(1)
    expect(homeOf().series[0].versions).toEqual([{ fromMonth: '2026-10', ...accountData }])
    expect(homeOf().bills[0].overridden).toBeUndefined()

    const edited = { ...accountData, dueDay: 12 }
    edit(result, edited, null)
    await settle()
    expect(writes).toBe(2)
    expect(homeOf().series[0].versions).toEqual([{ fromMonth: '2026-10', ...edited }])
  })

  it('"substituir" tira a marca das outras contas, como antes', async () => {
    const { result } = store(data([october, november]))
    await settle()
    edit(result, seriesData, 'replace')
    await settle()
    const replaced = homeOf().bills[1]
    expect(replaced.overridden).toBeUndefined()
    expect(replaced.totalCents).toBe(10000)
  })

  it('conta escolhida paga continua igual, com a marca', async () => {
    const paid = { ...october, paid: true }
    const { result } = store(data([paid]))
    await settle()
    edit(result, { ...seriesData, totalCents: 12000, shares: [
      { memberId: 'h1', amountCents: 6000 },
      { memberId: 'h2', amountCents: 6000 },
    ] }, null)
    await settle()
    expect(writes).toBe(1)
    expect(homeOf().bills[0]).toEqual(paid)
    expect(homeOf().series[0].versions[1].fromMonth).toBe('2026-11')
  })

  it('dados da série com participante desativado: recusa e nada é gravado', async () => {
    const withInactive = data([october])
    withInactive.areas[0].members = [member('h1', 'Ana'), { ...member('h2', 'Bia'), inactive: true }]
    const { result } = store(withInactive)
    await settle()
    const original = stored()
    expect(edit(result, seriesData, null)?.ok).toBe(false)
    await settle()
    expect(writes).toBe(0)
    expect(stored()).toBe(original)
  })

  it('falha de gravação: nada gravado, nem em parte', async () => {
    const { result } = store(data([october, november]))
    await settle()
    const original = stored()
    vi.mocked(Storage.prototype.setItem).mockImplementation(function (this: Storage, key, value) {
      if (key === KEY) throw new Error('cota cheia')
      realSetItem.call(this, key, value)
    })
    edit(result, seriesData)
    const afterAction = result.current.data
    await settle()
    expect(result.current.persistenceStatus).toBe('write-failed')
    expect(result.current.saveStateOf(afterAction)).toBe('failed')
    expect(stored()).toBe(original)
  })
})
