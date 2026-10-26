import { describe, expect, it } from 'vitest'
import { feedbackClassName, saveFeedback } from './saveFeedback'

describe('mensagens de ações que alteram os dados', () => {
  it('só anuncia "salva" depois da confirmação', () => {
    expect(saveFeedback('Membro adicionado', 'saved')).toEqual({
      text: '✓ Membro adicionado. Alteração salva.',
      tone: 'ok',
    })
    expect(saveFeedback('Membro adicionado', 'saving')).toEqual({
      text: 'Membro adicionado. Salvando…',
      tone: 'pending',
    })
    const failed = saveFeedback('Membro adicionado', 'failed')
    expect(failed.tone).toBe('error')
    expect(failed.text).toBe(
      'Membro adicionado só nesta tela: a alteração não foi salva. Veja o aviso no topo da página.',
    )
    // Só a mensagem de salva tem o sinal de confirmação.
    expect(saveFeedback('X', 'saving').text).not.toContain('✓')
    expect(failed.text).not.toContain('✓')
  })

  it('usa um estilo diferente para cada situação', () => {
    expect(feedbackClassName('ok')).toBe('backup-message backup-message--ok')
    expect(feedbackClassName('pending')).toBe('backup-message backup-message--pending')
    expect(feedbackClassName('error')).toBe('backup-message backup-message--error')
  })
})
