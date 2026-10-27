import { describe, expect, it } from 'vitest'
import type { Area, FinanceData } from './types'
import { HOME_AREA_ID, MY_ACCOUNTS_AREA_ID } from './areas'
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  createBackup,
  parseBackup,
  parseStoredData,
} from './backup'

const member = (id: string, name: string, inactive = false) => ({
  id,
  name,
  emoji: '🙂',
  color: '#d8ecff',
  ...(inactive ? { inactive: true } : {}),
})

/** Dados da versão 2 como o aplicativo gravava antes das séries. */
function v2Data() {
  return {
    version: 2,
    areas: [
      {
        id: HOME_AREA_ID,
        name: 'Gastos da casa',
        type: 'shared',
        members: [member('h1', 'Ana'), member('h2', 'Bia')],
        bills: [
          {
            id: 'c1',
            name: 'Aluguel',
            month: '2026-10',
            totalCents: 100000,
            dueDay: 10,
            shares: [
              { memberId: 'h1', amountCents: 60000 },
              { memberId: 'h2', amountCents: 40000 },
            ],
            paid: true,
            isExample: true,
          },
        ],
      },
      {
        id: MY_ACCOUNTS_AREA_ID,
        name: 'Minhas contas',
        type: 'individual',
        members: [],
        bills: [
          { id: 'i1', name: 'Academia', month: '2026-09', totalCents: 9000, dueDay: 5, shares: [], paid: false },
        ],
      },
    ],
  }
}

/** Dados válidos da versão 3 com séries recorrentes (aberta e encerrada) e parcelada. */
function v3Data(): FinanceData {
  return {
    version: 3,
    areas: [
      {
        id: HOME_AREA_ID,
        name: 'Gastos da casa',
        type: 'shared',
        members: [member('h1', 'Ana'), member('h2', 'Bia')],
        bills: [],
        series: [],
      },
      {
        id: MY_ACCOUNTS_AREA_ID,
        name: 'Minhas contas',
        type: 'individual',
        members: [],
        bills: [
          {
            id: 'n1',
            name: 'Notebook',
            month: '2026-10',
            totalCents: 25000,
            dueDay: 15,
            shares: [],
            paid: true,
            seriesId: 's-notebook',
            installmentNumber: 1,
          },
        ],
        series: [
          {
            id: 's-notebook',
            kind: 'installment',
            startMonth: '2026-10',
            installmentCount: 10,
            versions: [
              { fromMonth: '2026-10', name: 'Notebook', totalCents: 25000, dueDay: 15, shares: [] },
            ],
            // A 4ª parcela foi excluída; a 12ª posição fica além do total, mas dentro de 120.
            skippedMonths: ['2027-01', '2027-09'],
          },
        ],
      },
      {
        id: 'area-v',
        name: 'Viagem',
        type: 'shared',
        members: [member('p1', 'Caio'), member('p2', 'Duda'), member('p3', 'Eva', true)],
        bills: [
          {
            id: 'v1',
            name: 'Academia',
            month: '2026-10',
            totalCents: 10000,
            dueDay: 10,
            shares: [
              { memberId: 'p1', amountCents: 5000 },
              { memberId: 'p2', amountCents: 5000 },
            ],
            paid: true,
            seriesId: 's-academia',
            overridden: true,
          },
          {
            id: 'v2',
            name: 'Internet',
            month: '2026-08',
            totalCents: 9000,
            dueDay: 20,
            shares: [
              { memberId: 'p1', amountCents: 4500 },
              { memberId: 'p3', amountCents: 4500 },
            ],
            paid: true,
            seriesId: 's-internet',
          },
          {
            // Pendente mantida depois do encerramento da série.
            id: 'v3',
            name: 'Internet',
            month: '2026-10',
            totalCents: 9000,
            dueDay: 20,
            shares: [
              { memberId: 'p1', amountCents: 4500 },
              { memberId: 'p3', amountCents: 4500 },
            ],
            paid: false,
            seriesId: 's-internet',
          },
          {
            // Conta comum do histórico com participante hoje desativado.
            id: 'v4',
            name: 'Passagem',
            month: '2026-07',
            totalCents: 30000,
            dueDay: 1,
            shares: [{ memberId: 'p3', amountCents: 30000 }],
            paid: true,
          },
        ],
        series: [
          {
            id: 's-academia',
            kind: 'recurring',
            startMonth: '2026-10',
            versions: [
              {
                fromMonth: '2026-10',
                name: 'Academia',
                totalCents: 10000,
                dueDay: 10,
                shares: [
                  { memberId: 'p1', amountCents: 5000 },
                  { memberId: 'p2', amountCents: 5000 },
                ],
              },
              {
                fromMonth: '2027-01',
                name: 'Academia',
                totalCents: 12000,
                dueDay: 10,
                shares: [
                  { memberId: 'p1', amountCents: 6000 },
                  { memberId: 'p2', amountCents: 6000 },
                ],
              },
            ],
            // Recorrente em aberto: exclusões sem limite de meses.
            skippedMonths: ['2026-12', '2040-05'],
          },
          {
            id: 's-internet',
            kind: 'recurring',
            startMonth: '2026-08',
            lastMonth: '2026-09',
            versions: [
              {
                fromMonth: '2026-08',
                name: 'Internet',
                totalCents: 9000,
                dueDay: 20,
                shares: [
                  { memberId: 'p1', amountCents: 4500 },
                  { memberId: 'p3', amountCents: 4500 },
                ],
              },
            ],
            skippedMonths: [],
          },
        ],
      },
    ],
  }
}

