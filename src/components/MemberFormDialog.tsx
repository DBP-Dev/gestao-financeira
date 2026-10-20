import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { Member } from '../types'
import { MAX_MEMBER_NAME_LENGTH, validateMemberName } from '../utils/members'
import { Avatar } from './Avatar'
import { Modal } from './Modal'

interface MemberFormDialogProps {
  /** Membro sendo editado; ausente ao adicionar. */
  member?: Member
  members: Member[]
  onSave: (name: string) => void
  onCancel: () => void
}

export function MemberFormDialog({ member, members, onSave, onCancel }: MemberFormDialogProps) {
  const [name, setName] = useState(member?.name ?? '')
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  // O Modal abre o <dialog> no próprio efeito (que roda antes deste) e leva o foco
  // ao botão de fechar; aqui o foco vai para o campo de nome.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  const error = validateMemberName(name, members, member?.id)
  const showError = submitAttempted && error !== null

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitAttempted(true)
    if (error) return
    onSave(name.trim())
  }

  return (
    <Modal title={member ? 'Editar membro' : 'Adicionar membro'} onClose={onCancel} size="small">
      <form onSubmit={handleSubmit} noValidate>
        <div className="modal__body">
          {member && (
            <div className="rename__preview">
              <Avatar member={member} size="large" />
            </div>
          )}
          <div className="field">
            <label htmlFor={inputId} className="field__label">
              Nome
            </label>
            <input
              id={inputId}
              className="input"
              value={name}
              maxLength={MAX_MEMBER_NAME_LENGTH}
              placeholder="Ex.: Tia, Primo, Avó"
              ref={inputRef}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={showError}
            />
            {showError && <p className="field__error">{error}</p>}
            {member && (
              <p className="field__hint">
                Mudar o nome não altera as contas nem os valores desta pessoa.
              </p>
            )}
          </div>
        </div>
        <div className="modal__footer">
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="button button--primary">
            {member ? 'Salvar nome' : 'Adicionar membro'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
