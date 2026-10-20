import { useId, useRef, useState, type ChangeEvent } from 'react'
import type { FinanceData } from '../types'
import {
  MAX_BACKUP_FILE_BYTES,
  createBackup,
  createBackupFileName,
  downloadBackup,
  parseBackup,
  type BackupSummary,
} from '../utils/backup'
import { Modal } from './Modal'

interface BackupDialogProps {
  data: FinanceData
  onRestore: (data: FinanceData) => void
  onClose: () => void
}

type RestoreState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'ready'; fileName: string; data: FinanceData; summary: BackupSummary }
  | { status: 'done' }

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'long',
  timeStyle: 'short',
})

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

export function BackupDialog({ data, onRestore, onClose }: BackupDialogProps) {
  const [exportedFileName, setExportedFileName] = useState<string | null>(null)
  const [restore, setRestore] = useState<RestoreState>({ status: 'idle' })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileInputId = useId()

  function handleExport() {
    const now = new Date()
    const fileName = createBackupFileName(now)
    downloadBackup(createBackup(data, now), fileName)
    setExportedFileName(fileName)
  }

  function resetFileInput() {
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > MAX_BACKUP_FILE_BYTES) {
      setRestore({
        status: 'error',
        message: 'Este arquivo é grande demais para ser um backup do Contas da Família.',
      })
      resetFileInput()
      return
    }

    let text: string
    try {
      text = await file.text()
    } catch {
      setRestore({ status: 'error', message: 'Não foi possível abrir o arquivo escolhido.' })
      resetFileInput()
      return
    }

    const result = parseBackup(text)
    if (result.ok) {
      setRestore({
        status: 'ready',
        fileName: file.name,
        data: result.data,
        summary: result.summary,
      })
    } else {
      setRestore({ status: 'error', message: result.error })
    }
    resetFileInput()
  }

  function handleConfirmRestore() {
    if (restore.status !== 'ready') return
    onRestore(restore.data)
    setRestore({ status: 'done' })
  }

  return (
    <Modal title="Backup dos dados" onClose={onClose}>
      <div className="modal__body">
        <section className="backup-section" aria-labelledby={`${fileInputId}-export`}>
          <h3 id={`${fileInputId}-export`} className="backup-section__title">
            Salvar uma cópia
          </h3>
          <p className="backup-section__text">
            Baixa um arquivo com a família e todas as contas (
            {plural(data.members.length, 'integrante', 'integrantes')} e{' '}
            {plural(data.bills.length, 'conta', 'contas')}). Guarde-o em um lugar seguro.
          </p>
          <div>
            <button type="button" className="button button--primary" onClick={handleExport}>
              Baixar backup
            </button>
          </div>
          {exportedFileName && (
            <p className="backup-message backup-message--ok" role="status">
              ✓ Backup salvo como <strong>{exportedFileName}</strong>.
            </p>
          )}
        </section>

        <section className="backup-section" aria-labelledby={`${fileInputId}-restore`}>
          <h3 id={`${fileInputId}-restore`} className="backup-section__title">
            Restaurar de um arquivo
          </h3>
          <p className="backup-section__text">
            Escolha um arquivo de backup salvo antes. Nada muda até você confirmar.
          </p>

          {restore.status !== 'ready' && (
            <div>
              <label htmlFor={fileInputId} className="button button--ghost file-button">
                Escolher arquivo de backup
              </label>
              <input
                ref={fileInputRef}
                id={fileInputId}
                type="file"
                accept=".json,application/json"
                className="visually-hidden"
                onChange={handleFileChange}
              />
            </div>
          )}

          {restore.status === 'error' && (
            <div className="backup-message backup-message--error" role="alert">
              <strong>! Não foi possível usar este arquivo.</strong>
              <span>{restore.message}</span>
              <span>Seus dados atuais continuam como estavam.</span>
            </div>
          )}

          {restore.status === 'ready' && (
            <div className="backup-confirm" role="alertdialog" aria-labelledby={`${fileInputId}-confirm`}>
              <p id={`${fileInputId}-confirm`} className="backup-confirm__title">
                Substituir os dados atuais?
              </p>
              <ul className="backup-confirm__details">
                <li>
                  Arquivo: <strong>{restore.fileName}</strong>
                </li>
                <li>Feito em {dateTimeFormatter.format(restore.summary.createdAt)}</li>
                <li>
                  {plural(restore.summary.memberCount, 'integrante', 'integrantes')},{' '}
                  {plural(restore.summary.billCount, 'conta', 'contas')} em{' '}
                  {plural(restore.summary.monthCount, 'mês', 'meses')}
                </li>
              </ul>
              <p className="backup-confirm__warning">
                ! Todos os dados que estão no aplicativo agora serão apagados e trocados pelos
                dados deste backup. Se quiser, baixe um backup dos dados atuais antes.
              </p>
              <div className="backup-confirm__actions">
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => setRestore({ status: 'idle' })}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="button button--danger"
                  onClick={handleConfirmRestore}
                >
                  Sim, substituir meus dados
                </button>
              </div>
            </div>
          )}

          {restore.status === 'done' && (
            <p className="backup-message backup-message--ok" role="status">
              ✓ Dados restaurados com sucesso.
            </p>
          )}
        </section>
      </div>

      <div className="modal__footer">
        <button type="button" className="button button--ghost" onClick={onClose}>
          Fechar
        </button>
      </div>
    </Modal>
  )
}
