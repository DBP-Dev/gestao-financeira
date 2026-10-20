import { useId, useState, type FormEvent } from 'react'
import type { Member } from '../types'
import { Avatar } from './Avatar'
import { Modal } from './Modal'

interface RenameMemberDialogProps {
  member: Member
  onSave: (name: string) => void
  onCancel: () => void
}

export function RenameMemberDialog({ member, onSave, onCancel }: RenameMemberDialogProps) {
  const [name, setName] = useState(member.name)
  const [showError, setShowError] = useState(false)
  const inputId = useId()
  const trimmed = name.trim()

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!trimmed) {
      setShowError(true)
      return
    }
    onSave(trimmed)
  }

  return (
    <Modal title="Mudar nome" onClose={onCancel} size="small">
      <form onSubmit={handleSubmit} noValidate>
        <div className="modal__body">
          <div className="rename__preview">
            <Avatar member={member} size="large" />
          </div>
          <div className="field">
            <label htmlFor={inputId} className="field__label">
              Nome
            </label>
            <input
              id={inputId}
              className="input"
              value={name}
              maxLength={20}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              aria-invalid={showError && !trimmed}
            />
            {showError && !trimmed && (
              <p className="field__error">Escreva um nome.</p>
            )}
          </div>
        </div>
        <div className="modal__footer">
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="button button--primary">
            Salvar nome
          </button>
        </div>
      </form>
    </Modal>
  )
}
