import type { Member } from '../types'
import { ConfirmDialog } from './ConfirmDialog'
import { Modal } from './Modal'

interface DeleteMemberDialogProps {
  member: Member
  /** Motivos que impedem a exclusão (vazio = pode excluir). */
  blockers: string[]
  onConfirm: () => void
  onCancel: () => void
}

/** Confirma a exclusão de um membro ou explica por que ela não é permitida. */
export function DeleteMemberDialog({ member, blockers, onConfirm, onCancel }: DeleteMemberDialogProps) {
  if (blockers.length === 0) {
    return (
      <ConfirmDialog
        title={`Excluir “${member.name}”?`}
        message="Este membro não participa de nenhuma conta. A exclusão não pode ser desfeita."
        confirmLabel="Sim, excluir"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
  }

  return (
    <Modal title={`Não é possível excluir “${member.name}”`} onClose={onCancel} size="small">
      <div className="modal__body">
        <ul className="blockers" role="alert">
          {blockers.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <p className="confirm__message">Nenhum dado foi alterado.</p>
      </div>
      <div className="modal__footer">
        <button
          type="button"
          className="button button--primary"
          onClick={onCancel}
          data-autofocus
        >
          Entendi
        </button>
      </div>
    </Modal>
  )
}
