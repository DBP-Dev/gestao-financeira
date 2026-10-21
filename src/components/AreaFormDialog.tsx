import { useId, useState, type FormEvent } from 'react'
import type { Area } from '../types'
import { MAX_AREA_NAME_LENGTH, cleanAreaName, validateAreaName } from '../utils/areas'
import { Modal } from './Modal'

export interface AreaFormValues {
  name: string
}

interface AreaFormDialogProps {
  areas: Area[]
  onSave: (values: AreaFormValues) => void
  onCancel: () => void
}

/** Cria uma área compartilhada. As contas individuais ficam na área fixa "Minhas contas". */
export function AreaFormDialog({ areas, onSave, onCancel }: AreaFormDialogProps) {
  const [name, setName] = useState('')
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const inputId = useId()
  const hintId = useId()
  const error = validateAreaName(name, areas)
  const showError = submitAttempted && error !== null

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitAttempted(true)
    if (error) return
    onSave({ name: cleanAreaName(name) })
  }

  return (
    <Modal title="Nova área" onClose={onCancel} size="small">
      <form onSubmit={handleSubmit} noValidate>
        <div className="modal__body">
          <div className="field">
            <label htmlFor={inputId} className="field__label">
              Nome da área
            </label>
            <input
              id={inputId}
              className="input"
              value={name}
              maxLength={MAX_AREA_NAME_LENGTH}
              placeholder="Ex.: Churrasco, Viagem, República"
              data-autofocus
              onChange={(event) => setName(event.target.value)}
              aria-invalid={showError}
              aria-describedby={hintId}
            />
            {showError && <p className="field__error">{error}</p>}
            <p id={hintId} className="field__hint">
              Despesas divididas entre pessoas, com participantes próprios desta área. Ficará em
              “Contas compartilhadas”.
            </p>
          </div>
        </div>
        <div className="modal__footer">
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="button button--primary">
            Criar área
          </button>
        </div>
      </form>
    </Modal>
  )
}
