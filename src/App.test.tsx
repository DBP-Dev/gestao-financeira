// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { CopyBillsDialog } from './components/CopyBillsDialog'
import type { Bill, FinanceData } from './types'
import { createBackup } from './utils/backup'
import { COPY_SHARES_CHANGED_MESSAGE, type CopyBillsPlan } from './utils/commonBills'
import type { LockManagerLike } from './utils/storageSync'

/**
 * Mensagens de ações que alteram os dados, na interface: só dizem "salva" depois da
 * gravação protegida; em conflito ou falha, dizem que a alteração ficou só nesta tela.
 */

const KEY = 'gestao-financeira:dados:v1'
const member = (id: string, name: string) => ({ id, name, emoji: '🙂', color: '#d8ecff' })

function data(): FinanceData {
  return {
    version: 3,
    areas: [
      {
        id: 'gastos-da-casa',
        name: 'Gastos da casa',
        type: 'shared',
        members: [member('h1', 'Ana'), member('h2', 'Bia')],
        bills: [],
        series: [],
      },
      { id: 'minhas-contas', name: 'Minhas contas', type: 'individual', members: [], bills: [], series: [] },
    ],
  }
}

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

beforeAll(() => {
  // O jsdom não implementa a janela modal nativa; basta abrir e fechar o <dialog>.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(navigator, 'locks', { value: fakeLocks(), configurable: true })
  localStorage.setItem(KEY, JSON.stringify(data()))
  localStorage.setItem('gestao-financeira:perfil:v1', 'h2')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function addMember(name: string) {
  // As áreas começam recolhidas.
  document.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]').forEach((button) => {
    fireEvent.click(button)
  })
  fireEvent.click(screen.getAllByRole('button', { name: '＋ Adicionar membro' })[0])
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar membro' }))
}

async function restoreBackup(backup: FinanceData) {
  fireEvent.click(screen.getByRole('button', { name: 'Backup dos dados' }))
  const file = new File([JSON.stringify(createBackup(backup, new Date()))], 'backup.json', {
    type: 'application/json',
  })
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } })
  })
  await screen.findByRole('button', { name: 'Sim, substituir meus dados' })
}

describe('mensagens que dependem da gravação protegida', () => {
  it('membro adicionado: "salvando" e, depois da confirmação, "salva"', async () => {
    render(<App />)
    await settle()
    await addMember('Caio')
    expect(screen.getByText('Membro adicionado. Salvando…')).toBeTruthy()
    expect(screen.queryByText(/✓ Membro adicionado/)).toBeNull()
    await settle()
    expect(screen.getByText('✓ Membro adicionado. Alteração salva.')).toBeTruthy()
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').areas[0].members).toHaveLength(3)
  })

  it('conflito durante a ação: avisa que a alteração ficou só nesta tela', async () => {
    render(<App />)
    await settle()
    localStorage.setItem(KEY, 'da outra aba')
    await addMember('Caio')
    await settle()
    expect(
      screen.getByText(
        'Membro adicionado só nesta tela: a alteração não foi salva. Veja o aviso no topo da página.',
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/✓ Membro adicionado/)).toBeNull()
    expect(screen.getByText('Os dados foram alterados em outra aba ou janela.')).toBeTruthy()
    expect(localStorage.getItem(KEY)).toBe('da outra aba')
  })

  it('falha de gravação: avisa que não foi salva', async () => {
    render(<App />)
    await settle()
    const realSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === KEY) throw new Error('cota cheia')
      realSetItem.call(this, key, value)
    })
    await addMember('Caio')
    await settle()
    expect(screen.getByText(/Membro adicionado só nesta tela/)).toBeTruthy()
    expect(screen.getByText('A última alteração não pôde ser gravada.')).toBeTruthy()
  })

  it('restauração de backup: só anuncia "salva" depois da confirmação', async () => {
    render(<App />)
    await settle()
    const backup = data()
    backup.areas[0].members.push(member('h3', 'Caio'))
    await restoreBackup(backup)
    fireEvent.click(screen.getByRole('button', { name: 'Sim, substituir meus dados' }))
    expect(screen.queryByText(/✓ Dados restaurados/)).toBeNull()
    await settle()
    expect(screen.getByText('✓ Dados restaurados. Alteração salva.')).toBeTruthy()
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').areas[0].members).toHaveLength(3)
  })

  it('restauração de backup em conflito: não sobrescreve e não anuncia sucesso', async () => {
    render(<App />)
    await settle()
    const backup = data()
    backup.areas[0].members.push(member('h3', 'Caio'))
    await restoreBackup(backup)
    localStorage.setItem(KEY, 'da outra aba')
    fireEvent.click(screen.getByRole('button', { name: 'Sim, substituir meus dados' }))
    await settle()
    expect(
      screen.getByText(
        'Dados restaurados só nesta tela: a alteração não foi salva. Veja o aviso no topo da página.',
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/✓ Dados restaurados/)).toBeNull()
    expect(localStorage.getItem(KEY)).toBe('da outra aba')
  })
})

