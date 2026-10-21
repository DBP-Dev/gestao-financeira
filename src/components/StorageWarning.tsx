import type { StorageIssue } from '../hooks/useFinanceStore'
import { createBackupFileName, downloadTextFile } from '../utils/backup'

interface StorageWarningProps {
  issue: StorageIssue
}

/** Aviso exibido quando os dados salvos no navegador não puderam ser abertos. */
export function StorageWarning({ issue }: StorageWarningProps) {
  function handleDownload() {
    if (issue.kind === 'unavailable') return
    const fileName = createBackupFileName(new Date(), 'gestao-de-gastos-dados-originais', 'txt')
    downloadTextFile(issue.original, fileName)
  }

  return (
    <div className="notice notice--danger" role="alert">
      <div className="notice__content">
        {issue.kind === 'unavailable' ? (
          <>
            <strong>! O navegador bloqueou o acesso aos dados salvos.</strong>
            <p>
              Para proteger o que estiver guardado, nada será gravado neste navegador enquanto
              o acesso estiver bloqueado. As alterações feitas agora serão perdidas ao fechar a
              página.
            </p>
          </>
        ) : (
          <>
            <strong>! Não foi possível abrir os dados salvos neste navegador.</strong>
            <p>Motivo: {issue.reason}</p>
            {issue.kind === 'recovered' ? (
              <p>
                Uma cópia exata dos dados originais foi guardada com segurança e não será
                apagada. Baixe essa cópia ou restaure um backup em “Backup dos dados”.
              </p>
            ) : (
              <p>
                Também não foi possível guardar uma cópia de segurança. Para não perder nada,
                o aplicativo não vai gravar nenhuma alteração neste navegador. Baixe os dados
                originais agora.
              </p>
            )}
          </>
        )}
      </div>
      {issue.kind !== 'unavailable' && (
        <button type="button" className="button button--small button--ghost" onClick={handleDownload}>
          Baixar dados originais
        </button>
      )}
    </div>
  )
}
