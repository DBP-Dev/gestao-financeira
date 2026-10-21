import { useEffect, useState } from 'react'
import type { Area } from '../types'
import { HOME_AREA_ID } from '../utils/areas'

/**
 * Quem é "eu" em cada área compartilhada criada: { id da área: id do participante }.
 * Preferência local deste aparelho, como o perfil (useCurrentMember): fica fora dos
 * dados financeiros (gestao-financeira:dados:v1) e, por isso, fora do backup.
 * "Gastos da casa" não usa esta escolha: ali "eu" é o perfil do painel pessoal.
 */
const AREA_SELF_KEY = 'gestao-financeira:perfil-areas:v1'

type AreaSelfChoices = Record<string, string>

function readSavedChoices(): AreaSelfChoices {
  try {
    const raw = localStorage.getItem(AREA_SELF_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const choices: AreaSelfChoices = {}
    for (const [areaId, memberId] of Object.entries(parsed)) {
      if (typeof memberId === 'string') choices[areaId] = memberId
    }
    return choices
  } catch {
    return {}
  }
}

function saveChoices(choices: AreaSelfChoices) {
  try {
    localStorage.setItem(AREA_SELF_KEY, JSON.stringify(choices))
  } catch {
    // Sem armazenamento: a escolha vale só enquanto a página estiver aberta.
  }
}

/** A escolha só vale para participante existente de área compartilhada criada (não "Gastos da casa"). */
function isValidChoice(areas: Area[], areaId: string, memberId: string): boolean {
  const area = areas.find((item) => item.id === areaId)
  return (
    area !== undefined &&
    area.type === 'shared' &&
    area.id !== HOME_AREA_ID &&
    area.members.some((member) => member.id === memberId)
  )
}

function onlyValid(areas: Area[], choices: AreaSelfChoices): AreaSelfChoices {
  return Object.fromEntries(
    Object.entries(choices).filter(([areaId, memberId]) => isValidChoice(areas, areaId, memberId)),
  )
}

/**
 * `canCleanUp`: só limpa associações inválidas quando os dados foram lidos normalmente.
 * Em modo de recuperação os dados exibidos são provisórios e não servem de referência.
 */
export function useAreaSelf(areas: Area[], canCleanUp: boolean) {
  const [choices, setChoices] = useState<AreaSelfChoices>(readSavedChoices)
  // Associações de áreas ou participantes que não existem mais são ignoradas aqui.
  const validChoices = onlyValid(areas, choices)

  // Remove do aparelho as associações inválidas, sem tocar nos dados financeiros.
  const hasInvalid = Object.keys(validChoices).length !== Object.keys(choices).length
  const validJson = JSON.stringify(validChoices)
  useEffect(() => {
    if (canCleanUp && hasInvalid) saveChoices(JSON.parse(validJson) as AreaSelfChoices)
  }, [canCleanUp, hasInvalid, validJson])

  /** Participante marcado como "eu" na área, ou null. */
  function getSelfId(areaId: string): string | null {
    return validChoices[areaId] ?? null
  }

  /** Marca (ou, com null, desmarca) quem é "eu" na área. Participantes de outra área são recusados. */
  function chooseSelf(areaId: string, memberId: string | null) {
    if (memberId !== null && !isValidChoice(areas, areaId, memberId)) return
    const next = { ...validChoices }
    if (memberId === null) delete next[areaId]
    else next[areaId] = memberId
    setChoices(next)
    saveChoices(next)
  }

  return { getSelfId, chooseSelf }
}