type AnyData = FinanceData

function parse(data: unknown) {
  return parseStoredData(JSON.stringify(data))
}

function expectRejected(data: unknown, fragment: string) {
  const result = parse(data)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain(fragment)
}

function backupText(formatVersion: number, data: unknown) {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    formatVersion,
    createdAt: '2026-10-22T12:00:00.000Z',
    data,
  })
}

const area = (data: AnyData, id: string) => {
  const found = data.areas.find((item) => item.id === id)
  if (!found) throw new Error(`área ${id} não encontrada no teste`)
  return found
}

describe('migração dos dados salvos no navegador', () => {
  it('converte a versão 1 para a 3 sem alterar membros nem contas', () => {
    const members = [member('a', 'Ana'), member('b', 'Bia')]
    const bills = [
      {
        id: 'x1',
        name: 'Luz',
        month: '2026-10',
        totalCents: 10001,
        dueDay: 31,
        shares: [
          { memberId: 'a', amountCents: 5001 },
          { memberId: 'b', amountCents: 5000 },
        ],
        paid: false,
      },
    ]
    const result = parse({ version: 1, members, bills })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.version).toBe(3)
    const home = result.data.areas.find((item) => item.id === HOME_AREA_ID)
    expect(home?.members).toEqual(members)
    expect(home?.bills).toEqual(bills)
    expect(home?.series).toEqual([])
    const myAccounts = result.data.areas.find((item) => item.id === MY_ACCOUNTS_AREA_ID)
    expect(myAccounts?.series).toEqual([])
  })

  it('converte a versão 2 para a 3 preservando áreas, membros e contas', () => {
    const original = v2Data()
    const result = parse(original)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.version).toBe(3)
    expect(result.data.areas).toEqual(original.areas.map((item) => ({ ...item, series: [] })))
  })

  it('recusa dados da versão 2 com campos que só existem na versão 3', () => {
    const withSeries = v2Data()
    Object.assign(withSeries.areas[0], { series: [] })
    expectRejected(withSeries, 'não existem nesta versão dos dados')

    const withSeriesId = v2Data()
    Object.assign(withSeriesId.areas[1].bills[0], { seriesId: 's1' })
    expectRejected(withSeriesId, 'não existem nesta versão dos dados')

    const withInactive = v2Data()
    Object.assign(withInactive.areas[0].members[1], { inactive: true })
    expectRejected(withInactive, 'não existe nesta versão dos dados')
  })

  it('lê dados válidos da versão 3 sem alterar nada', () => {
    const original = v3Data()
    const result = parse(original)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual(original)
  })

  it('recusa versões desconhecidas e conteúdo que não é JSON', () => {
    expectRejected({ version: 4, areas: [] }, 'não reconhece')
    expect(parseStoredData('{ isto não é json').ok).toBe(false)
  })
})

