import type { BackupFile } from '../domain/backup'

/** Faz o navegador baixar o backup como arquivo .json. */
export function downloadBackup(backup: BackupFile, fileName: string) {
  downloadTextFile(JSON.stringify(backup, null, 2), fileName, 'application/json')
}

/** Faz o navegador baixar um texto qualquer como arquivo, sem alterá-lo. */
export function downloadTextFile(text: string, fileName: string, type = 'text/plain') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
