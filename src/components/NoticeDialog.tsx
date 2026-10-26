import { Modal } from './Modal'

interface NoticeDialogProps {
  title: string
  message: string
  onClose: () => void
}

/** Explica por que uma ação não foi feita. Nada é alterado. */
export function NoticeDialog({ title, message, onClose }: NoticeDialogProps) {
  return (
    <Modal title={title} onClose={onClose} size="small">
      <div className="modal__body">
        <p className="confirm__message" role="alert">
          {message}
        </p>
        <p className="confirm__message">Nenhum dado foi alterado.</p>
      </div>
      <div className="modal__footer">
        <button type="button" className="button button--primary" onClick={onClose} data-autofocus>
          Entendi
        </button>
      </div>
    </Modal>
  )
}
