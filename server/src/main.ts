import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigError, loadConfig } from './config'
import { DatabaseNotFoundError } from './db/connection'
import { DatabaseNotInitializedError, startServer } from './server'

/**
 * Ponto de entrada: `npm run server:dev` (passa `--dev`) ou `npm run server:start` (modo
 * estrito, exige GESTAO_ENV e GESTAO_DB_PATH).
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

async function main() {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== '--dev')) throw new ConfigError('Argumento desconhecido; o único aceito é --dev.')
  const config = loadConfig(process.env, repoRoot, { dev: args.includes('--dev') })
  const running = await startServer(config, { logger: true })
  running.app.log.info(`Servidor (${config.environment}) em ${running.address}`)

  // Encerramento organizado: Ctrl+C no terminal (SIGINT) ou pedido do sistema (SIGTERM).
  const shutdown = (signal: string) => {
    running.app.log.info(`Encerrando (${signal})…`)
    running.stop().then(
      () => process.exit(0),
      (error: unknown) => {
        running.app.log.error({ err: error }, 'Falha ao encerrar')
        process.exit(1)
      },
    )
  }
  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((error: unknown) => {
  const known =
    error instanceof ConfigError || error instanceof DatabaseNotFoundError || error instanceof DatabaseNotInitializedError
  console.error(known ? `Configuração inválida: ${error.message}` : 'Falha ao iniciar o servidor.')
  if (!known) console.error(error)
  process.exit(1)
})
