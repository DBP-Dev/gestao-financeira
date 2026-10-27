import type { Migration } from '../migrations'

/**
 * Esquema inicial: só uma tabela técnica de metadados do servidor. Usuários, sessões e
 * áreas entram nas etapas seguintes, em migrações próprias.
 */
export const migration0001: Migration = {
  version: 1,
  name: 'inicial',
  sql: `
    CREATE TABLE app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
  `,
}
