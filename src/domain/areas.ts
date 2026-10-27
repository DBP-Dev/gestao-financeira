import type { Area, AreaType, FinanceData, LegacyFinanceDataV1 } from './types'
import { createId } from './ids'

/**
 * Id fixo da área que existia antes das áreas (dados da versão 1).
 * O nome exibido pode mudar no futuro; o id, não.
 */
export const HOME_AREA_ID = 'gastos-da-casa'
export const HOME_AREA_NAME = 'Gastos da casa'

/** Área individual fixa: o lugar das contas pessoais. Existe sempre, uma única vez. */
export const MY_ACCOUNTS_AREA_ID = 'minhas-contas'
export const MY_ACCOUNTS_AREA_NAME = 'Minhas contas'

/** Mesmo limite do nome das contas. */
export const MAX_AREA_NAME_LENGTH = 40
export const MAX_AREAS = 50

export const AREA_TYPE_LABEL: Record<AreaType, string> = {
  individual: 'Individual',
  shared: 'Compartilhada',
}

/**
 * Garante a área "Minhas contas": se ela já existe, devolve a mesma lista sem mudanças;
 * senão, acrescenta-a vazia logo depois de "Gastos da casa". Nunca altera outras áreas.
 */
export function ensureMyAccountsArea(areas: Area[]): Area[] {
  if (areas.some((area) => area.id === MY_ACCOUNTS_AREA_ID)) return areas
  const myAccounts: Area = {
    id: MY_ACCOUNTS_AREA_ID,
    name: MY_ACCOUNTS_AREA_NAME,
    type: 'individual',
    members: [],
    bills: [],
    series: [],
  }
  const homeIndex = areas.findIndex((area) => area.id === HOME_AREA_ID)
  return [...areas.slice(0, homeIndex + 1), myAccounts, ...areas.slice(homeIndex + 1)]
}

/** Converte os dados da versão 1 para o formato atual sem alterar membros nem contas. */
export function migrateV1ToV3(legacy: LegacyFinanceDataV1): FinanceData {
  return {
    version: 3,
    areas: ensureMyAccountsArea([
      {
        id: HOME_AREA_ID,
        name: HOME_AREA_NAME,
        type: 'shared',
        members: legacy.members,
        bills: legacy.bills,
        series: [],
      },
    ]),
  }
}

/** A área "Gastos da casa" (sempre presente; o validador garante). */
export function getHomeArea(data: FinanceData): Area {
  const home = data.areas.find((area) => area.id === HOME_AREA_ID)
  if (!home) throw new Error('Área "Gastos da casa" não encontrada.')
  return home
}

/** Remove espaços das pontas e espaços repetidos no meio. */
export function cleanAreaName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

function normalizeAreaName(name: string): string {
  return cleanAreaName(name).toLocaleLowerCase('pt-BR')
}

/** Valida o nome de uma nova área. Devolve a mensagem de erro, ou null se estiver ok. */
export function validateAreaName(name: string, areas: Area[]): string | null {
  const cleaned = cleanAreaName(name)
  if (!cleaned) return 'Informe um nome para a área.'
  if (cleaned.length > MAX_AREA_NAME_LENGTH) {
    return `O nome pode ter no máximo ${MAX_AREA_NAME_LENGTH} caracteres.`
  }
  const duplicate = areas.find((area) => normalizeAreaName(area.name) === normalizeAreaName(cleaned))
  if (duplicate) return `Já existe uma área chamada “${duplicate.name}”.`
  return null
}

/** Só áreas criadas pela pessoa podem ser excluídas; "Gastos da casa" e "Minhas contas" são fixas. */
export function canDeleteArea(areaId: string): boolean {
  return areaId !== HOME_AREA_ID && areaId !== MY_ACCOUNTS_AREA_ID
}

/**
 * Remove uma área com todos os seus participantes e contas.
 * Se a área for fixa ou não existir, devolve os dados sem nenhuma mudança.
 */
export function removeArea(data: FinanceData, areaId: string): FinanceData {
  if (!canDeleteArea(areaId) || !data.areas.some((area) => area.id === areaId)) return data
  return { ...data, areas: data.areas.filter((area) => area.id !== areaId) }
}

/** Nova área vazia, com id próprio que não repete nenhum id existente. */
export function createArea(name: string, type: AreaType, areas: Area[]): Area {
  const usedIds = new Set(areas.map((area) => area.id))
  let id = createId()
  while (usedIds.has(id)) id = createId()
  return { id, name: cleanAreaName(name), type, members: [], bills: [], series: [] }
}