describe('I2: diálogo de quantidade de parcelas com participante desativado', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 22, 12))
    const onlyAna = [{ memberId: 'h1', amountCents: 10000 }]
    const tv: FinanceData = data()
    tv.areas[0].members = [{ ...member('h1', 'Ana'), inactive: true }, member('h2', 'Bia'), member('h4', 'Duda')]
    tv.areas[0].series = [{
      id: 's-tv', kind: 'installment', startMonth: '2026-08', installmentCount: 3,
      versions: [{ fromMonth: '2026-08', name: 'TV', totalCents: 10000, dueDay: 15, shares: onlyAna }],
      skippedMonths: [],
    }]
    tv.areas[0].bills = ['2026-08', '2026-09', '2026-10'].map((month, index) => ({
      id: `tv${index + 1}`, name: 'TV', month, totalCents: 10000, dueDay: 15,
      shares: onlyAna, paid: true, seriesId: 's-tv', installmentNumber: index + 1,
    }))
    localStorage.setItem(KEY, JSON.stringify(tv))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mostra o desativado, exige o pagador e grava só com ativos', async () => {
    render(<App />)
    await settle()
    document.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]').forEach((button) => {
      fireEvent.click(button)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Editar a conta TV' }))
    fireEvent.click(screen.getByRole('button', { name: 'Alterar quantidade de parcelas…' }))
    fireEvent.change(screen.getByLabelText('Quantidade de parcelas'), { target: { value: '5' } })
    expect(screen.getByText(/Participante desativado nesta compra: Ana/)).toBeTruthy()
    const confirm = screen.getByRole('button', { name: 'Alterar quantidade' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Quem paga as parcelas novas?'), { target: { value: 'h4' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await settle()
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as FinanceData
    const versions = saved.areas[0].series[0].versions
    expect(saved.areas[0].series[0].installmentCount).toBe(5)
    expect(versions[1]).toMatchObject({ fromMonth: '2026-11', shares: [{ memberId: 'h4', amountCents: 10000 }] })
    // Pagas, com Ana, continuam iguais.
    expect(saved.areas[0].bills.every((bill) => bill.shares[0].memberId === 'h1')).toBe(true)
  })
})

describe('diálogo de quantidade de parcelas: remoções e pagador', () => {
  const both = [
    { memberId: 'h1', amountCents: 5000 },
    { memberId: 'h2', amountCents: 5000 },
  ]
  const tvBill = (n: number, month: string, extra: Partial<FinanceData['areas'][0]['bills'][0]> = {}) => ({
    id: `tv${n}`, name: 'TV', month, totalCents: 10000, dueDay: 15, shares: both,
    paid: false, seriesId: 's-tv', installmentNumber: n, ...extra,
  })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 22, 12))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function openCountDialog() {
    render(<App />)
    await settle()
    document.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]').forEach((button) => {
      fireEvent.click(button)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Editar a conta TV' }))
    fireEvent.click(screen.getByRole('button', { name: 'Alterar quantidade de parcelas…' }))
  }

  it('mesma quantidade não lista remoções; redução e aumento continuam listando', async () => {
    const tv = data()
    // Compra em 5 (julho a novembro), com a parcela 4 (outubro) pendente e a 8 gravada além do fim.
    tv.areas[0].series = [{
      id: 's-tv', kind: 'installment', startMonth: '2026-07', installmentCount: 5,
      versions: [{ fromMonth: '2026-07', name: 'TV', totalCents: 10000, dueDay: 15, shares: both }],
      skippedMonths: [],
    }]
    tv.areas[0].bills = [tvBill(1, '2026-07', { paid: true }), tvBill(4, '2026-10'), tvBill(8, '2027-02')]
    localStorage.setItem(KEY, JSON.stringify(tv))
    await openCountDialog()
    const confirm = () => screen.getByRole('button', { name: 'Alterar quantidade' }) as HTMLButtonElement

    // Quantidade igual à atual (5): nada a remover, botão desabilitado e sem estilo de perigo.
    expect(screen.queryByText(/será removida|serão removidas/)).toBeNull()
    expect(confirm().disabled).toBe(true)
    expect(confirm().className).not.toContain('button--danger')

    // Redução para 3: parcelas 4 e 8.
    fireEvent.change(screen.getByLabelText('Quantidade de parcelas'), { target: { value: '3' } })
    expect(screen.getByText('Estas parcelas pendentes serão removidas ao confirmar:')).toBeTruthy()
    expect(screen.getByText(/Parcela 4 \(outubro de 2026\)/)).toBeTruthy()
    expect(screen.getByText(/Parcela 8 \(fevereiro de 2027\)/)).toBeTruthy()
    expect(confirm().className).toContain('button--danger')

    // Aumento para 6: a 8 continua acima do novo total.
    fireEvent.change(screen.getByLabelText('Quantidade de parcelas'), { target: { value: '6' } })
    expect(screen.getByText('Esta parcela pendente será removida ao confirmar:')).toBeTruthy()
    expect(screen.getByText(/Parcela 8 \(fevereiro de 2027\)/)).toBeTruthy()
    expect(confirm().className).toContain('button--danger')

    // De volta à mesma quantidade: a lista some de novo.
    fireEvent.change(screen.getByLabelText('Quantidade de parcelas'), { target: { value: '5' } })
    expect(screen.queryByText(/será removida|serão removidas/)).toBeNull()
  })

  it('pagador exigido quando a necessidade vem de uma conta já gravada', async () => {
    const tv = data()
    tv.areas[0].members = [{ ...member('h1', 'Ana'), inactive: true }, member('h2', 'Bia'), member('h4', 'Duda')]
    // Divisão da compra com Bia (ativa); a parcela 5, gravada além do fim, só com Ana.
    tv.areas[0].series = [{
      id: 's-tv', kind: 'installment', startMonth: '2026-08', installmentCount: 3,
      versions: [{ fromMonth: '2026-08', name: 'TV', totalCents: 10000, dueDay: 15, shares: both }],
      skippedMonths: [],
    }]
    tv.areas[0].bills = [
      tvBill(3, '2026-10', { paid: true }),
      tvBill(5, '2026-12', { shares: [{ memberId: 'h1', amountCents: 10000 }] }),
    ]
    localStorage.setItem(KEY, JSON.stringify(tv))
    await openCountDialog()
    fireEvent.change(screen.getByLabelText('Quantidade de parcelas'), { target: { value: '5' } })

    // A explicação cobre os dois casos: repartição entre ativos e pagador com 100%.
    expect(screen.getByText(/Onde ainda há participantes ativos na divisão/)).toBeTruthy()
    expect(screen.getByText(/Parcela 5 \(dezembro de 2026\)/)).toBeTruthy()
    const confirm = screen.getByRole('button', { name: 'Alterar quantidade' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Quem paga as parcelas novas?'), { target: { value: 'h4' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await settle()

    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as FinanceData
    const bills = saved.areas[0].bills
    expect(bills.find((bill) => bill.installmentNumber === 5)?.shares).toEqual([
      { memberId: 'h4', amountCents: 10000 },
    ])
    expect(saved.areas[0].series[0].versions[1].shares).toEqual([{ memberId: 'h2', amountCents: 10000 }])
  })
})

