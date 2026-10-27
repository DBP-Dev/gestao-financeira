import type { FastifyInstance } from 'fastify'
import { buildApp } from './app'
import type { ServerConfig } from './config'
import { openDatabase, type Db } from './db/connection'
import { applyMigrations, getSchemaVersion } from './db/migrations'

/** O arquivo existe, mas não tem nenhuma migração aplicada (não foi criado pelo `db:init`). */
export class DatabaseNotInitializedError extends Error {}

export interface RunningServer {
  app: FastifyInstance
  db: Db
  /** Endereço em que o servidor está escutando (ex.: "http://127.0.0.1:3001"). */
  address: string
  /** Para de aceitar conexões, espera as requisições em andamento e fecha o banco. */
  stop: () => Promise<void>
}

/**
 * Abre o banco, aplica as migrações pendentes e começa a escutar só no endereço da
 * configuração. Se algo falhar no caminho, o que já foi aberto é fechado antes de lançar o erro.
 *
 * Sem `createDatabase`, o banco precisa existir e já ter sido inicializado (`db:init`): um
 * arquivo ausente ou sem nenhuma migração é recusado, sem criar nem alterar nada.
 */
export async function startServer(
  config: Pick<ServerConfig, 'host' | 'port' | 'dbPath'> & Partial<Pick<ServerConfig, 'createDatabase'>>,
  options: { logger?: boolean } = {},
): Promise<RunningServer> {
  const db = openDatabase(config.dbPath, { create: config.createDatabase })
  let app: FastifyInstance | undefined
  try {
    if (!config.createDatabase && getSchemaVersion(db) === 0) {
      throw new DatabaseNotInitializedError('O banco não foi inicializado; crie-o com `npm run db:init`.')
    }
    applyMigrations(db)
    app = buildApp({ db, logger: options.logger })
    const address = await app.listen({ host: config.host, port: config.port })
    const server = app
    let stopping: Promise<void> | undefined
    const stop = () => {
      stopping ??= (async () => {
        try {
          await server.close()
        } finally {
          db.close()
        }
      })()
      return stopping
    }
    return { app: server, db, address, stop }
  } catch (error) {
    if (app) await app.close().catch(() => undefined)
    db.close()
    throw error
  }
}
