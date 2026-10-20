import { useId, useState, type FormEvent } from 'react'
import type { Member } from '../types'
import {
  MAX_MEMBER_NAME_LENGTH,
  MEMBER_COLOR_OPTIONS,
  pickMemberColor,
  validateMemberName,
  type MemberColorOption,
} from '../utils/members'
import { Avatar } from './Avatar'
import { Modal } from './Modal'

export interface MemberFormValues {
  name: string
  color: string
}

interface MemberFormDialogProps {
  /** Membro sendo editado; ausente ao adicionar. */
  member?: Member
  members: Member[]
  onSave: (values: MemberFormValues) => void
  onCancel: () => void
}

export function MemberFormDialog({ member, members, onSave, onCancel }: MemberFormDialogProps) {
  const [name, setName] = useState(member?.name ?? '')
  // Novo membro começa com a cor menos usada; membro existente, com a cor que já tem.
  const [color, setColor] = useState(() => member?.color ?? pickMemberColor(members))
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const inputId = useId()
  const colorGroupName = useId()
  const error = validateMemberName(name, members, member?.id)
  const showError = submitAttempted && error !== null

  // Uma cor salva fora da paleta (ex.: vinda de backup) continua disponível até ser trocada.
  const colorOptions: MemberColorOption[] =
    member && !MEMBER_COLOR_OPTIONS.some((option) => option.value === member.color)
      ? [{ value: member.color, label: 'Cor atual' }, ...MEMBER_COLOR_OPTIONS]
      : MEMBER_COLOR_OPTIONS

  const preview: Member = {
    id: member?.id ?? 'previa',
    name: name.trim() || member?.name || '?',
    emoji: member?.emoji ?? '',
    color,
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitAttempted(true)
    if (error) return
    onSave({ name: name.trim(), color })
  }

  return (
    <Modal title={member ? 'Editar membro' : 'Adicionar membro'} onClose={onCancel} size="small">
      <form onSubmit={handleSubmit} noValidate>
        <div className="modal__body">
          <div className="rename__preview">
            <Avatar member={preview} size="large" />
          </div>

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
              data-autofocus
              onChange={(event) => setName(event.target.value)}
              aria-invalid={showError}
            />
            {showError && <p className="field__error">{error}</p>}
            {member && (
              <p className="field__hint">
                Mudar o nome ou a cor não altera as contas nem os valores desta pessoa.
              </p>
            )}
          </div>

          <fieldset className="field fieldset">
            <legend className="field__label">Cor</legend>
            <div className="color-picker">
              {colorOptions.map((option) => {
                const selected = option.value === color
                return (
                  <label
                    key={option.value}
                    className={`color-swatch ${selected ? 'color-swatch--selected' : ''}`}
                    style={{ backgroundColor: option.value }}
                    title={option.label}
                  >
                    <input
                      type="radio"
                      name={colorGroupName}
                      value={option.value}
                      checked={selected}
                      onChange={() => setColor(option.value)}
                      className="visually-hidden"
                    />
                    <span className="visually-hidden">{option.label}</span>
                    {selected && (
                      <span className="color-swatch__check" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          </fieldset>
        </div>
        <div className="modal__footer">
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="button button--primary">
            {member ? 'Salvar' : 'Adicionar membro'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
