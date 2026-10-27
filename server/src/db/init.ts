import fs from 'node:fs'
import { openDatabase, type Db } from './connection'
import { applyMigrations, type Migration } from './migrations'
import { MIGRATIONS } from './migrations/index'

/**
 * Cria o banco pela primeira vez e aplica as migrações. Só é chamado pelo comando explícito
 * `db:init` (nunca pelo início do servidor). O arquivo é criado de forma exclusiva: se já
 * existir, nada é alterado. Se algo falhar depois de criado, o arquivo e os auxiliares que
 * esta chamada criou são removidos.
 */
export function initDatabase(
  file: string,
  migrations: readonly Migration[] = MIGRATIONS,
): { version: number } {
  // 'wx': falha (EEXIST) se o arquivo já existir, inclusive se surgir depois da validação.
  fs.closeSync(fs.openSync(file, 'wx'))
  let db: Db | undefined
  try {
    // O arquivo acabou de ser criado (vazio) por esta chamada: `create` liga o modo WAL nele.
    db = openDatabase(file, { create: true })
    const { version } = applyMigrations(db, migrations)
    db.close()
    return { version }
  } catch (error) {
    db?.close()
    for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(file + suffix, { force: true })
    throw error
  }
}