describe('backup versão 3', () => {
  it('exporta na versão 3 e restaura exatamente os mesmos dados, com as séries', () => {
    const data = v3Data()
    const backup = createBackup(data, new Date('2026-10-22T12:00:00Z'))
    expect(backup.formatVersion).toBe(3)
    expect(BACKUP_FORMAT_VERSION).toBe(3)
    const result = parseBackup(JSON.stringify(backup))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual(data)
    expect(result.summary.areaCount).toBe(3)
  })

  it('recusa backups das versões 1 e 2', () => {
    for (const formatVersion of [1, 2]) {
      const result = parseBackup(backupText(formatVersion, v2Data()))
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Este backup é de uma versão anterior e não pode ser importado.')
      }
    }
  })

  it('recusa backups de versão mais nova', () => {
    const result = parseBackup(backupText(4, v3Data()))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('versão mais nova')
  })

  it('recusa um backup v3 sem a lista de séries', () => {
    const data = v3Data()
    delete (data.areas[0] as Partial<Area>).series
    const result = parseBackup(backupText(3, data))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('lista de contas recorrentes e parceladas')
  })
})

describe('validação das séries e ocorrências', () => {
  const viagem = (data: AnyData) => area(data, 'area-v')
  const minhas = (data: AnyData) => area(data, MY_ACCOUNTS_AREA_ID)

  it('recusa duas ocorrências da mesma série no mesmo mês', () => {
    const data = v3Data()
    viagem(data).bills.push({ ...viagem(data).bills[0], id: 'v1-dup' })
    expectRejected(data, 'repete uma ocorrência')
  })

  it('recusa ocorrência gravada num mês excluído', () => {
    const data = v3Data()
    viagem(data).series[0].skippedMonths.push('2026-10')
    expectRejected(data, 'mês que foi excluído')
  })

  it('recusa ocorrência ligada a série inexistente e de mês anterior ao início', () => {
    const unknown = v3Data()
    viagem(unknown).bills[0].seriesId = 'nao-existe'
    expectRejected(unknown, 'não existe nesta área')

    const before = v3Data()
    viagem(before).bills[0].month = '2026-09'
    expectRejected(before, 'anterior ao início')
  })

  it('confere o número das parcelas', () => {
    const wrong = v3Data()
    minhas(wrong).bills[0].installmentNumber = 2
    expectRejected(wrong, 'número da parcela')

    const recurringWithNumber = v3Data()
    Object.assign(viagem(recurringWithNumber).bills[0], { installmentNumber: 1 })
    expectRejected(recurringWithNumber, 'pertence a uma conta recorrente')

    const normalWithNumber = v3Data()
    Object.assign(viagem(normalWithNumber).bills[3], { installmentNumber: 1 })
    expectRejected(normalWithNumber, 'não está ligada a nenhuma')
  })

  it('aceita parcela gravada além do total atual (histórico)', () => {
    const data = v3Data()
    minhas(data).bills.push({
      ...minhas(data).bills[0],
      id: 'n12',
      month: '2027-09',
      installmentNumber: 12,
    })
    // 2027-09 está nas exclusões do exemplo; tira para gravar a parcela.
    minhas(data).series[0].skippedMonths = ['2027-01']
    expect(parse(data).ok).toBe(true)
  })

  it('exige versões em ordem e começando no mês de início', () => {
    const outOfOrder = v3Data()
    viagem(outOfOrder).series[0].versions.reverse()
    expectRejected(outOfOrder, 'mês de início')

    const repeated = v3Data()
    viagem(repeated).series[0].versions[1].fromMonth = '2026-10'
    expectRejected(repeated, 'fora de ordem ou repetidas')

    const empty = v3Data()
    viagem(empty).series[0].versions = []
    expectRejected(empty, 'sem os dados das contas')
  })

  it('valida a divisão dos dados da série como a de uma conta', () => {
    const unknownMember = v3Data()
    viagem(unknownMember).series[0].versions[0].shares[0].memberId = 'x'
    expectRejected(unknownMember, 'pessoa que não existe')

    const badSum = v3Data()
    viagem(badSum).series[0].versions[0].shares[0].amountCents = 4000
    expectRejected(badSum, 'não somam exatamente')

    const individualShares = v3Data()
    minhas(individualShares).series[0].versions[0].shares = [
      { memberId: 'h1', amountCents: 25000 },
    ]
    expectRejected(individualShares, 'área individual')
  })

  it('limita a quantidade de parcelas a 2..120 e separa os campos de cada tipo', () => {
    for (const count of [1, 121]) {
      const data = v3Data()
      minhas(data).series[0].installmentCount = count
      expectRejected(data, 'de 2 a 120 parcelas')
    }
    const installmentWithEnd = v3Data()
    Object.assign(minhas(installmentWithEnd).series[0], { lastMonth: '2027-07' })
    expectRejected(installmentWithEnd, 'não pode ter mês de encerramento')

    const recurringWithCount = v3Data()
    Object.assign(viagem(recurringWithCount).series[0], { installmentCount: 5 })
    expectRejected(recurringWithCount, 'não pode ter quantidade de parcelas')
  })

  it('recusa alterações programadas depois do fim da série', () => {
    const afterEnd = v3Data()
    viagem(afterEnd).series[1].versions.push({
      ...viagem(afterEnd).series[1].versions[0],
      fromMonth: '2026-11',
    })
    expectRejected(afterEnd, 'depois do seu último mês')

    const afterLastInstallment = v3Data()
    minhas(afterLastInstallment).series[0].versions.push({
      ...minhas(afterLastInstallment).series[0].versions[0],
      fromMonth: '2027-08',
    })
    expectRejected(afterLastInstallment, 'depois do seu último mês')
  })

  it('aplica os limites corretos às exclusões permanentes', () => {
    const beforeStart = v3Data()
    viagem(beforeStart).series[0].skippedMonths.push('2026-09')
    expectRejected(beforeStart, 'anterior ao seu início')

    const afterEnd = v3Data()
    viagem(afterEnd).series[1].skippedMonths.push('2026-11')
    expectRejected(afterEnd, 'depois do encerramento')

    const beyond120 = v3Data()
    // 2026-10 + 120 meses = 2036-10 (121ª posição).
    minhas(beyond120).series[0].skippedMonths.push('2036-10')
    expectRejected(beyond120, 'além da 120ª parcela')

    const position120 = v3Data()
    minhas(position120).series[0].skippedMonths.push('2036-09')
    expect(parse(position120).ok).toBe(true)

    const repeated = v3Data()
    viagem(repeated).series[0].skippedMonths.push('2026-12')
    expectRejected(repeated, 'repete um mês excluído')
  })

  it('não deixa participante desativado na divisão vigente de uma recorrente em aberto', () => {
    const data = v3Data()
    viagem(data).series[0].versions[1].shares = [
      { memberId: 'p1', amountCents: 6000 },
      { memberId: 'p3', amountCents: 6000 },
    ]
    expectRejected(data, 'participante desativado')
  })

  it('exige pelo menos um membro ativo em “Gastos da casa”', () => {
    const data = v3Data()
    area(data, HOME_AREA_ID).members = [member('h1', 'Ana', true), member('h2', 'Bia', true)]
    expectRejected(data, 'nenhum membro ativo')
  })

  it('recusa o mesmo id de série em duas áreas', () => {
    const data = v3Data()
    minhas(data).series[0].id = 's-academia'
    minhas(data).bills[0].seriesId = 's-academia'
    expectRejected(data, 'mesmo identificador')
  })
})
