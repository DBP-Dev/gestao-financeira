import { useId, useState, type FormEvent } from 'react'
import type { Area, AreaType } from '../types'
import { AREA_TYPE_LABEL, MAX_AREA_NAME_LENGTH, cleanAreaName, validateAreaName } from '../utils/areas'
import { Modal } from './Modal'

export interface AreaFormValues {
  name: string
  type: AreaType
}

interface AreaFormDialogProps {
  /** Tipo pré-selecionado conforme a box de onde o formulário foi aberto. */
  initialType: AreaType
  areas: Area[]
  onSave: (values: AreaFormValues) => void
  onCancel: () => void
}

const TYPE_HINT: Record<AreaType, string> = {
  individual: 'Despesas só suas. Não precisa de membros nem de divisão. Ficará em “Contas individuais”.',
  shared:
    'Despesas divididas entre pessoas, com participantes próprios desta área. Ficará em “Contas compartilhadas”.',
}

const TYPES: AreaType[] = ['individual', 'shared']

export function AreaFormDialog({ initialType, areas, onSave, onCancel }: AreaFormDialogProps) {
  const [name, setName] = useState('')
  const [type, setType] = useState<AreaType>(initialType)
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const inputId = useId()
  const hintId = useId()
  const error = validateAreaName(name, areas)
  const showError = submitAttempted && error !== null

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitAttempted(true)
    if (error) return
    onSave({ name: cleanAreaName(name), type })
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
              placeholder="Ex.: Churrasco, Academia, Viagem"
              data-autofocus
              onChange={(event) => setName(event.target.value)}
              aria-invalid={showError}
            />
            {showError && <p className="field__error">{error}</p>}
          </div>

          <fieldset className="field fieldset">
            <legend className="field__label">Tipo</legend>
            <div className="segmented" role="group" aria-describedby={hintId}>
              {TYPES.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`segmented__option ${type === option ? 'segmented__option--active' : ''}`}
                  aria-pressed={type === option}
                  onClick={() => setType(option)}
                >
                  {AREA_TYPE_LABEL[option]}
                </button>
              ))}
            </div>
            <p id={hintId} className="field__hint">
              {TYPE_HINT[type]} O tipo não poderá ser mudado depois.
            </p>
          </fieldset>
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