describe('I3: copiar o mês anterior com participante desativado', () => {
  // Setembro: Luz (paga) de Ana e Bia; Água só de Ana. Mês atual: outubro.
  function copyData(options: { anaInactive?: boolean; onlyLuz?: boolean } = {}): FinanceData {
    const anaInactive = options.anaInactive ?? true
    const base = data()
    base.areas[0].members = [
      anaInactive ? { ...member('h1', 'Ana'), inactive: true } : member('h1', 'Ana'),
      member('h2', 'Bia'),
      member('h4', 'Duda'),
    ]
    base.areas[0].bills = [
      {
        id: 'luz', name: 'Luz', month: '2026-09', totalCents: 9001, dueDay: 5, paid: true,
        shares: [
          { memberId: 'h1', amountCents: 4500 },
          { memberId: 'h2', amountCents: 4501 },
        ],
      },
      ...(options.onlyLuz
        ? []
        : [{
            id: 'agua', name: 'Água', month: '2026-09', totalCents: 6000, dueDay: 8, paid: false,
            shares: [{ memberId: 'h1', amountCents: 6000 }],
          }]),
    ]
    return base
  }

  const saved = () => JSON.parse(localStorage.getItem(KEY) ?? '{}') as FinanceData
  const october = () => saved().areas[0].bills.filter((bill) => bill.month === '2026-10')
  const dialogTitle = 'Copiar as contas de setembro para outubro?'

  async function openApp(initial: FinanceData) {
    localStorage.setItem(KEY, JSON.stringify(initial))
    render(<App />)
    await settle()
    // As áreas começam recolhidas.
    document.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]').forEach((button) => {
      fireEvent.click(button)
    })
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 22, 12))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sem desativados nas divisões: copia direto, sem diálogo', async () => {
    await openApp(copyData({ anaInactive: false }))
    const before = saved().areas[0].bills
    fireEvent.click(screen.getByRole('button', { name: 'Copiar contas de setembro' }))
    expect(screen.queryByText(dialogTitle)).toBeNull()
    await settle()
    expect(october().map((bill) => [bill.name, bill.paid, bill.shares])).toEqual([
      ['Luz', false, before[0].shares],
      ['Água', false, before[1].shares],
    ])
    expect(saved().areas[0].bills.slice(0, 2)).toEqual(before)
  })

  it('com desativados: lista as contas ajustadas, exige o pagador e copia sem a desativada', async () => {
    await openApp(copyData())
    const before = saved().areas[0].bills
    fireEvent.click(screen.getByRole('button', { name: 'Copiar contas de setembro' }))
    expect(screen.getByText(dialogTitle)).toBeTruthy()
    expect(screen.getByText(/Participante desativado nestas contas: Ana/)).toBeTruthy()
    expect(screen.getByText(/Onde ainda há participantes ativos na divisão/)).toBeTruthy()
    expect(screen.getByText(/Luz: R\$\s*90,01$/)).toBeTruthy()
    expect(screen.getByText(/Água: R\$\s*60,00 \(quem você escolher assume o valor inteiro\)/)).toBeTruthy()
    expect(screen.getByText(/As contas de setembro, inclusive as pagas, não mudam/)).toBeTruthy()
    const confirm = screen.getByRole('button', { name: 'Copiar contas' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Quem paga as contas sem participante ativo?'), {
      target: { value: 'h4' },
    })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await settle()
    expect(screen.queryByText(dialogTitle)).toBeNull()
    expect(october().map((bill) => [bill.name, bill.shares])).toEqual([
      ['Luz', [{ memberId: 'h2', amountCents: 9001 }]],
      ['Água', [{ memberId: 'h4', amountCents: 6000 }]],
    ])
    // Setembro continua igual, inclusive a conta paga com Ana.
    expect(saved().areas[0].bills.slice(0, 2)).toEqual(before)
  })

  it('só repartição: sem campo de pagador', async () => {
    await openApp(copyData({ onlyLuz: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Copiar contas de setembro' }))
    expect(screen.getByText(/repartida igualmente entre os participantes ativos que já estavam/)).toBeTruthy()
    expect(screen.queryByLabelText('Quem paga as contas sem participante ativo?')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Copiar contas' }))
    await settle()
    expect(october().map((bill) => bill.shares)).toEqual([[{ memberId: 'h2', amountCents: 9001 }]])
  })

  it('Cancelar não altera nada', async () => {
    await openApp(copyData())
    const before = localStorage.getItem(KEY)
    fireEvent.click(screen.getByRole('button', { name: 'Copiar contas de setembro' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await settle()
    expect(screen.queryByText(dialogTitle)).toBeNull()
    expect(localStorage.getItem(KEY)).toBe(before)
  })

  it('área compartilhada sem ativos: recusa com a mensagem explicativa', async () => {
    const initial = copyData()
    initial.areas.push({
      id: 'area-v', name: 'Viagem', type: 'shared',
      members: [{ ...member('v1', 'Dani'), inactive: true }],
      bills: [{
        id: 'hotel', name: 'Hotel', month: '2026-09', totalCents: 5000, dueDay: 3, paid: true,
        shares: [{ memberId: 'v1', amountCents: 5000 }],
      }],
      series: [],
    })
    await openApp(initial)
    const before = localStorage.getItem(KEY)
    const buttons = screen.getAllByRole('button', { name: 'Copiar contas de setembro' })
    fireEvent.click(buttons[buttons.length - 1])
    expect(screen.getByText(/esta área não tem participantes ativos/)).toBeTruthy()
    expect(screen.queryByText(dialogTitle)).toBeNull()
    await settle()
    expect(localStorage.getItem(KEY)).toBe(before)
  })

  it('outra aba muda os dados com o diálogo aberto: a proteção I1 impede a gravação', async () => {
    await openApp(copyData())
    fireEvent.click(screen.getByRole('button', { name: 'Copiar contas de setembro' }))
    fireEvent.change(screen.getByLabelText('Quem paga as contas sem participante ativo?'), {
      target: { value: 'h4' },
    })
    // Outra aba desativa Duda enquanto o diálogo está aberto.
    const changed = copyData()
    changed.areas[0].members[2] = { ...member('h4', 'Duda'), inactive: true }
    const other = JSON.stringify(changed)
    localStorage.setItem(KEY, other)
    fireEvent.click(screen.getByRole('button', { name: 'Copiar contas' }))
    await settle()
    expect(localStorage.getItem(KEY)).toBe(other)
    expect(screen.getByText('Os dados foram alterados em outra aba ou janela.')).toBeTruthy()
  })
})

describe('I3: diálogo de cópia (CopyBillsDialog)', () => {
  const plan: CopyBillsPlan = {
    copyCount: 2,
    adjusted: [{ billId: 'agua', name: 'Água', totalCents: 6000, kind: 'payer' }],
    inactiveMemberIds: ['h1'],
    needsPayer: true,
    redistributesAmongActive: false,
    payerCandidates: ['h2'],
  }

  it('erro na confirmação (dados que mudaram): mostra a mensagem e continua aberto', () => {
    const onConfirm = vi.fn(() => COPY_SHARES_CHANGED_MESSAGE)
    const onCancel = vi.fn()
    render(
      <CopyBillsDialog
        fromMonthName="setembro"
        toMonthName="outubro"
        plan={plan}
        members={[{ ...member('h1', 'Ana'), inactive: true }, member('h2', 'Bia')]}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    expect(screen.getByText(/Ninguém ativo ficou na divisão/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Quem paga as contas sem participante ativo?'), {
      target: { value: 'h2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Copiar contas' }))
    expect(onConfirm).toHaveBeenCalledWith('h2')
    expect(screen.getByRole('alert').textContent).toBe(COPY_SHARES_CHANGED_MESSAGE)
    expect(screen.getByText('Copiar as contas de setembro para outubro?')).toBeTruthy()
    expect(onCancel).not.toHaveBeenCalled()
  })
})

describe('M6: base da nova versão em "esta e as seguintes"', () => {
  const half = [
    { memberId: 'h1', amountCents: 5000 },
    { memberId: 'h2', amountCents: 5000 },
  ]
  const onlyAna = [{ memberId: 'h1', amountCents: 9000 }]

  /** Academia recorrente desde outubro (R$ 100,00, Ana e Bia); outubro gravado. */
  function m6Data(options: {
    october?: Partial<Bill>
    seriesShares?: Bill['shares']
    lastMonth?: string
    extraBills?: Bill[]
  } = {}): FinanceData {
    const base = data()
    base.areas[0].members = [member('h1', 'Ana'), member('h2', 'Bia'), { ...member('h3', 'Caio'), inactive: true }]
    base.areas[0].series = [{
      id: 's-academia', kind: 'recurring', startMonth: '2026-10',
      ...(options.lastMonth ? { lastMonth: options.lastMonth } : {}),
      versions: [{
        fromMonth: '2026-10', name: 'Academia', totalCents: 10000, dueDay: 10,
        shares: options.seriesShares ?? half,
      }],
      skippedMonths: [],
    }]
    base.areas[0].bills = [
      {
        id: 'a10', name: 'Academia', month: '2026-10', totalCents: 9000, dueDay: 10,
        shares: onlyAna, paid: false, seriesId: 's-academia', overridden: true,
        ...options.october,
      },
      ...(options.extraBills ?? []),
    ]
    return base
  }

  const occurrenceIn = (month: string, extra: Partial<Bill> = {}): Bill => ({
    id: `a-${month}`, name: 'Academia', month, totalCents: 10000, dueDay: 10, shares: half,
    paid: false, seriesId: 's-academia', ...extra,
  })

  async function openEdit(initial: FinanceData) {
    localStorage.setItem(KEY, JSON.stringify(initial))
    render(<App />)
    await settle()
    document.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]').forEach((button) => {
      fireEvent.click(button)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Editar a conta Academia' }))
  }

  const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
  const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')
  const total = () =>
    ((screen.queryByLabelText('Valor de cada conta') ?? screen.getByLabelText('Valor desta conta')) as HTMLInputElement)
      .value
  const setTotal = (value: string) =>
    fireEvent.change(screen.queryByLabelText('Valor de cada conta') ?? screen.getByLabelText('Valor desta conta'), {
      target: { value },
    })
  const selected = () =>
    [...document.querySelectorAll<HTMLButtonElement>('.member-chip[aria-pressed="true"]')].map((chip) =>
      (chip.textContent ?? '').replace('✓', '').slice(1).trim(),
    )
  const baseBlock = () => screen.queryAllByRole('group', { name: 'Base da nova versão' })[0] ?? null

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 22, 12))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('bloco de base: só em "esta e as seguintes", com a marca de editada individualmente', async () => {
    await openEdit(m6Data())
    expect(total()).toBe('90,00')
    expect(baseBlock()).toBeNull()
    click('Esta e as seguintes')
    expect(baseBlock()).not.toBeNull()
    expect(screen.getByText(/Os campos abaixo não são os dados da série em outubro/)).toBeTruthy()
    expect(screen.getByText(/Esta conta foi editada individualmente/)).toBeTruthy()
    expect(pressed('Usar dados desta conta')).toBe('true')
    expect(screen.queryByText(/os campos voltam aos dados desta conta/)).toBeNull()
  })

  it('sem divergência o bloco some; uma edição faz ele aparecer, sem a menção à marca', async () => {
    await openEdit(m6Data({ october: { totalCents: 10000, shares: half, overridden: undefined } }))
    click('Esta e as seguintes')
    expect(baseBlock()).toBeNull()
    setTotal('95,00')
    expect(baseBlock()).not.toBeNull()
    expect(screen.queryByText(/Esta conta foi editada individualmente/)).toBeNull()
  })

  it('conta igual à série: depois de "Usar dados da série" o aviso continua visível', async () => {
    await openEdit(m6Data({ october: { totalCents: 10000, shares: half, overridden: undefined } }))
    click('Esta e as seguintes')
    setTotal('95,00')
    click('Usar dados da série')
    // Campos, conta e série iguais: mesmo assim o bloco e o aviso de restauração aparecem.
    expect(total()).toBe('100,00')
    expect(baseBlock()).not.toBeNull()
    expect(screen.getByText(/Os campos estão com os dados da série em outubro/)).toBeTruthy()
    expect(screen.getByText(/os campos voltam aos dados desta conta/)).toBeTruthy()
    click('Só esta conta')
    expect(total()).toBe('100,00')
    // Q4 continua: série → conta → edição; com a base desta conta, as edições ficam.
    click('Esta e as seguintes')
    setTotal('95,00')
    click('Usar dados da série')
    click('Usar dados desta conta')
    // Tudo igual de novo e base da conta: sem consequência a avisar, o bloco some.
    expect(baseBlock()).toBeNull()
    setTotal('97,00')
    expect(screen.queryByText(/os campos voltam aos dados desta conta/)).toBeNull()
    click('Só esta conta')
    expect(total()).toBe('97,00')
  })

  it('"Usar dados da série" preenche os campos, sem gravar nada', async () => {
    await openEdit(m6Data())
    const before = localStorage.getItem(KEY)
    click('Esta e as seguintes')
    click('Usar dados da série')
    expect(total()).toBe('100,00')
    expect(selected()).toEqual(['Ana', 'Bia'])
    expect(pressed('Usar dados da série')).toBe('true')
    expect(screen.getByText(/Os campos estão com os dados da série em outubro/)).toBeTruthy()
    expect(screen.getByText(/os campos voltam aos dados desta conta/)).toBeTruthy()
    click('Usar dados desta conta')
    expect(total()).toBe('90,00')
    expect(selected()).toEqual(['Ana'])
    await settle()
    expect(localStorage.getItem(KEY)).toBe(before)
  })

  it('voltar para "Só esta" com a base da série restaura os dados originais (inclusive edições anteriores)', async () => {
    await openEdit(m6Data())
    setTotal('95,00')
    click('Esta e as seguintes')
    click('Usar dados da série')
    fireEvent.change(screen.getByLabelText('Nome da conta'), { target: { value: 'Ginástica' } })
    click('Só esta conta')
    expect(total()).toBe('90,00')
    expect((screen.getByLabelText('Nome da conta') as HTMLInputElement).value).toBe('Academia')
    expect(selected()).toEqual(['Ana'])
    // De volta a "esta e as seguintes", a base atual é a da conta.
    click('Esta e as seguintes')
    expect(pressed('Usar dados desta conta')).toBe('true')
  })

  it('série → conta → edição → "Só esta": a base atual é a da conta e as edições ficam', async () => {
    await openEdit(m6Data())
    click('Esta e as seguintes')
    click('Usar dados da série')
    click('Usar dados desta conta')
    setTotal('95,00')
    click('Só esta conta')
    expect(total()).toBe('95,00')
  })

  it('série → conta → série → "Só esta": restaura os dados originais', async () => {
    await openEdit(m6Data())
    click('Esta e as seguintes')
    click('Usar dados da série')
    click('Usar dados desta conta')
    click('Usar dados da série')
    click('Só esta conta')
    expect(total()).toBe('90,00')
  })

  it('sem usar os botões, alternar o alcance mantém os campos como hoje', async () => {
    await openEdit(m6Data())
    click('Esta e as seguintes')
    setTotal('95,00')
    click('Só esta conta')
    expect(total()).toBe('95,00')
  })

  it('participante desativado nos dados da série: aviso, recusa ao salvar e ajuste manual', async () => {
    const withCaio = [
      { memberId: 'h1', amountCents: 5000 },
      { memberId: 'h3', amountCents: 5000 },
    ]
    // Recorrente encerrada: só nela uma versão vigente ainda pode ter desativado.
    await openEdit(m6Data({ seriesShares: withCaio, lastMonth: '2027-03' }))
    click('Esta e as seguintes')
    click('Usar dados da série')
    expect(selected()).toEqual(['Ana', 'Caio'])
    expect(screen.getByText(/A divisão inclui um participante desativado nesta área: Caio/)).toBeTruthy()
    click('Salvar alterações')
    expect(screen.getByText(/Tire essa pessoa da divisão para continuar/)).toBeTruthy()
    expect(screen.queryByText('Alterar “Academia” a partir de outubro?')).toBeNull()
    fireEvent.click([...document.querySelectorAll<HTMLButtonElement>('.member-chip')].find((chip) =>
      chip.textContent?.includes('Caio'))!)
    expect(screen.queryByText(/participante desativado nesta área/)).toBeNull()
    click('Salvar alterações')
    expect(screen.getByText('Alterar “Academia” a partir de outubro?')).toBeTruthy()
  })

  it('confirmação: origem da conta, o que muda, a conta escolhida e os meses', async () => {
    const extraBills = [
      occurrenceIn('2026-11'), occurrenceIn('2026-12'), occurrenceIn('2027-01'),
      occurrenceIn('2027-02'), occurrenceIn('2027-03'),
      occurrenceIn('2027-04', { totalCents: 7000, shares: [{ memberId: 'h2', amountCents: 7000 }], overridden: true }),
      occurrenceIn('2027-05', { paid: true }),
    ]
    await openEdit(m6Data({ extraBills }))
    click('Esta e as seguintes')
    click('Salvar alterações')
    const dialog = screen.getByText('Alterar “Academia” a partir de outubro?').closest('dialog')!
    const text = dialog.textContent ?? ''
    expect(text).toContain('Valores: os dados desta conta de outubro (editada individualmente).')
    expect(text).toMatch(/Valor: R\$\s*100,00 → R\$\s*90,00/)
    expect(text).toMatch(/Divisão: Ana R\$\s*50,00 → R\$\s*90,00; Bia \(R\$\s*50,00\) sai/)
    expect(text).toContain('Esta conta de outubro passa a seguir a série e deixa de ser marcada como editada individualmente.')
    expect(text).toContain('Contas já gravadas e pendentes que serão atualizadas: nov 2026, dez 2026, jan 2027 e mais 2 (5 meses).')
    expect(text).toContain('Conta paga que continua com os dados antigos: mai.')
    // Gravadas até maio de 2027: as previstas afetadas começam em junho.
    expect(text).toContain('As contas previstas de junho de 2027 em diante já aparecem com os novos dados.')
    expect(text).toContain('1 conta seguinte foi editada individualmente (abr).')
    expect((screen.getByRole('button', { name: 'Confirmar alteração' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('confirmação: série com fim lista as previstas que mudam', async () => {
    await openEdit(m6Data({ lastMonth: '2027-01' }))
    click('Esta e as seguintes')
    click('Salvar alterações')
    expect(
      screen.getByText('Contas previstas que já aparecem com os novos dados: nov 2026, dez 2026, jan 2027.'),
    ).toBeTruthy()
  })

  it('confirmação: dados da série, valores editados e Cancelar mantendo o formulário', async () => {
    await openEdit(m6Data())
    click('Esta e as seguintes')
    click('Usar dados da série')
    click('Salvar alterações')
    expect(screen.getByText('Valores: os dados atuais da série em outubro.')).toBeTruthy()
    expect(screen.getByText('Os dados da série em outubro não mudam.')).toBeTruthy()
    // A série não muda: nenhuma mensagem sobre contas previstas.
    expect(screen.queryByText(/contas previstas/i)).toBeNull()
    // O "Cancelar" da confirmação é o último aberto, por cima do formulário.
    const cancels = screen.getAllByRole('button', { name: 'Cancelar' })
    fireEvent.click(cancels[cancels.length - 1])
    expect(screen.queryByText('Valores: os dados atuais da série em outubro.')).toBeNull()
    expect(pressed('Usar dados da série')).toBe('true')
    fireEvent.change(screen.getByLabelText('Dia do vencimento'), { target: { value: '12' } })
    click('Salvar alterações')
    expect(
      screen.getByText(/Valores: editados no formulário a partir dos dados da série\. Alterado depois: vencimento\./),
    ).toBeTruthy()
    expect(screen.getByText('Vencimento: dia 10 → dia 12')).toBeTruthy()
    click('Confirmar alteração')
    await settle()
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as FinanceData
    expect(saved.areas[0].series[0].versions).toEqual([
      { fromMonth: '2026-10', name: 'Academia', totalCents: 10000, dueDay: 12, shares: half },
    ])
    expect(saved.areas[0].bills[0]).toMatchObject({ totalCents: 10000, dueDay: 12, shares: half })
    expect(saved.areas[0].bills[0].overridden).toBeUndefined()
  })

  it('outra aba muda os dados antes da confirmação: a proteção I1 impede a gravação', async () => {
    await openEdit(m6Data())
    click('Esta e as seguintes')
    click('Usar dados da série')
    click('Salvar alterações')
    expect(screen.getByText('Alterar “Academia” a partir de outubro?')).toBeTruthy()
    // Outra aba grava uma versão mais recente enquanto a confirmação está aberta.
    const changed = m6Data()
    changed.areas[0].bills[0] = { ...changed.areas[0].bills[0], totalCents: 8000, shares: [{ memberId: 'h1', amountCents: 8000 }] }
    const other = JSON.stringify(changed)
    localStorage.setItem(KEY, other)
    click('Confirmar alteração')
    await settle()
    // A alteração foi aplicada na tela (a confirmação fechou), mas não foi gravada:
    // os dados mais recentes continuam gravados e o conflito é avisado.
    expect(screen.queryByText('Alterar “Academia” a partir de outubro?')).toBeNull()
    expect(localStorage.getItem(KEY)).toBe(other)
    expect(screen.getByText('Os dados foram alterados em outra aba ou janela.')).toBeTruthy()
  })

  it('conta escolhida paga e marcada: a confirmação diz que ela continua igual', async () => {
    await openEdit(m6Data({ october: { paid: true } }))
    click('Esta e as seguintes')
    click('Salvar alterações')
    expect(
      screen.getByText(
        'Esta conta de outubro está paga e continua igual e continua marcada como editada individualmente.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Alterar “Academia” a partir de novembro?')).toBeTruthy()
  })
})

describe('virada do mês com o app aberto', () => {
  const half = [
    { memberId: 'h1', amountCents: 5000 },
    { memberId: 'h2', amountCents: 5000 },
  ]

  /** Academia recorrente desde setembro (setembro paga) e TV em 3 parcelas desde outubro. */
  function rolloverData(): FinanceData {
    const base = data()
    base.areas[0].series = [
      {
        id: 's-ac', kind: 'recurring', startMonth: '2026-09', skippedMonths: [],
        versions: [{ fromMonth: '2026-09', name: 'Academia', totalCents: 10000, dueDay: 10, shares: half }],
      },
      {
        id: 's-tv', kind: 'installment', startMonth: '2026-10', installmentCount: 3, skippedMonths: [],
        versions: [{
          fromMonth: '2026-10', name: 'TV', totalCents: 30000, dueDay: 15,
          shares: half.map((share) => ({ ...share, amountCents: 15000 })),
        }],
      },
    ]
    base.areas[0].bills = [{
      id: 'ac9', name: 'Academia', month: '2026-09', totalCents: 10000, dueDay: 10, shares: half,
      paid: true, seriesId: 's-ac',
    }]
    return base
  }

  const shownMonth = () => document.querySelector('.month-selector__label strong')?.textContent
  const stored = () => JSON.parse(localStorage.getItem(KEY) ?? '{}') as FinanceData
  /** Contas gravadas da casa por mês: "nome mês". */
  const recorded = () => stored().areas[0].bills.map((bill) => `${bill.name} ${bill.month}`)
  const cardTexts = () =>
    [...document.querySelectorAll('.bill-list > li')].map((item) => item.textContent ?? '')

  async function openAt(date: Date) {
    vi.setSystemTime(date)
    localStorage.setItem(KEY, JSON.stringify(rolloverData()))
    render(<App />)
    await settle()
    document.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]').forEach((button) => {
      fireEvent.click(button)
    })
  }

  /** Passa a meia-noite pelo temporizador do app (relógio falso, sem esperar a hora real). */
  async function crossMidnight() {
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    await settle()
  }

  beforeEach(() => {
    // Relógio falso também para os temporizadores; `shouldAdvanceTime` mantém as esperas
    // curtas (settle) funcionando.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('vendo o mês atual: a seleção acompanha a virada e o novo mês é gravado uma vez', async () => {
    await openAt(new Date(2026, 9, 31, 23, 59, 58))
    expect(shownMonth()).toBe('Outubro de 2026')
    // A abertura em outubro grava as contas de outubro; novembro ainda é previsto.
    expect(recorded()).toEqual(['Academia 2026-09', 'Academia 2026-10', 'TV 2026-10'])

    await crossMidnight()
    expect(shownMonth()).toBe('Novembro de 2026')
    expect(recorded()).toEqual([
      'Academia 2026-09', 'Academia 2026-10', 'TV 2026-10', 'Academia 2026-11', 'TV 2026-11',
    ])
    // Novembro aparece gravado (não previsto), com a parcela certa.
    const november = cardTexts()
    expect(november).toHaveLength(2)
    expect(november.some((text) => text.includes('Prevista'))).toBe(false)
    expect(november.some((text) => text.includes('Parcela 2/3'))).toBe(true)

    // Sem duplicação: conferir a data de novo não grava nada a mais.
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await settle()
    expect(recorded().filter((item) => item.endsWith('2026-11'))).toHaveLength(2)

    // Dezembro continua previsto.
    fireEvent.click(screen.getByRole('button', { name: 'Próximo mês' }))
    const december = cardTexts()
    expect(december).toHaveLength(2)
    expect(december.every((text) => text.includes('Prevista'))).toBe(true)
    expect(december.some((text) => text.includes('Parcela 3/3'))).toBe(true)
  })

  it('vendo outro mês: a seleção permanece nele e o novo mês é gravado mesmo assim', async () => {
    await openAt(new Date(2026, 10, 30, 23, 59, 58))
    fireEvent.click(screen.getByRole('button', { name: 'Próximo mês' }))
    fireEvent.click(screen.getByRole('button', { name: 'Próximo mês' }))
    expect(shownMonth()).toBe('Janeiro de 2027')

    await crossMidnight()
    expect(shownMonth()).toBe('Janeiro de 2027')
    expect(recorded().filter((item) => item.endsWith('2026-12'))).toEqual([
      'Academia 2026-12', 'TV 2026-12',
    ])
    // Janeiro segue previsto: só a Academia (a TV terminou em dezembro).
    const january = cardTexts()
    expect(january).toHaveLength(1)
    expect(january[0]).toContain('Academia')
    expect(january[0]).toContain('Prevista')
  })
})
