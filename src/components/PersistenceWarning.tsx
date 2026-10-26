import type { PersistenceStatus } from '../utils/storageSync'

interface PersistenceWarningProps {
  status: PersistenceStatus
}

/**
 * Aviso da gravação protegida (storageSync). Nada aparece com 'saved' ou 'saving'.
 * Com conflito, falha de leitura ou sem suporte, a aba não grava mais nada.
 */
export function PersistenceWarning({ status }: PersistenceWarningProps) {
  if (status === 'saved' || status === 'saving') return null

  const canReload = status === 'conflict' || status === 'read-failed'

  return (
    <div className="notice notice--danger" role="alert">
      <div className="notice__content">
        {status === 'conflict' && (
          <>
            <strong>Os dados foram alterados em outra aba ou janela.</strong>
            <p>
              Para não apagar essas mudanças, esta aba parou de gravar. O que for alterado aqui
              a partir de agora não será gravado. Recarregue a página para continuar com os
              dados atualizados.
            </p>
          </>
        )}
        {status === 'read-failed' && (
          <>
            <strong>Não foi possível conferir os dados salvos neste navegador.</strong>
            <p>
              Para não sobrescrever nada, esta aba parou de gravar. O que for alterado aqui a
              partir de agora não será gravado. Recarregue a página para tentar de novo.
            </p>
          </>
        )}
        {status === 'unsupported' && (
          <>
            <strong>Este navegador não permite gravar os dados com segurança.</strong>
            <p>
              Falta um recurso necessário para não perder dados quando o aplicativo está aberto
              em mais de uma aba. Por isso, nada será gravado e as alterações serão perdidas ao
              fechar a página. Use um navegador atualizado.
            </p>
          </>
        )}
        {status === 'write-failed' && (
          <>
            <strong>A última alteração não pôde ser gravada.</strong>
            <p>
              O armazenamento do navegador pode estar cheio ou bloqueado. A alteração continua só
              nesta tela; o aplicativo tenta gravar de novo na próxima alteração.
            </p>
          </>
        )}
      </div>
      {canReload && (
        <button
          type="button"
          className="button button--small button--ghost"
          onClick={() => window.location.reload()}
        >
          Recarregar
        </button>
      )}
    </div>
  )
}
