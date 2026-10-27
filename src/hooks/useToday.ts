import { useEffect, useState } from 'react'
import type { Today } from '../domain/types'
import { getToday } from '../domain/dates'

/** Milissegundos até a próxima meia-noite local (com 1 segundo de folga). */
function msUntilNextMidnight(): number {
  const now = new Date()
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return nextMidnight.getTime() - now.getTime() + 1000
}

/**
 * Data de hoje (horário local) que se atualiza sozinha na virada do dia.
 * Só provoca nova renderização quando o dia realmente muda.
 */
export function useToday(): Today {
  const [today, setToday] = useState(getToday)

  useEffect(() => {
    let timer: number | undefined

    function refresh() {
      const fresh = getToday()
      setToday((current) =>
        current.month === fresh.month && current.day === fresh.day ? current : fresh,
      )
    }

    function scheduleNextMidnight() {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        refresh()
        scheduleNextMidnight()
      }, msUntilNextMidnight())
    }

    // Timers podem atrasar com a aba em segundo plano ou o computador suspenso.
    function handleReturn() {
      if (document.visibilityState !== 'visible') return
      refresh()
      scheduleNextMidnight()
    }

    scheduleNextMidnight()
    document.addEventListener('visibilitychange', handleReturn)
    window.addEventListener('focus', handleReturn)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleReturn)
      window.removeEventListener('focus', handleReturn)
    }
  }, [])

  return today
}
