import { useEffect, useId, useRef, type ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  size?: 'small' | 'large'
}

/** Janela sobreposta acessível (fecha com Esc e mantém o foco dentro dela). */
export function Modal({ title, onClose, children, size = 'large' }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className={`modal modal--${size}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="modal__header">
        <h2 id={titleId} className="modal__title">
          {title}
        </h2>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Fechar janela"
        >
          ✕
        </button>
      </div>
      {children}
    </dialog>
  )
}
