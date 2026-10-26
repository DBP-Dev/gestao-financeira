/**
 * Mensagens de retorno de ações que alteram os dados. Uma ação só é anunciada como salva
 * depois que a gravação protegida (storageSync) foi confirmada; antes disso, ou se ela
 * não puder acontecer, a mensagem diz que a alteração existe só nesta tela.
 */

/** Situação da gravação de um estado dos dados. */
export type SaveState = 'saved' | 'saving' | 'failed'

export type FeedbackTone = 'ok' | 'pending' | 'error'

export interface SaveFeedback {
  text: string
  tone: FeedbackTone
}

/** `action`: o que foi feito, sem ponto final (ex.: "Membro adicionado"). */
export function saveFeedback(action: string, state: SaveState): SaveFeedback {
  if (state === 'saved') return { text: `✓ ${action}. Alteração salva.`, tone: 'ok' }
  if (state === 'saving') return { text: `${action}. Salvando…`, tone: 'pending' }
  return {
    text: `${action} só nesta tela: a alteração não foi salva. Veja o aviso no topo da página.`,
    tone: 'error',
  }
}

/** Classe do estilo da mensagem para cada tom. */
export function feedbackClassName(tone: FeedbackTone): string {
  if (tone === 'ok') return 'backup-message backup-message--ok'
  if (tone === 'error') return 'backup-message backup-message--error'
  return 'backup-message backup-message--pending'
}
