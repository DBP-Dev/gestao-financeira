import { useState } from 'react'
import type { Member } from '../types'
import { DEFAULT_CURRENT_MEMBER_ID } from '../utils/personal'

/**
 * Preferência local deste aparelho. Fica fora dos dados financeiros
 * (gestao-financeira:dados:v1) e, por isso, fora do backup.
 */
const PROFILE_KEY = 'gestao-financeira:perfil:v1'

function readSavedChoice(): string | null {
  try {
    return localStorage.getItem(PROFILE_KEY)
  } catch {
    return null
  }
}

/**
 * Integrante atual do Painel Pessoal: "eu" quando existe; senão, a escolha
 * salva neste aparelho. Nunca escolhe outra pessoa sozinho (devolve null).
 * Participantes desativados não são aceitos como perfil.
 */
export function useCurrentMember(members: Member[]) {
  const [savedChoice, setSavedChoice] = useState<string | null>(readSavedChoice)

  const findMember = (id: string | null) =>
    id === null
      ? null
      : (members.find((member) => member.id === id && !member.inactive) ?? null)
  const member = findMember(DEFAULT_CURRENT_MEMBER_ID) ?? findMember(savedChoice)

  function chooseMember(id: string) {
    setSavedChoice(id)
    try {
      localStorage.setItem(PROFILE_KEY, id)
    } catch {
      // Sem armazenamento: a escolha vale só enquanto a página estiver aberta.
    }
  }

  return { member, chooseMember }
}
