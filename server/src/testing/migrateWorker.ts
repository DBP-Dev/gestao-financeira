import { openDatabase } from '../db/connection'
import { applyMigrations, type Migration } from '../db/migrations'

/**
 * Processo auxiliar do teste de concorrência das migrações (não faz parte do servidor).
 * Uso: node --import tsx migrateWorker.ts <banco> <horário de largada em ms>
 * Espera até o horário combinado, para que vários processos comecem juntos, aplica as
 * migrações de teste abaixo e escreve o resultado em JSON na saída padrão.
 */
const WORKER_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'lenta',
    // Demora o bastante para os outros processos tentarem migrar enquanto ela roda.
    sql: `
      CREATE TABLE lenta (x INTEGER NOT NULL) STRICT;
      WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 300000)
      INSERT INTO lenta SELECT x FROM c;
    `,
  },
  { version: 2, name: 'segunda', sql: 'CREATE TABLE segunda (id INTEGER PRIMARY KEY) STRICT;' },
]

const [file, startAt] = process.argv.slice(2)
await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(startAt) - Date.now())))
const db = openDatabase(file)
try {
  process.stdout.write(JSON.stringify({ ok: true, ...applyMigrations(db, WORKER_MIGRATIONS) }))
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(error) }))
} finally {
  db.close()
}
