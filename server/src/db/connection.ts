import fs from 'node:fs'
import Database from 'better-sqlite3'

export type Db = Database.Database

export const BUSY_TIMEOUT_MS = 5000

/** O arquivo do banco não existe e a abertura não tinha permissão para criá-lo. */
export class DatabaseNotFoundError extends Error {}

/**
 * Abre o banco com os ajustes do servidor: modo WAL (leituras não bloqueiam a gravação),
 * chaves estrangeiras ligadas e espera de até 5 s quando outra conexão está gravando.
 * Os três valores são conferidos depois de aplicados; se algum não estiver em vigor, a
 * conexão é fechada e o erro é lançado.
 *
 * Por padrão o arquivo precisa existir (um caminho digitado errado nunca vira um banco novo
 * e vazio). Só `create: true` cria o arquivo; quem usa isso é a inicialização explícita
 * (`db:init`), o banco padrão do modo de desenvolvimento e os testes.
 *
 * Só `create: true` liga o modo WAL (gravado no próprio arquivo). Sem ele, o modo existente
 * é apenas lido: um arquivo que não está em WAL (não foi criado por `db:init`, como um arquivo
 * vazio ou o banco de outro programa) é recusado sem nenhuma gravação.
 */
export function openDatabase(file: string, options: { create?: boolean } = {}): Db {
  if (!options.create && !fs.existsSync(file)) {
    throw new DatabaseNotFoundError('O arquivo do banco não existe.')
  }
  const db = new Database(file, { fileMustExist: !options.create })
  try {
    // busy_timeout e foreign_keys valem só para a conexão; não gravam nada no arquivo.
    db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`)
    if (options.create) db.pragma('journal_mode = WAL')
    const mode = db.pragma('journal_mode', { simple: true })
    if (mode !== 'wal') {
      throw new Error(
        `O banco não está em modo WAL (modo atual: ${String(mode)}); só bancos criados pelo \`db:init\` são aceitos.`,
      )
    }
    db.pragma('foreign_keys = ON')
    const foreignKeys = db.pragma('foreign_keys', { simple: true })
    if (foreignKeys !== 1) throw new Error('As chaves estrangeiras não ficaram ligadas.')
    const busyTimeout = db.pragma('busy_timeout', { simple: true })
    if (busyTimeout !== BUSY_TIMEOUT_MS) {
      throw new Error(`A espera de gravação não ficou em ${BUSY_TIMEOUT_MS} ms.`)
    }
  } catch (error) {
    db.close()
    throw error
  }
  return db
}
