import { createHash } from 'node:crypto'
import type { Db } from './connection'
import { MIGRATIONS } from './migrations/index'

/** Alteração do esquema. Só para frente: uma migração aplicada nunca é desfeita nem editada. */
export interface Migration {
  /** 1, 2, 3…, sem pular números. */
  version: number
  name: string
  sql: string
}

/** Migrações inconsistentes com o banco: nada é aplicado. */
export class MigrationError extends Error {}

export function migrationChecksum(migration: Migration): string {
  return createHash('sha256').update(migration.sql).digest('hex')
}

interface AppliedRow {
  version: number
  name: string
  checksum: string
}

/**
 * Aplica as migrações pendentes, em ordem, cada uma numa transação (com o registro em
 * `schema_migrations`). Rodar de novo não reaplica nada. Recusa, sem alterar o banco:
 * lista fora de ordem, migração já aplicada que mudou e banco mais novo que o código.
 * Devolve as versões aplicadas agora e a versão final.
 *
 * Concorrência: cada passo (ler o que já foi aplicado, conferir e aplicar a próxima) roda
 * numa transação `BEGIN IMMEDIATE`, que reserva a gravação do banco antes da leitura.
 * Outro processo migrando o mesmo arquivo espera (até o `busy_timeout` da conexão) e depois
 * relê o estado já atualizado, sem reaplicar nada; se a espera estourar, falha com
 * SQLITE_BUSY sem ter alterado o banco.
 *
 * O SQL de uma migração roda dentro dessa transação: não pode ter BEGIN/COMMIT nem comandos
 * que o SQLite ignora ou recusa em transação (`PRAGMA foreign_keys`, `PRAGMA journal_mode`,
 * `VACUUM`).
 */
export function applyMigrations(
  db: Db,
  migrations: readonly Migration[] = MIGRATIONS,
): { applied: number[]; version: number } {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new MigrationError('As migrações precisam ser numeradas 1, 2, 3… sem pular números.')
    }
  })

  const step = db.transaction((): number | undefined => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT
    `)
    const rows = db
      .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
      .all() as AppliedRow[]

    for (const row of rows) {
      const known = migrations[row.version - 1]
      if (!known) {
        throw new MigrationError(
          `O banco tem a migração ${row.version}, que esta versão do servidor não conhece.`,
        )
      }
      if (known.name !== row.name || migrationChecksum(known) !== row.checksum) {
        throw new MigrationError(`A migração ${row.version} mudou depois de aplicada.`)
      }
    }

    const next = migrations[rows.length]
    if (!next) return undefined
    db.exec(next.sql)
    db.prepare(
      'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
    ).run(next.version, next.name, migrationChecksum(next), new Date().toISOString())
    return next.version
  })

  const applied: number[] = []
  for (;;) {
    const version = step.immediate()
    if (version === undefined) break
    applied.push(version)
  }
  return { applied, version: migrations.length }
}

/** Versão do esquema aplicada no banco (0 se nenhuma). */
export function getSchemaVersion(db: Db): number {
  const exists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get()
  if (!exists) return 0
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
    version: number | null
  }
  return row.version ?? 0
}
